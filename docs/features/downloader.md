# Downloader — Specification

Status: Planned — not ported to the native app; implemented in the Tauri app on `main`.

The Downloader turns a link into a media file: preview first, choose video/audio/cover, then download. Public
metadata may come from Spotify or Apple Music; the audio always comes from YouTube or another yt-dlp source, never
from Spotify. This spec records the behaviour verified in the Tauri app so the native app can reproduce it without
copying that app's HTML, CSS or JavaScript. Save/export destinations follow
[the global save & export policy](save-location.md).

## 0. Principles

1. **The user supplies the link.** No browsing, recommendations, accounts, telemetry or cloud processing.
2. **Spotify is metadata only.** Spotify audio is DRM-protected and is never downloaded; a Spotify track is matched
   to a public YouTube Music/YouTube upload and tagged with Spotify's public metadata. Apple Music is metadata and
   cover only.
3. **No DRM circumvention.** Private, paid or DRM-protected streams are out of scope; yt-dlp is never given cookies
   or credentials by Halation.
4. **Preview before download.** The tool reads the link's public information first and shows what will be saved.
5. **Original before transcode.** Audio "Original" keeps the published codec/container; MP3 is an explicit choice
   and never improves quality.
6. **Rust does the work, Slint presents.** Network, yt-dlp, scoring, tagging and file handling are Rust; the Slint
   page only shows state and sends intents.
7. **Nothing is written halfway.** Partial files are removed on cancel or failure.

## 1. Inputs and preview

Accepted inputs:

- Video/audio pages and playlists from the sites yt-dlp supports, including YouTube, YouTube Music, SoundCloud,
  Bandcamp, Vimeo, X/Twitter, TikTok and Instagram. The Tauri app names these sites in `siteName`
  (`main:app/dist/downloader.js:33-37`).
- Spotify track, album or playlist links (`open.spotify.com` and `play.spotify.com`).
- Apple Music links (`music.apple.com`, `itunes.apple.com`).

The preview is read with:

```
yt-dlp -J --no-playlist [--flat-playlist] --playlist-items 1:300 --encoding utf-8 --no-warnings <url>
```

A playlist or album link lists up to **300 tracks** (`downloader.js:180,197`). SoundCloud and Bandcamp lists are
read in full because their flat entries lack details; the other sites use the flat list. Each entry has a URL,
title, artist, duration and thumbnail where available. YouTube Music albums use the most common artist because the
list has no album artist.

Spotify metadata is read from the public track page and embed page, falling back to oEmbed; an album uses the embed
page's track list (`main:app/dist/spotify.js:11-80`). A Spotify album lists its songs first; choosing one opens it in the
same preview. A playlist or an artist page is only previewed through oEmbed, with the notice that only single songs are
searched and that albums/playlists offer the cover (`downloader.js:132-135`). Apple Music uses the public iTunes
lookup endpoint and shows a DRM notice; it does not search for audio (`downloader.js:170-175`).

The preview shows site, title, author, duration, the highest available height, cover and any notice. Cover URLs are
upgraded to the largest version each service publishes (`downloader.js:99-107`).

## 2. Actions and verified defaults

### 2.1 Video

- Quality choices are the heights actually present in the source, highest first. The default is the first height
  **≤ 1080**; if none exists, the only choice is **Best available** (`downloader.js:307-320`,
  `downloader.html:54`).
- The format request prefers H.264 video plus AAC audio and merges to MP4:

```
-f "bv*[height<=H][vcodec^=avc1]+ba[acodec^=mp4a]/bv*[height<=H]+ba/b[height<=H]/b"
-S "vcodec:h264,acodec:aac"
--merge-output-format mp4
```

`H` is omitted for Best (`downloader.js:455-461`). A source without H.264/AAC falls back to the best available
streams inside MP4; no extra conversion is forced beyond the merge.

### 2.2 Audio

- **Original (best quality)** is the default: `-x` keeps the published audio stream and container without
  re-encoding (`downloader.html:86`, `downloader.js:462-467`).
- **MP3** is the explicit alternative: `--audio-format mp3 --audio-quality 0` (VBR q0). It is for compatibility, not
  an improvement; the preview says so.
- Spotify "Original" requests `ba[ext=m4a]/ba/b` so the AAC/M4A stream can carry the cover without re-encoding.

### 2.3 Cover

Covers are downloaded from the largest artwork URL, converted to PNG and saved through the global destination
policy (`downloader.js:546-563`). A cover job is a light job and does not need yt-dlp.

## 3. Spotify matching (verified)

Spotify's public metadata (title, artists, album, length, date, cover) is compared with candidates from YouTube
Music (first 3 songs) and YouTube (`ytsearch5: "<artist> <title>" audio`) (`spotify.js:145-155`). Shorts, live
streams and upcoming streams are excluded. The best **three** candidates are shown, one per video.

Scoring, 0…1 (`spotify.js:99-120`):

| Part | Weight / rule |
| --- | --- |
| Title | 0.45 · (0.75 · matched title words / Spotify title words + 0.25 · matched / candidate words) |
| Artist | 0.25; full artist string found = 1, otherwise fraction of artist words found; 0.5 when Spotify has no artist |
| Duration | 0.30; full score within 2 s, linearly down to 0 at 30 s difference; 0.5 when either length is unknown |
| Variant penalty | ×0.5 for live, cover, remix, karaoke, instrumental, acoustic, sped up, slowed, reverb, 8D, nightcore, bass boosted, extended, mashup, reaction, tutorial, piano version, unless Spotify's own title has the same variant |
| YouTube Music bonus | +0.03, capped at 1 |

If the best score is below **0.6**, the preview warns that the match is weak. The user may still choose another
candidate or download the best one.

A Spotify job at download time repeats the match inside its own job, chooses the best source, downloads the audio,
then tags it with FFmpeg **without re-encoding**: title, artist, album artist, album, date, track, a comment naming
the Spotify page and the YouTube source, and the cover as an attached picture. If tagging fails, the untagged file
is kept rather than losing the download (`downloader.js:510-543`, `spotify.js:157-180`).

## 4. Queue, progress and cancellation

- Each preview action adds one job per selected item; an album can queue audio, video or cover for every selected
  song. Jobs run in the network lane; covers are light jobs; tagging switches the job to the CPU lane.
- Video downloads have two progress stages (video then audio) and report a combined percentage from yt-dlp's
  `--progress-template`. Audio has one stage; Spotify adds a search and a tagging stage.
- A finished file is copied to the destination chosen by the global save policy, not to a tool-specific folder. The
  dialog and the "Save to" control belong to that policy.
- Cancel stops the running process, deletes every partial file with the reserved stem, and leaves already finished
  items intact. A failed item reports the readable yt-dlp error and does not stop the rest of the queue.
- Halation's own yt-dlp copy may be updated at most once per day when the tool is opened (`downloader.js:85-96`),
  never by a background timer. A user-installed yt-dlp is not updated by Halation.

## 5. Native distribution (clean-room)

The native Downloader is a new Slint page and a Rust service; the Tauri page, markup, styles and JavaScript are
read only as a behaviour reference.

- **Slint:** URL input, preview card, quality/audio/cover choices, album track list, queue with per-item state,
  progress and cancel, engine-missing notice. No processing logic, scoring or file access in bindings.
- **Rust / core:** link parsing, public metadata fetch, yt-dlp invocation and parsing, matching and scoring,
  downloads, tag/cover processing, partial cleanup, destination selection and session state. Heavy work runs off the
  UI thread and returns through the event loop; callbacks hold weak references.
- **Jobs:** submit through the core queue (`net` lane for downloads and searches; light lane for covers; CPU stage
  for tagging), with cancellation tokens and generation checks so stale results are dropped.
- **Engine:** yt-dlp and FFmpeg are detected through the native component service. Missing components show the
  install path in Settings > Tools rather than failing at download time. Cutout remains optional.
- **Persistence:** the native session may remember the last preview and pending queue, but no copyrighted media or
  raw traces are stored. Tool settings are Rust-owned, never in a page instance. The Tauri tool has no named presets,
  so none are required for parity; the last choices are session state.

## 6. Acceptance criteria

1. A YouTube video link previews title, author, duration, heights and cover; the default quality is the first height
   ≤ 1080 or Best; the output is an MP4 that plays with video and audio.
2. A YouTube Music/SoundCloud/Bandcamp link lists its tracks (up to 300) and lets the user download selected tracks.
3. Audio "Original" keeps the source codec/container; MP3 produces VBR q0 and the UI does not call it an upgrade.
4. A Spotify track never downloads Spotify audio; the best match is chosen by the recorded score, a score below 0.6
   warns, and the saved M4A carries Spotify's tags and cover without re-encoding.
5. A Spotify album queues the selected songs and one cover; each song resolves independently.
6. Apple Music shows metadata/cover and the DRM notice; it never offers audio.
7. Cancelling a download removes every partial file; a failure in one queue item does not stop the others.
8. Cover output is PNG at the largest available artwork size.
9. Missing yt-dlp/FFmpeg produces a clear component message, not a crash or a silent failure.
10. The UI thread stays responsive during previews, searches and downloads; progress is real, not simulated.
11. Matching, title cleaning and argument construction are covered by unit tests with made-up titles, artists and
    IDs; no copyrighted fixtures are committed.

## 7. Out of scope

- Spotify or Apple Music audio, DRM circumvention, account login, cookies, private or paid content.
- More than 300 entries in one playlist operation, or downloading a whole channel.
- Converting the downloaded file to another format (Converter owns that), editing, cropping or upscaling.
- Background removal as a required dependency; Cutout is an optional follow-up.
- Browsing or searching a service inside the tool, recommendations, subscriptions, telemetry and cloud processing.
- Copying the Tauri Downloader's layout, styling, copy or interactions.

## 8. Open questions

1. Whether the native dialog exposes the same "Original/MP3" wording or a format list derived from the source; the
   functional rule (no re-encode for Original, VBR q0 for MP3) is fixed either way.
2. Whether the daily yt-dlp update is kept in the native first version or deferred until the component service can
   update safely; if kept, it must stay a one-per-day check on tool open, never a timer.
3. Whether an optional "remove background after download" chain is offered, given Cutout is optional.

## Sources

- Tauri: `main:app/dist/downloader.js`, `downloader.html`, `spotify.js`; `main:app/src-tauri/src/tools.rs`
  (yt-dlp/FFmpeg URLs and discovery), `web.rs` (`http_text`, `http_bytes`), `procs.rs` (`proc_start`),
  `save_location.rs`.
- Verified lines: `downloader.js:33-39,99-107,143-218,307-320,455-467,510-563`;
  `spotify.js:11-80,96-120,145-180`; `downloader.html:54,86-87`.
- Product rules: [AGENTS.md](../../AGENTS.md) (Spotify metadata only, no DRM circumvention), [converter.md](converter.md)
  for the shared FFmpeg provenance and licence reasoning, [save-location.md](save-location.md).
