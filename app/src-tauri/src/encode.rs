//! Streaming export through FFmpeg (docs/ARCHITECTURE.md → Export).
//! The page renders frames and sends each one as raw bytes (RGBA, or any raw format the arguments describe);
//! they go straight to the stdin of an FFmpeg process, one process per output file, without piling up in memory:
//! a small bounded queue per process keeps the page from running ahead of the encoder.
//! FFmpeg runs without a console window; its progress (frames written) reaches the page as event "encode".
//! The FFmpeg of Tools is used (the Downloader installs it); the arguments come from the page (encoder.js),
//! the output path must be inside the Halation folder.

use crate::{base_dir, dir, file_stem, header, hold, raw_body};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicU32, Ordering},
        mpsc::{sync_channel, SyncSender},
        Arc, Mutex,
    },
    thread::JoinHandle,
};
use tauri::{ipc::Request, AppHandle, Emitter, State};

/// Frames waiting for FFmpeg per process. Enough to keep it busy while the page renders the next one.
const QUEUE: usize = 3;
static NEXT_ENCODER: AtomicU32 = AtomicU32::new(1);

/// Size of the raw frames of an encoder, so a frame can be sent as a rectangle (the rest is transparent)
#[derive(Deserialize, Clone, Copy)]
pub struct FrameSpec {
    pub width: u32,
    pub height: u32,
    pub bpp: u32,
}

struct Encoder {
    child: Arc<Mutex<Child>>,
    tx: Option<SyncSender<Arc<Vec<u8>>>>,
    writer: Option<JoinHandle<Result<(), String>>>,
    stderr: Arc<Mutex<Vec<String>>>,
    frame: Option<FrameSpec>,
    last: Option<Arc<Vec<u8>>>,
    output: PathBuf,
    is_dir: bool,
}

#[derive(Default)]
pub struct Encoders {
    map: Mutex<HashMap<u32, Encoder>>,
    folders: Mutex<HashSet<PathBuf>>,
}

/// Output inside the Halation folder, with a parent that exists (or a folder to create for image sequences).
fn check_output(app: &AppHandle, output: &str, is_dir: bool) -> Result<PathBuf, String> {
    let base = base_dir(app)?.canonicalize().map_err(|e| e.to_string())?;
    let p = PathBuf::from(output);
    let folder = if is_dir { p.parent().and_then(Path::parent) } else { p.parent() }.ok_or("invalid output path")?;
    let folder = folder.canonicalize().map_err(|_| "the export folder does not exist".to_string())?;
    if !folder.starts_with(&base) && !crate::save_location::allows(app, &p) {
        return Err("path outside the Halation folder".into());
    }
    if is_dir {
        let d = p.parent().ok_or("invalid output path")?;
        fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    Ok(p)
}

/// The full command line: fixed options first, the page's arguments, the output last.
pub fn command_line(args: &[String], output: &Path) -> Vec<String> {
    let mut v: Vec<String> = ["-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", "-y"].iter().map(|s| s.to_string()).collect();
    v.extend(args.iter().cloned());
    v.push(output.to_string_lossy().into_owned());
    v
}

/// A rectangle of pixels placed on a transparent frame
pub fn place_rect(spec: FrameSpec, rect: (u32, u32, u32, u32), data: &[u8]) -> Result<Vec<u8>, String> {
    let (x, y, w, h) = rect;
    let bpp = spec.bpp as usize;
    if x + w > spec.width || y + h > spec.height || data.len() != (w * h) as usize * bpp {
        return Err("frame rectangle does not fit".into());
    }
    let stride = spec.width as usize * bpp;
    let mut out = vec![0u8; stride * spec.height as usize];
    let row = w as usize * bpp;
    for r in 0..h as usize {
        let dst = (y as usize + r) * stride + x as usize * bpp;
        out[dst..dst + row].copy_from_slice(&data[r * row..(r + 1) * row]);
    }
    Ok(out)
}

fn parse_rect(s: &str) -> Option<(u32, u32, u32, u32)> {
    let v: Vec<u32> = s.split(',').filter_map(|p| p.trim().parse().ok()).collect();
    (v.len() == 4).then(|| (v[0], v[1], v[2], v[3]))
}

#[derive(Serialize)]
pub struct Started {
    id: u32,
    path: String,
}

/// Starts FFmpeg: `args` are its input and output options (without the output file), `output` the file
/// (or, with `dir`, a pattern such as ...\03 Text\%05d.png whose folder is created). `frame` enables
/// frames sent as rectangles and repeated frames.
#[tauri::command]
pub fn encode_start(
    app: AppHandle,
    encoders: State<'_, Encoders>,
    args: Vec<String>,
    output: String,
    frame: Option<FrameSpec>,
    dir: Option<bool>,
) -> Result<Started, String> {
    let is_dir = dir.unwrap_or(false);
    let output = check_output(&app, &output, is_dir)?;
    let bin = crate::tools::find_ffmpeg(&app).ok_or("FFmpeg not installed")?;
    let mut cmd = Command::new(&bin);
    cmd.args(command_line(&args, &output)).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(crate::tools::CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().map_err(|e| format!("{}: {e}", bin.display()))?;
    let id = NEXT_ENCODER.fetch_add(1, Ordering::Relaxed);
    let mut stdin = child.stdin.take().ok_or("no input")?;
    let stdout = child.stdout.take().ok_or("no output")?;
    let stderr_pipe = child.stderr.take().ok_or("no output")?;
    // progress: "frame=N" lines of -progress
    let a = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(n) = line.strip_prefix("frame=").and_then(|v| v.trim().parse::<u64>().ok()) {
                let _ = a.emit("encode", json!({ "id": id, "frame": n }));
            }
        }
    });
    let stderr = Arc::new(Mutex::new(Vec::new()));
    let keep = stderr.clone();
    std::thread::spawn(move || {
        let mut s = String::new();
        let _ = BufReader::new(stderr_pipe).read_to_string(&mut s);
        let mut k = hold(&keep);
        k.extend(s.lines().filter(|l| !l.trim().is_empty()).map(str::to_string));
        let n = k.len();
        if n > 20 {
            k.drain(..n - 20);
        }
    });
    let (tx, rx) = sync_channel::<Arc<Vec<u8>>>(QUEUE);
    let writer = std::thread::spawn(move || {
        for buf in rx {
            stdin.write_all(&buf).map_err(|e| e.to_string())?;
        }
        stdin.flush().map_err(|e| e.to_string())
        // stdin drops here: FFmpeg sees the end of the stream
    });
    let path = output.to_string_lossy().into_owned();
    hold(&encoders.map).insert(
        id,
        Encoder { child: Arc::new(Mutex::new(child)), tx: Some(tx), writer: Some(writer), stderr, frame, last: None, output, is_dir },
    );
    Ok(Started { id, path })
}

fn failure(e: &Encoder, fallback: &str) -> String {
    let lines = hold(&e.stderr);
    lines.last().cloned().unwrap_or_else(|| fallback.to_string())
}

/// One frame (or any chunk of raw data) for an encoder. Headers: x-id; x-rect "x,y,w,h" when the body is only
/// that rectangle of the frame; x-same "1" (no body) to repeat the previous frame.
#[tauri::command]
pub async fn encode_write(encoders: State<'_, Encoders>, request: Request<'_>) -> Result<(), String> {
    let id: u32 = header(&request, "x-id").parse().map_err(|_| "unknown encoder")?;
    let same = header(&request, "x-same") == "1";
    let rect = parse_rect(&header(&request, "x-rect"));
    // the lock is held only to read the encoder; the frame is assembled outside it (layers arrive in parallel)
    let (tx, frame, last) = {
        let map = hold(&encoders.map);
        let e = map.get(&id).ok_or("encoder already closed")?;
        (e.tx.clone().ok_or("encoder already finished")?, e.frame, e.last.clone())
    };
    let buf = if same {
        last.ok_or("no previous frame")?
    } else {
        let data = raw_body(&request)?;
        Arc::new(match (rect, frame) {
            (Some(r), Some(spec)) => place_rect(spec, r, data)?,
            _ => data.to_vec(),
        })
    };
    if frame.is_some() && !same {
        if let Some(e) = hold(&encoders.map).get_mut(&id) {
            e.last = Some(buf.clone());
        }
    }
    let sent = tauri::async_runtime::spawn_blocking(move || tx.send(buf).is_ok()).await.map_err(|e| e.to_string())?;
    if sent {
        return Ok(());
    }
    // the writer stopped: FFmpeg closed its input (an error, usually)
    let map = hold(&encoders.map);
    Err(map.get(&id).map(|e| failure(e, "FFmpeg stopped")).unwrap_or_else(|| "encoder already closed".into()))
}

#[derive(Serialize)]
pub struct Finished {
    path: String,
    size: u64,
}

fn size_of(p: &Path, is_dir: bool) -> u64 {
    if is_dir {
        let d = p.parent().unwrap_or(p);
        fs::read_dir(d).map(|rd| rd.flatten().filter_map(|e| e.metadata().ok()).map(|m| m.len()).sum()).unwrap_or(0)
    } else {
        fs::metadata(p).map(|m| m.len()).unwrap_or(0)
    }
}

/// Closes the input and waits for FFmpeg to finish the file.
#[tauri::command]
pub async fn encode_finish(encoders: State<'_, Encoders>, id: u32) -> Result<Finished, String> {
    let mut e = hold(&encoders.map).remove(&id).ok_or("encoder already closed")?;
    e.tx.take();
    let writer = e.writer.take();
    let child = e.child.clone();
    let (written, status) = tauri::async_runtime::spawn_blocking(move || {
        let w = writer.map(|h| h.join().unwrap_or_else(|_| Err("writer failed".into()))).unwrap_or(Ok(()));
        let s = hold(&child).wait().map_err(|e| e.to_string());
        (w, s)
    })
    .await
    .map_err(|e| e.to_string())?;
    // give the stderr reader a moment to collect the last lines
    std::thread::sleep(std::time::Duration::from_millis(30));
    let status = status?;
    if !status.success() || written.is_err() {
        let msg = failure(&e, &written.err().unwrap_or_else(|| format!("FFmpeg exited with {status}")));
        remove_output(&e);
        return Err(msg);
    }
    Ok(Finished { path: e.output.to_string_lossy().into_owned(), size: size_of(&e.output, e.is_dir) })
}

fn remove_output(e: &Encoder) {
    if e.is_dir {
        if let Some(d) = e.output.parent() {
            let _ = fs::remove_dir_all(d);
        }
    } else {
        let _ = fs::remove_file(&e.output);
    }
}

/// Stops FFmpeg and deletes what it wrote.
#[tauri::command]
pub fn encode_abort(encoders: State<'_, Encoders>, id: u32) -> Result<(), String> {
    let Some(mut e) = hold(&encoders.map).remove(&id) else { return Ok(()) };
    e.tx.take();
    let _ = hold(&e.child).kill();
    let _ = hold(&e.child).wait();
    if let Some(w) = e.writer.take() {
        let _ = w.join();
    }
    remove_output(&e);
    Ok(())
}

/// Closing the app: every export still writing stops and leaves no partial file.
pub(crate) fn abort_all(encoders: &Encoders) {
    let all: Vec<Encoder> = hold(&encoders.map).drain().map(|(_, e)| e).collect();
    for mut e in all {
        e.tx.take();
        let _ = hold(&e.child).kill();
        let _ = hold(&e.child).wait();
        if let Some(w) = e.writer.take() {
            let _ = w.join();
        }
        remove_output(&e);
    }
}

/// A new folder for an export with several files: Exports\Videos\<name>, or "<name> (2)"… if it exists.
#[tauri::command]
pub fn export_folder(app: AppHandle, encoders: State<'_, Encoders>, name: String, destination: Option<String>) -> Result<String, String> {
    let videos = dir(&app, &["Exports", "Videos"])?;
    let stem = file_stem(&name);
    let path = std::iter::once(stem.clone())
        .chain((2..).map(|n| format!("{stem} ({n})")))
        .map(|s| videos.join(s))
        .find(|p| !p.exists())
        .ok_or("no free folder name")?;
    let path = if let Some(p) = destination { let p = PathBuf::from(p); if !crate::save_location::allows(&app, &p) { return Err("Destination was not selected".into()); } p } else { path };
    fs::create_dir(&path).map_err(|e| e.to_string())?;
    hold(&encoders.folders).insert(path.clone());
    Ok(path.to_string_lossy().into_owned())
}

/// Removes a folder made by export_folder in this session (a cancelled or failed export).
#[tauri::command]
pub fn export_folder_remove(encoders: State<'_, Encoders>, path: String) -> Result<bool, String> {
    let p = PathBuf::from(&path);
    if !hold(&encoders.folders).remove(&p) {
        return Err("not an export folder of this session".into());
    }
    fs::remove_dir_all(&p).map(|_| true).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rectangles_land_on_a_transparent_frame() {
        let spec = FrameSpec { width: 4, height: 3, bpp: 4 };
        let px = [9u8; 2 * 2 * 4];
        let out = place_rect(spec, (1, 1, 2, 2), &px).unwrap();
        assert_eq!(out.len(), 4 * 3 * 4);
        let at = |x: usize, y: usize| out[(y * 4 + x) * 4];
        assert_eq!((at(0, 0), at(1, 1), at(2, 2), at(3, 2), at(1, 0)), (0, 9, 9, 0, 0));
        assert!(place_rect(spec, (3, 0, 2, 1), &[0; 8]).is_err());
        assert!(place_rect(spec, (0, 0, 1, 1), &[0; 3]).is_err());
        assert_eq!(parse_rect("1, 2,3,4"), Some((1, 2, 3, 4)));
        assert_eq!(parse_rect("1,2"), None);
    }

    #[test]
    fn output_goes_last() {
        let v = command_line(&["-i".into(), "pipe:0".into()], Path::new("/x/a.mov"));
        assert_eq!(v.last().unwrap(), "/x/a.mov");
        assert!(v.contains(&"pipe:1".to_string()) && v.contains(&"-y".to_string()));
    }

    #[test]
    fn free_space_of_the_temp_folder() {
        assert!(crate::system::free_space(&std::env::temp_dir()).unwrap() > 0);
    }

    /// Streams RGBA frames with alpha through a real FFmpeg (skipped when it is not installed)
    #[test]
    fn prores_4444_keeps_alpha() {
        let Ok(out) = Command::new("ffmpeg").arg("-version").output() else { return };
        if !out.status.success() {
            return;
        }
        let d = std::env::temp_dir().join(format!("halation-encode-{}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        let file = d.join("t.mov");
        let args: Vec<String> = "-f rawvideo -pix_fmt rgba -s 32x16 -r 30 -i pipe:0 -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le"
            .split(' ')
            .map(String::from)
            .collect();
        let mut child = Command::new("ffmpeg").args(command_line(&args, &file)).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().unwrap();
        {
            let mut stdin = child.stdin.take().unwrap();
            let spec = FrameSpec { width: 32, height: 16, bpp: 4 };
            for _ in 0..6 {
                stdin.write_all(&place_rect(spec, (4, 4, 8, 8), &[200u8; 8 * 8 * 4]).unwrap()).unwrap();
            }
        }
        assert!(child.wait().unwrap().success());
        let probe = Command::new("ffprobe")
            .args(["-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=codec_name,pix_fmt,nb_read_frames", "-of", "csv=p=0"])
            .arg(&file)
            .output();
        if let Ok(p) = probe {
            let s = String::from_utf8_lossy(&p.stdout);
            assert!(s.contains("prores") && s.contains("yuva444p") && s.contains(",6"), "{s}");
        }
        let _ = fs::remove_dir_all(&d);
    }
}
