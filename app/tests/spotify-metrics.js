// Focused counter-reader/normalization checks. No browser captures, videos or visual-review helpers.
const assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const A = require("../dist/profile"), { read } = require("../src-tauri/src/spotify-metrics");
const fixture = require("./data/spotify-artist-counters.json"), artistId = "3W3dTmUEXbo2D9CQzNTSaI";
const metrics = read(fixture, artistId);
assert.equal(metrics.monthlyListeners, 4081182);
assert.equal(metrics.tracks[0].plays, 77764191);
assert.equal(metrics.tracks.length, 10);
assert.equal(read(fixture, "24PhFqIM2MOH9oAVnPzfRe"), null);
const zero = structuredClone(fixture);
zero.data.artistUnion.stats.monthlyListeners = 0;
zero.data.artistUnion.discography.topTracks.items[0].track.playcount = "0";
assert.equal(read(zero, artistId).monthlyListeners, 0);
assert.equal(read(zero, artistId).tracks[0].plays, 0);
zero.data.artistUnion.discography.topTracks.items[0].track.playcount = null;
assert.equal(read(zero, artistId).tracks[0].plays, null);

(async () => {
  const trackList = metrics.tracks.slice().reverse().map(t => ({ uri: "spotify:track:" + t.id, title: t.id, duration: 183000 }));
  const embed = '<script id="__NEXT_DATA__">' + JSON.stringify({ props: { pageProps: { state: { data: { entity: { name: "Altare", trackList } } } } } }) + '</script>';
  const io = { text: async url => url.includes("/embed/") ? embed : "", json: async () => ({ thumbnail_url: "https://example.invalid/cover.webp" }), spotifyMetrics: async () => metrics };
  const profile = await A.extract(io, "https://open.spotify.com/artist/" + artistId);
  assert.equal(profile.monthlyListeners, metrics.monthlyListeners);
  for (const track of profile.releases) assert.equal(track.views, metrics.tracks.find(t => t.id === track.id).plays);
  const unavailable = await A.extract({ ...io, spotifyMetrics: async () => ({ monthlyListeners: null, tracks: [] }) }, profile.url);
  assert.equal(unavailable.monthlyListeners, null);
  assert.ok(unavailable.releases.every(t => t.views === null));
  await assert.rejects(A.extract({ ...io, spotifyMetrics: async () => { throw Error("offline"); } }, profile.url), /offline/);
  const services = fs.readFileSync(require.resolve("../dist/services.js"), "utf8").split("/* ===== profile ===== */")[1];
  const link = profile.url;
  const old = { platforms: {
    spotify: { link, url: link, name: "Altare", fetched: Date.now(), releases: [{ id: trackList[0].uri.slice(14), title: "cached", views: 0 }], manual: {} },
    youtube: { link: "youtube", releases: [], manual: {}, marker: "preserved" },
    soundcloud: { link: "soundcloud", releases: [], manual: {}, marker: "preserved" }
  } };
  function cache(saved, offline = false) {
    let persisted = structuredClone(saved), calls = 0;
    const shell = { st: { settings: { links: { spotify: link, youtube: "youtube", soundcloud: "soundcloud" } } }, emit() {},
      async invoke(cmd, args) {
        if (cmd === "profile_get") return structuredClone(persisted);
        if (cmd === "profile_set") { persisted = structuredClone(args.profile); return; }
        if (cmd === "profile_prune") return 0;
        if (cmd === "profile_file_get") return null;
        if (cmd === "spotify_artist_metrics") { calls++; if (offline) throw Error("offline"); return metrics; }
        if (cmd === "http_text") return args.url.includes("/embed/") ? embed : "{}";
        throw Error("Unexpected command: " + cmd);
      }
    };
    vm.runInNewContext(services, { window: { __shell: shell, __artist: A }, performance, URL, Blob, console });
    return { api: shell.profile, saved: () => persisted, calls: () => calls };
  }
  const migration = cache(old);
  assert.equal((await migration.api.get()).platforms.spotify.releases[0].views, 0);
  await migration.api.refresh(["spotify"]);
  assert.equal(migration.calls(), 1);
  assert.equal(migration.saved().platforms.spotify.parserVersion, 1);
  assert.equal(migration.saved().platforms.spotify.monthlyListeners, metrics.monthlyListeners);
  assert.deepEqual(migration.saved().platforms.youtube, old.platforms.youtube);
  assert.deepEqual(migration.saved().platforms.soundcloud, old.platforms.soundcloud);
  const valid = cache(migration.saved());
  await valid.api.get(); await valid.api.get();
  assert.equal(valid.calls(), 0);
  const zeroCache = structuredClone(migration.saved());
  zeroCache.platforms.spotify.monthlyListeners = 0;
  zeroCache.platforms.spotify.releases.forEach(t => { t.views = 0; });
  const validZero = cache(zeroCache);
  assert.equal((await validZero.api.get()).platforms.spotify.monthlyListeners, 0);
  assert.equal(validZero.calls(), 0);
  const older = structuredClone(zeroCache);
  older.platforms.spotify.parserVersion = 0;
  const outdated = cache(older);
  await outdated.api.get(); await outdated.api.refresh(["spotify"]);
  assert.equal(outdated.calls(), 1);
  const failure = cache(old, true);
  await failure.api.get(); await failure.api.refresh(["spotify"]); await failure.api.get();
  assert.equal(failure.calls(), 1);
  assert.equal(failure.saved().platforms.spotify.parserVersion, undefined);
  assert.deepEqual(failure.saved().platforms.spotify.releases, old.platforms.spotify.releases);
  assert.equal(failure.saved().platforms.spotify.error, "offline");
  const retry = cache(failure.saved());
  await retry.api.get(); await retry.api.refresh(["spotify"]);
  assert.equal(retry.saved().platforms.spotify.parserVersion, 1);
  console.log("OK Spotify cache: old/previous version migration, cache reuse, valid zero, offline preservation/retry and other platforms unchanged");
  console.log("OK Spotify public counters: artist identity, exact values, zero, unavailable values, track identity and failed reads");
})().catch(e => { console.error(e); process.exitCode = 1; });
