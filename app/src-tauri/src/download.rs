//! Downloads of the external tools (tools.rs): TLS through the system, progress events, a stall limit
//! between reads, and unpacking the zips the tools come in.

use serde_json::json;
use std::{
    fs,
    io::{Read, Write},
    path::Path,
    sync::mpsc::{self, RecvTimeoutError},
    time::Duration,
};
use tauri::{AppHandle, Emitter};

pub(crate) fn agent() -> ureq::Agent {
    use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
    // The system TLS stack (SChannel on Windows) uses the certificates Windows trusts, proxies included
    let tls = TlsConfig::builder().provider(TlsProvider::NativeTls).root_certs(RootCerts::PlatformVerifier).build();
    ureq::Agent::config_builder()
        .tls_config(tls)
        .timeout_connect(Some(Duration::from_secs(20)))
        .timeout_recv_response(Some(Duration::from_secs(60)))
        .user_agent(concat!("Halation/", env!("CARGO_PKG_VERSION")))
        .build()
        .new_agent()
}

pub(crate) fn https_only(url: &str) -> Result<(), String> {
    if url.starts_with("https://") {
        Ok(())
    } else {
        Err("only https links are allowed".into())
    }
}

/// A download that receives nothing for this long fails; long downloads that keep moving never do.
/// ureq 3 has a timeout for the whole body but none between reads, and the FFmpeg zip can take minutes.
pub(crate) const STALL: Duration = Duration::from_secs(30);
/// Start of the error the pages recognise (shell.js) to show "the download stopped" with a retry.
pub(crate) const STALLED: &str = "stalled";

/// Downloads to a file, reporting progress as event "tool-progress" {tool, file, done, total}.
pub(crate) fn fetch_to(app: &AppHandle, tool: &str, url: &str, dest: &Path) -> Result<(), String> {
    let file = dest.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
    download(&agent(), url, dest, STALL, |done, total| {
        let _ = app.emit("tool-progress", json!({ "tool": tool, "file": file, "done": done, "total": total }));
    })
}

/// GET `url` into `dest` (through `dest.part`); `progress(done, total)` every 512 kB and at the end.
/// The body is read on its own thread and handed over in chunks, so a connection that stops sending is
/// noticed after `stall` although the blocked read never returns; that thread ends with the socket.
pub(crate) fn download(agent: &ureq::Agent, url: &str, dest: &Path, stall: Duration, mut progress: impl FnMut(u64, u64)) -> Result<(), String> {
    let resp = agent.get(url).call().map_err(|e| format!("{url}: {e}"))?;
    let total: u64 = resp.headers().get("Content-Length").and_then(|v| v.to_str().ok()).and_then(|v| v.parse().ok()).unwrap_or(0);
    let part = dest.with_extension("part");
    let mut out = fs::File::create(&part).map_err(|e| e.to_string())?;
    let mut reader = resp.into_body().into_reader();
    let (tx, rx) = mpsc::sync_channel::<Result<Vec<u8>, String>>(4);
    std::thread::spawn(move || loop {
        let mut buf = vec![0u8; 256 * 1024];
        let chunk = reader.read(&mut buf).map(|n| { buf.truncate(n); buf }).map_err(|e| e.to_string());
        let end = !matches!(&chunk, Ok(b) if !b.is_empty());
        if tx.send(chunk).is_err() || end {
            break;
        }
    });
    let (mut done, mut last) = (0u64, 0u64);
    let result = loop {
        let chunk = match rx.recv_timeout(stall) {
            Ok(Ok(b)) if b.is_empty() => break Ok(()),
            Ok(Ok(b)) => b,
            Ok(Err(e)) => break Err(e),
            Err(RecvTimeoutError::Timeout) => break Err(format!("{STALLED}: nothing received for {} s", stall.as_secs())),
            Err(RecvTimeoutError::Disconnected) => break Err("the connection closed".into()),
        };
        if let Err(e) = out.write_all(&chunk) {
            break Err(e.to_string());
        }
        done += chunk.len() as u64;
        if done - last > 512 * 1024 {
            last = done;
            progress(done, total);
        }
    };
    let result = result.and_then(|_| out.flush().map_err(|e| e.to_string())).and_then(|_| {
        if total > 0 && done < total { Err(format!("{url}: got {done} of {total} bytes")) } else { Ok(()) }
    });
    drop(out);
    if let Err(e) = result {
        let _ = fs::remove_file(&part);
        return Err(e);
    }
    progress(done, total.max(done));
    fs::rename(&part, dest).map_err(|e| e.to_string())
}

#[cfg(unix)]
pub(crate) fn make_executable(p: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(p, fs::Permissions::from_mode(0o755));
}
#[cfg(not(unix))]
pub(crate) fn make_executable(_: &Path) {}

/// Extracts the files that sit next to `wanted` inside the zip (wherever the archive puts it) into `dest`.
pub(crate) fn unzip_beside(zip_path: &Path, wanted: &[&str], dest: &Path) -> Result<usize, String> {
    let mut zip = zip::ZipArchive::new(fs::File::open(zip_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let names: Vec<String> = zip.file_names().map(String::from).collect();
    let main = names
        .iter()
        .find(|n| n.rsplit('/').next().is_some_and(|f| f.eq_ignore_ascii_case(wanted[0])))
        .ok_or_else(|| format!("{} is not in the download", wanted[0]))?;
    let folder = main.rsplit_once('/').map(|(d, _)| format!("{d}/")).unwrap_or_default();
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    let mut n = 0;
    for name in names.iter().filter(|n| n.starts_with(&folder) && !n.ends_with('/') && !n[folder.len()..].contains('/')) {
        let file_name = &name[folder.len()..];
        if wanted.len() > 1 && !wanted.iter().any(|w| w.eq_ignore_ascii_case(file_name)) {
            continue;
        }
        let mut entry = zip.by_name(name).map_err(|e| e.to_string())?;
        let target = dest.join(file_name);
        let mut out = fs::File::create(&target).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        make_executable(&target);
        n += 1;
    }
    Ok(n)
}

/// The one file of a .tar.gz whose path ends with `suffix` ("bin/pdfium.dll"), written to `dest`
pub(crate) fn untar_one(archive: &Path, suffix: &str, dest: &Path) -> Result<(), String> {
    let gz = flate2::read::GzDecoder::new(fs::File::open(archive).map_err(|e| e.to_string())?);
    let mut tar = tar::Archive::new(gz);
    for entry in tar.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?.to_string_lossy().replace('\\', "/");
        if path.ends_with(suffix) && entry.header().entry_type().is_file() {
            if let Some(d) = dest.parent() {
                fs::create_dir_all(d).map_err(|e| e.to_string())?;
            }
            let part = dest.with_extension("part");
            let mut out = fs::File::create(&part).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            drop(out);
            fs::rename(&part, dest).map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    Err(format!("{suffix} is not in the download"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unzip_takes_the_folder_of_the_main_file() {
        let d = std::env::temp_dir().join(format!("halation-zip-{}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        let zp = d.join("t.zip");
        {
            let mut z = zip::ZipWriter::new(fs::File::create(&zp).unwrap());
            let o = zip::write::SimpleFileOptions::default();
            for (n, c) in [("pkg/bin/tool", "1"), ("pkg/bin/lib.dll", "2"), ("pkg/doc/readme", "3")] {
                z.start_file(n, o).unwrap();
                z.write_all(c.as_bytes()).unwrap();
            }
            z.finish().unwrap();
        }
        let out = d.join("out");
        assert_eq!(unzip_beside(&zp, &["tool"], &out).unwrap(), 2);
        assert!(out.join("lib.dll").is_file() && !out.join("readme").exists());
        let _ = fs::remove_dir_all(&d);
    }

    /// A local server that sends the body up to `stop_at`, waits `hold` with the socket open, then sends the rest.
    fn serve(body: Vec<u8>, stop_at: usize, hold: Duration) -> String {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = l.local_addr().unwrap();
        std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let _ = s.read(&mut [0u8; 1024]);
            let _ = write!(s, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
            for c in body[..stop_at].chunks(64 * 1024) {
                let _ = s.write_all(c);
                std::thread::sleep(Duration::from_millis(20));
            }
            std::thread::sleep(hold);
            let _ = s.write_all(&body[stop_at..]);
        });
        format!("http://{addr}/file.bin")
    }

    fn plain_agent() -> ureq::Agent {
        ureq::Agent::config_builder().timeout_recv_response(Some(Duration::from_secs(5))).build().new_agent()
    }

    #[test]
    fn a_download_that_stops_sending_fails_as_stalled() {
        let d = std::env::temp_dir().join(format!("halation-stall-{}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        let url = serve(vec![7u8; 1 << 20], 3 << 18, Duration::from_secs(10));
        let dest = d.join("file.bin");
        let (t0, mut seen) = (std::time::Instant::now(), 0);
        let err = download(&plain_agent(), &url, &dest, Duration::from_secs(1), |done, _| seen = done).unwrap_err();
        assert!(err.starts_with(STALLED), "{err}");
        assert!(t0.elapsed() < Duration::from_secs(5), "noticed after {:?}", t0.elapsed());
        assert!(seen > 0 && !dest.exists() && !dest.with_extension("part").exists());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn a_slow_download_that_keeps_moving_completes() {
        let d = std::env::temp_dir().join(format!("halation-slow-{}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        // each chunk arrives well within the limit, the whole download takes longer than it
        let body: Vec<u8> = (0..(1u32 << 20)).map(|i| i as u8).collect();
        let url = serve(body.clone(), 1 << 19, Duration::from_millis(600));
        let dest = d.join("file.bin");
        download(&plain_agent(), &url, &dest, Duration::from_secs(1), |_, _| {}).unwrap();
        assert_eq!(fs::read(&dest).unwrap(), body);
        let _ = fs::remove_dir_all(&d);
    }
}
