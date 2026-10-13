//! Web requests for previews and covers (https only, size-limited).

use crate::download::*;
use tauri::ipc::Response;
use serde::{Deserialize, Serialize};
use std::{sync::{atomic::{AtomicUsize, Ordering}, mpsc}, time::Duration};

// Public pages (YouTube, SoundCloud, Spotify) answer a desktop browser with the page the profile readers expect;
// the cookies skip YouTube's consent page in the EU.
const BROWSER_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const CONSENT: &str = "CONSENT=YES+cb; SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg";

fn get(url: &str, browser: bool) -> Result<ureq::http::Response<ureq::Body>, String> {
    let req = agent().get(url);
    let req = if browser {
        req.header("User-Agent", BROWSER_UA).header("Accept-Language", "en-US,en;q=0.9").header("Cookie", CONSENT)
    } else {
        req
    };
    req.call().map_err(|e| e.to_string())
}

/// Text of an https page or API (oEmbed, iTunes lookup), up to 4 MB. `browser`: sent as a desktop browser.
#[tauri::command]
pub async fn http_text(url: String, browser: Option<bool>) -> Result<String, String> {
    https_only(&url)?;
    tauri::async_runtime::spawn_blocking(move || {
        let resp = get(&url, browser.unwrap_or(false))?;
        resp.into_body().with_config().limit(4 << 20).read_to_string().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Bytes of an https image, up to 60 MB.
#[tauri::command]
pub async fn http_bytes(url: String, browser: Option<bool>) -> Result<Response, String> {
    https_only(&url)?;
    tauri::async_runtime::spawn_blocking(move || {
        let resp = get(&url, browser.unwrap_or(false))?;
        let v = resp.into_body().with_config().limit(60 << 20).read_to_vec().map_err(|e| e.to_string())?;
        Ok(Response::new(v))
    })
    .await
    .map_err(|e| e.to_string())?
}

/* ---------- Spotify public artist counters ---------- */
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpotifyArtistMetrics {
    artist_id: String,
    monthly_listeners: Option<u64>,
    tracks: Vec<SpotifyTrackPlays>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct SpotifyTrackPlays {
    id: String,
    plays: Option<u64>,
}

fn spotify_id(id: &str) -> bool {
    id.len() == 22 && id.bytes().all(|b| b.is_ascii_alphanumeric())
}

fn spotify_metrics_payload(json: &str, artist_id: &str) -> Result<SpotifyArtistMetrics, String> {
    if json.len() > 16_384 { return Err("Spotify counters exceed the size limit".into()); }
    let metrics: SpotifyArtistMetrics = serde_json::from_str(json).map_err(|e| e.to_string())?;
    if metrics.artist_id != artist_id || metrics.tracks.len() > 10 || metrics.tracks.iter().any(|t| !spotify_id(&t.id)) {
        return Err("Spotify counters do not match the requested artist".into());
    }
    Ok(metrics)
}

/// A short-lived anonymous page observes only the public artist response; it has no app IPC capability.
#[tauri::command]
pub async fn spotify_artist_metrics(app: tauri::AppHandle, artist_id: String) -> Result<SpotifyArtistMetrics, String> {
    if !spotify_id(&artist_id) { return Err("invalid Spotify artist id".into()); }
    static NEXT: AtomicUsize = AtomicUsize::new(1);
    let label = format!("spotify-metrics-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let url = format!("https://open.spotify.com/artist/{artist_id}").parse::<tauri::Url>().map_err(|e| e.to_string())?;
    let script = include_str!("spotify-metrics.js").replace("__HALATION_SPOTIFY_ARTIST_ID__", &artist_id);
    let (tx, rx) = mpsc::channel();
    let requested = artist_id.clone();
    let window = tauri::WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::External(url))
        .visible(false).focused(false).skip_taskbar(true).incognito(true)
        .inner_size(1280.0, 900.0)
        .initialization_script(&script)
        .on_navigation(move |url| {
            if url.host_str() == Some("halation-spotify.invalid") && url.path() == "/metrics" {
                if let Some((_, json)) = url.query_pairs().find(|(k, _)| k == "data") {
                    let _ = tx.send(spotify_metrics_payload(&json, &requested));
                }
                return false;
            }
            url.scheme() == "https" && url.host_str() == Some("open.spotify.com")
        })
        .build().map_err(|e| e.to_string())?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(Duration::from_secs(45)).map_err(|_| "Spotify artist counters timed out".to_string())?
    }).await.map_err(|e| e.to_string()).and_then(|r| r);
    // Destroy bypasses the main window's close-confirmation flow, including after a timeout.
    let _ = window.destroy();
    result
}

#[cfg(test)]
mod spotify_tests {
    use super::*;
    #[test]
    fn counters_are_scoped_to_the_requested_artist() {
        let id = "3W3dTmUEXbo2D9CQzNTSaI";
        assert!(spotify_id(id));
        assert!(!spotify_id("../artist"));
        let json = format!(r#"{{"artistId":"{id}","monthlyListeners":0,"tracks":[{{"id":"4dTmQfqA75KrfynUF1TUX9","plays":0}}]}}"#);
        let metrics = spotify_metrics_payload(&json, id).unwrap();
        assert_eq!(metrics.monthly_listeners, Some(0));
        assert_eq!(metrics.tracks[0].plays, Some(0));
        assert!(spotify_metrics_payload(&json, "24PhFqIM2MOH9oAVnPzfRe").is_err());
        assert!(spotify_metrics_payload(&"x".repeat(16_385), id).is_err());
    }
}
