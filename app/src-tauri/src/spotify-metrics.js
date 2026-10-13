// Only the requested artist's public listener and top-track play counters leave this temporary page.
(() => {
  const counter = value => {
    if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value))) return null;
    const n = Number(value);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  };
  function read(json, artistId) {
    const a = json && json.data && json.data.artistUnion;
    if (!a || a.uri !== "spotify:artist:" + artistId || !a.stats || !a.discography || !a.discography.topTracks) return null;
    const items = a.discography.topTracks.items;
    if (!Array.isArray(items)) return null;
    return { artistId, monthlyListeners: counter(a.stats.monthlyListeners), tracks: items.slice(0, 10).map(item => {
      const track = item && item.track;
      return track && /^[A-Za-z0-9]{22}$/.test(track.id || "") ? { id: track.id, plays: counter(track.playcount) } : null;
    }).filter(Boolean) };
  }
  if (typeof module !== "undefined" && module.exports) { module.exports = { read }; return; }
  if (window !== window.top || location.origin !== "https://open.spotify.com") return;
  const artistId = "__HALATION_SPOTIFY_ARTIST_ID__";
  let sent = false;
  const consume = json => {
    const metrics = read(json, artistId);
    if (!metrics || sent) return;
    sent = true;
    location.href = "https://halation-spotify.invalid/metrics?data=" + encodeURIComponent(JSON.stringify(metrics));
  };
  const relevant = url => {
    try { const u = new URL(url); return u.hostname === "api-partner.spotify.com" && u.pathname.startsWith("/pathfinder/"); } catch (_) { return false; }
  };
  const fetch = window.fetch;
  window.fetch = function (...args) {
    return fetch.apply(this, args).then(response => {
      if (relevant(response.url)) response.clone().json().then(consume).catch(() => {});
      return response;
    });
  };
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", () => {
      if (!relevant(this.responseURL)) return;
      try { consume(this.responseType === "json" ? this.response : JSON.parse(this.responseText)); } catch (_) {}
    });
    return send.apply(this, args);
  };
})();
