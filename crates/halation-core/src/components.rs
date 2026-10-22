//! FFmpeg lookup and on-demand installation, adapted from Tauri tools.rs/download.rs.
//! Network access occurs only in an explicitly requested installation job.
use crate::{convert::quiet, engine::TaskContext};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

pub const FFMPEG_URL: &str = "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";

#[derive(Debug, Clone)]
pub struct Ffmpeg {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
}

impl Ffmpeg {
    /// Only complete pairs are accepted, preventing a partial installation from appearing ready.
    pub fn in_directory(dir: &Path) -> Option<Self> {
        let suffix = if cfg!(windows) { ".exe" } else { "" };
        let ffmpeg = dir.join(format!("ffmpeg{suffix}"));
        let ffprobe = dir.join(format!("ffprobe{suffix}"));
        (ffmpeg.is_file() && ffprobe.is_file()).then_some(Self { ffmpeg, ffprobe })
    }

    pub fn find(tools: &Path) -> Option<Self> {
        Self::in_directory(&tools.join("ffmpeg")).or_else(|| {
            std::env::var_os("PATH").and_then(|path| {
                std::env::split_paths(&path).find_map(|dir| Self::in_directory(&dir))
            })
        })
    }
}

/// Extract only a complete binary pair. Archive paths never become output paths.
fn extract(archive: &Path, destination: &Path) -> Result<(), String> {
    let mut zip = zip::ZipArchive::new(fs::File::open(archive).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    for wanted in ["ffmpeg.exe", "ffprobe.exe"] {
        let indices: Vec<_> = (0..zip.len())
            .filter(|i| {
                zip.by_index(*i).ok().is_some_and(|f| {
                    !f.is_dir()
                        && f.enclosed_name()
                            .and_then(|p| p.file_name().map(|n| n.eq_ignore_ascii_case(wanted)))
                            .unwrap_or(false)
                })
            })
            .collect();
        if indices.len() != 1 {
            return Err(format!("Download must contain exactly one {wanted}"));
        }
        let mut entry = zip.by_index(indices[0]).map_err(|e| e.to_string())?;
        if entry.size() == 0 || entry.size() > 512 * 1024 * 1024 {
            return Err("Invalid component size".into());
        }
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(destination.join(wanted))
            .map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut file).map_err(|e| e.to_string())?;
        file.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn install_ffmpeg(context: &TaskContext, tools: &Path, workspace: &Path) -> Result<(), String> {
    if !cfg!(windows) {
        return Err("Install FFmpeg and ffprobe with your package manager".into());
    }
    if Ffmpeg::find(tools).is_some() {
        return Ok(());
    }
    context.check_cancelled()?;
    fs::create_dir_all(workspace).map_err(|e| e.to_string())?;
    let archive = workspace.join("ffmpeg.zip.part");
    let staging = workspace.join("ffmpeg");
    let result = (|| {
        use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
        let agent = ureq::Agent::config_builder()
            .tls_config(
                TlsConfig::builder()
                    .provider(TlsProvider::NativeTls)
                    .root_certs(RootCerts::PlatformVerifier)
                    .build(),
            )
            .timeout_connect(Some(Duration::from_secs(20)))
            .timeout_recv_response(Some(Duration::from_secs(60)))
            .timeout_recv_body(Some(Duration::from_secs(20 * 60)))
            .user_agent(concat!("Halation/", env!("CARGO_PKG_VERSION")))
            .build()
            .new_agent();
        context.progress(None, "Downloading FFmpeg");
        let response = agent.get(FFMPEG_URL).call().map_err(|e| e.to_string())?;
        let total = response
            .headers()
            .get("Content-Length")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        let mut reader = response.into_body().into_reader();
        let (tx, rx) = std::sync::mpsc::sync_channel(4);
        // A bounded channel keeps memory fixed. A stalled socket cannot block the job or shutdown.
        std::thread::Builder::new()
            .name("component-download".into())
            .spawn(move || {
                loop {
                    let mut buffer = vec![0; 256 * 1024];
                    let result = reader
                        .read(&mut buffer)
                        .map(|n| {
                            buffer.truncate(n);
                            buffer
                        })
                        .map_err(|e| e.to_string());
                    let end = !matches!(&result, Ok(b) if !b.is_empty());
                    if tx.send(result).is_err() || end {
                        break;
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        let mut output = fs::File::create(&archive).map_err(|e| e.to_string())?;
        let mut done = 0_u64;
        let mut last_byte = std::time::Instant::now();
        let mut last_progress = std::time::Instant::now();
        loop {
            context.check_cancelled()?;
            let buffer = match rx.recv_timeout(Duration::from_millis(250)) {
                Ok(Ok(b)) if b.is_empty() => break,
                Ok(Ok(b)) => b,
                Ok(Err(e)) => return Err(e),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout)
                    if last_byte.elapsed() < Duration::from_secs(30) =>
                {
                    continue;
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    return Err("Download stalled: no data received for 30 seconds".into());
                }
                Err(_) => return Err("The download connection closed".into()),
            };
            last_byte = std::time::Instant::now();
            done += buffer.len() as u64;
            if done > 512 * 1024 * 1024 {
                return Err("Component download exceeds the size limit".into());
            }
            output.write_all(&buffer).map_err(|e| e.to_string())?;
            if last_progress.elapsed() >= Duration::from_millis(100) {
                context.progress(
                    (total > 0).then_some((done as f64 / total.max(1) as f64 * 0.9) as f32),
                    "Downloading FFmpeg",
                );
                last_progress = std::time::Instant::now();
            }
        }
        if total > 0 && total != done {
            return Err("Incomplete component download".into());
        }
        output.flush().map_err(|e| e.to_string())?;
        drop(output);
        context.check_cancelled()?;
        fs::create_dir(&staging).map_err(|e| e.to_string())?;
        context.progress(Some(0.92), "Extracting FFmpeg");
        extract(&archive, &staging)?;
        // Do not publish corrupt or non-executable downloads as installed.
        for name in ["ffmpeg.exe", "ffprobe.exe"] {
            context.check_cancelled()?;
            if !quiet(Command::new(staging.join(name)).arg("-version"))
                .status()
                .map_err(|e| e.to_string())?
                .success()
            {
                return Err(format!("{name} could not be verified"));
            }
        }
        context.check_cancelled()?;
        fs::create_dir_all(tools).map_err(|e| e.to_string())?;
        context
            .complete(|| fs::rename(&staging, tools.join("ffmpeg")).map_err(|e| e.to_string()))?;
        Ok(())
    })();
    let _ = fs::remove_file(&archive);
    // Only our two generated staging files are cleaned; never walk or delete unrelated paths.
    for name in ["ffmpeg.exe", "ffprobe.exe"] {
        let _ = fs::remove_file(staging.join(name));
    }
    let _ = fs::remove_dir(staging);
    let _ = fs::remove_dir(workspace);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn incomplete_pair_is_not_available() {
        let root = std::env::temp_dir().join(format!("halation-pair-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let suffix = if cfg!(windows) { ".exe" } else { "" };
        let file = root.join(format!("ffmpeg{suffix}"));
        fs::write(&file, b"test").unwrap();
        assert!(Ffmpeg::in_directory(&root).is_none());
        fs::remove_file(file).unwrap();
        fs::remove_dir(root).unwrap();
    }
}
