//! Running the external tools without a console window; their output goes to the page line by line (event "proc").

use crate::{paths::*, tools::*};
use serde_json::json;
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};

/// The processes running, and the jobs they belong to (jobs.js): cancelling a job kills all of its processes and
/// their children (a Windows Job Object per job; a process group elsewhere).
#[derive(Default)]
pub struct Procs(pub Mutex<HashMap<u32, Arc<Mutex<Child>>>>, pub Mutex<HashMap<String, Tree>>);
pub(crate) static NEXT_PROC: AtomicU32 = AtomicU32::new(1);

/// The processes of one job (or of one process started outside a job)
#[derive(Default)]
pub struct Tree {
    pids: Vec<u32>,
    #[cfg(windows)]
    handle: Option<isize>,
}

/// Calls `f` with every line of `src`, splitting on \n and \r (progress lines often end with \r).
pub(crate) fn for_each_line(src: impl Read, mut f: impl FnMut(String)) {
    let mut r = BufReader::new(src);
    let mut line = Vec::new();
    let mut send = |line: &mut Vec<u8>| {
        if !line.is_empty() {
            f(String::from_utf8_lossy(line).trim_end().to_string());
            line.clear();
        }
    };
    loop {
        let buf = match r.fill_buf() {
            Ok([]) | Err(_) => break,
            Ok(b) => b,
        };
        let n = buf.len();
        for &c in buf {
            if c == b'\n' || c == b'\r' {
                send(&mut line);
            } else {
                line.push(c);
            }
        }
        r.consume(n);
    }
    send(&mut line);
}

/// Sends each output line to the page as event "proc" {id, stream, line}.
pub(crate) fn pump(app: AppHandle, id: u32, stream: &'static str, src: impl Read + Send + 'static) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        for_each_line(src, |line| {
            let _ = app.emit("proc", json!({ "id": id, "stream": stream, "line": line }));
        })
    })
}

/// tool: "upscaler" | "span" | "ffprobe" | "ytdlp" | "ffmpeg" | "rife" | "pandoc" | "soffice"; args are passed as they are (no shell). low: below normal priority (work in
/// the background, such as Frame Grab's strip and analysis, gives way to what the user is doing). job: the job it belongs to
/// (proc_kill_job ends them all). Returns the process id; its "done" event carries its highest memory (peakMB).
#[tauri::command]
pub fn proc_start(app: AppHandle, procs: State<'_, Procs>, tool: String, args: Vec<String>, low: Option<bool>, job: Option<String>) -> Result<u32, String> {
    let (bin, extra): (PathBuf, Vec<String>) = match tool.as_str() {
        "upscaler" => (find_upscaler(&app).ok_or("upscaler not installed")?.bin, vec![]),
        "span" => (find_span(&app).ok_or("SPAN ch52 not available")?.bin, vec![]),
        "ffprobe" => (find_ffprobe(&app).ok_or("FFprobe not available")?, vec![]),
        "ytdlp" => {
            let bin = find_ytdlp(&app).ok_or("yt-dlp not installed")?;
            // yt-dlp finds FFmpeg next to it or in PATH; point it at Halation's copy when there is one
            let ff = tools_dir(&app)?.join("ffmpeg");
            let extra = if ff.join(exe("ffmpeg")).is_file() { vec!["--ffmpeg-location".into(), ff.to_string_lossy().into_owned()] } else { vec![] };
            (bin, extra)
        }
        "ffmpeg" => (find_ffmpeg(&app).ok_or("FFmpeg not installed")?, vec![]),
        "rife" => (crate::interp::find_rife(&app).ok_or("RIFE not installed")?.bin, vec![]),
        "pandoc" => (find_pandoc(&app).ok_or("Pandoc not installed")?, vec![]),
        "soffice" => (find_soffice(&app).ok_or("LibreOffice not installed")?, vec![]),
        _ => return Err(format!("unknown tool {tool}")),
    };
    let mut cmd = Command::new(&bin);
    cmd.args(extra).args(&args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(d) = bin.parent() {
        cmd.current_dir(d);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;
        cmd.creation_flags(CREATE_NO_WINDOW | if low.unwrap_or(false) { BELOW_NORMAL_PRIORITY_CLASS } else { 0 });
    }
    // its own process group: killing the group ends the children it started too
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
        if low.unwrap_or(false) {
            // SAFETY: nice() only changes the priority of the child between fork and exec.
            unsafe {
                cmd.pre_exec(|| {
                    libc::nice(10);
                    Ok(())
                });
            }
        }
    }
    let mut child = cmd.spawn().map_err(|e| format!("{}: {e}", bin.display()))?;
    let id = NEXT_PROC.fetch_add(1, Ordering::Relaxed);
    let pid = child.id();
    let key = job.filter(|j| crate::workspace::valid_key(j)).unwrap_or_else(|| format!("p{id}"));
    {
        let mut trees = hold(&procs.1);
        let tree = trees.entry(key.clone()).or_default();
        tree.pids.push(pid);
        #[cfg(windows)]
        win::assign(tree, &child);
    }
    let out = pump(app.clone(), id, "out", child.stdout.take().ok_or("no output")?);
    let err = pump(app.clone(), id, "err", child.stderr.take().ok_or("no output")?);
    let child = Arc::new(Mutex::new(child));
    hold(&procs.0).insert(id, child.clone());
    let app2 = app.clone();
    std::thread::spawn(move || {
        let mut peak: u64 = 0;
        let code = loop {
            peak = peak.max(memory_of(&hold(&child)).unwrap_or(0));
            if let Ok(Some(s)) = hold(&child).try_wait() {
                break s.code();
            }
            std::thread::sleep(Duration::from_millis(100));
        };
        let _ = out.join();
        let _ = err.join();
        if let Some(p) = app2.try_state::<Procs>() {
            hold(&p.0).remove(&id);
            let mut trees = hold(&p.1);
            if let Some(t) = trees.get_mut(&key) {
                t.pids.retain(|x| *x != pid);
                if t.pids.is_empty() {
                    if let Some(t) = trees.remove(&key) {
                        close_tree(t);
                    }
                }
            }
        }
        let _ = app2.emit("proc", json!({ "id": id, "done": true, "code": code, "peakMB": peak / (1024 * 1024) }));
    });
    Ok(id)
}

#[tauri::command]
pub fn proc_kill(procs: State<'_, Procs>, id: u32) -> Result<(), String> {
    if let Some(c) = hold(&procs.0).get(&id) {
        let mut c = hold(c);
        #[cfg(unix)]
        kill_group(c.id());
        c.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Cancelling a job: every process it started and their children end at once
#[tauri::command]
pub fn proc_kill_job(procs: State<'_, Procs>, job: String) {
    let tree = hold(&procs.1).remove(&job);
    if let Some(t) = tree {
        kill_tree(&t);
        close_tree(t);
    }
}

fn kill_tree(t: &Tree) {
    #[cfg(unix)]
    for pid in &t.pids {
        kill_group(*pid);
    }
    #[cfg(windows)]
    win::terminate(t);
}
#[cfg(unix)]
fn kill_group(pid: u32) {
    // SAFETY: a negative pid names the process group the child leads (process_group(0) at spawn).
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
}
#[allow(unused_variables)]
fn close_tree(t: Tree) {
    #[cfg(windows)]
    win::close(t);
}

/// The memory a running process holds now, in bytes (its peak working set on Windows)
#[cfg(unix)]
fn memory_of(c: &Child) -> Option<u64> {
    let s = std::fs::read_to_string(format!("/proc/{}/status", c.id())).ok()?;
    let line = s.lines().find(|l| l.starts_with("VmHWM:"))?;
    let kb: u64 = line.split_whitespace().nth(1)?.parse().ok()?;
    Some(kb * 1024)
}
#[cfg(windows)]
fn memory_of(c: &Child) -> Option<u64> {
    win::peak_memory(c)
}

#[cfg(windows)]
mod win {
    use super::Tree;
    use std::{os::windows::io::AsRawHandle, process::Child};
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::{
            JobObjects::{AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE},
            ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS},
        },
    };

    /// The job's Job Object (made with its first process): its processes and their children end together, and with the
    /// app if it dies (kill on close)
    pub(super) fn assign(t: &mut Tree, c: &Child) {
        if t.handle.is_none() {
            // SAFETY: plain Win32 calls; the handle is owned by the tree and closed in close().
            unsafe {
                let h = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if h.is_null() {
                    return;
                }
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                SetInformationJobObject(h, JobObjectExtendedLimitInformation, &info as *const _ as *const _, std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32);
                t.handle = Some(h as isize);
            }
        }
        if let Some(h) = t.handle {
            // SAFETY: both handles are live (the child's until it is dropped).
            unsafe {
                AssignProcessToJobObject(h as _, c.as_raw_handle() as _);
            }
        }
    }
    pub(super) fn terminate(t: &Tree) {
        if let Some(h) = t.handle {
            // SAFETY: a live Job Object handle.
            unsafe {
                TerminateJobObject(h as _, 1);
            }
        }
    }
    pub(super) fn close(t: Tree) {
        if let Some(h) = t.handle {
            // SAFETY: the tree owns the handle; it is closed once.
            unsafe {
                CloseHandle(h as _);
            }
        }
    }
    pub(super) fn peak_memory(c: &Child) -> Option<u64> {
        // SAFETY: the child's handle is live; the counters struct is sized for the call.
        unsafe {
            let mut m: PROCESS_MEMORY_COUNTERS = std::mem::zeroed();
            m.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
            (GetProcessMemoryInfo(c.as_raw_handle() as _, &mut m, m.cb) != 0).then_some(m.PeakWorkingSetSize as u64)
        }
    }
}

/// Closing the app: every tool still running stops with it (Windows leaves a child running after its parent).
pub(crate) fn kill_all(procs: &Procs) {
    for c in hold(&procs.0).values() {
        let mut c = hold(c);
        #[cfg(unix)]
        kill_group(c.id());
        let _ = c.kill();
    }
    for (_, t) in hold(&procs.1).drain() {
        kill_tree(&t);
        close_tree(t);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lines_split_on_newline_and_carriage_return() {
        let mut got = vec![];
        for_each_line(std::io::Cursor::new(b"0.00%\r12.50%\r\nERROR: x\n\nlast".to_vec()), |l| got.push(l));
        assert_eq!(got, vec!["0.00%", "12.50%", "ERROR: x", "last"]);
    }
}
