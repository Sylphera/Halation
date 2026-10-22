//! Running external programs without a console window, line by line, with a process tree per job.
//!
//! Imported from the Tauri backend's `procs.rs` (docs/SLINT_BACKEND_IMPORT.md): the `AppHandle` event "proc" became the
//! [`ProcessEvents`] trait and the tool lookup stayed out (the caller gives the program path). Cancelling a job kills every
//! process it started and their children (a Windows Job Object per job; elsewhere only the process itself).
#![allow(unsafe_code)]

use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex, MutexGuard,
        atomic::{AtomicU32, Ordering},
    },
    time::Duration,
};

/// Which pipe a line came from
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stream {
    Out,
    Err,
}

/// What the caller hears about a process. Called from worker threads, never from the GUI thread.
pub trait ProcessEvents: Send + Sync + 'static {
    fn line(&self, id: u32, stream: Stream, line: &str);
    /// `code` is `None` when the process ended without one (killed by a signal); `peak_mb` its highest memory.
    fn finished(&self, id: u32, code: Option<i32>, peak_mb: u64);
}

#[derive(Debug, Clone, Default)]
pub struct ProcessSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
    /// Below normal priority: background work gives way to what the user is doing.
    pub low_priority: bool,
    /// The job it belongs to; [`ProcessRunner::kill_job`] ends all of its processes. Invalid keys are ignored.
    pub job: Option<String>,
    /// Defaults to the program's own folder.
    pub working_dir: Option<PathBuf>,
}

/// The processes of one job (or of one process started outside a job)
#[derive(Default)]
struct Tree {
    pids: Vec<u32>,
    #[cfg(windows)]
    handle: Option<isize>,
}

#[derive(Default)]
struct Inner {
    procs: Mutex<HashMap<u32, Arc<Mutex<Child>>>>,
    trees: Mutex<HashMap<String, Tree>>,
    next: AtomicU32,
}

#[derive(Clone, Default)]
pub struct ProcessRunner {
    inner: Arc<Inner>,
}

/// Bounded metadata/encoder inspection, off the GUI thread. Slow or broken tools cannot strand a worker.
pub fn capture(spec: ProcessSpec, timeout: Duration) -> Result<(String, String), String> {
    struct Captured {
        out: Mutex<String>,
        err: Mutex<String>,
        finished: std::sync::mpsc::Sender<Option<i32>>,
    }
    impl ProcessEvents for Captured {
        fn line(&self, _: u32, stream: Stream, line: &str) {
            let mut text = hold(if stream == Stream::Out {
                &self.out
            } else {
                &self.err
            });
            if text.len() + line.len() < 4 * 1024 * 1024 {
                text.push_str(line);
                text.push('\n');
            }
        }
        fn finished(&self, _: u32, code: Option<i32>, _: u64) {
            let _ = self.finished.send(code);
        }
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let events = Arc::new(Captured {
        out: Mutex::new(String::new()),
        err: Mutex::new(String::new()),
        finished: tx,
    });
    let runner = ProcessRunner::new();
    let id = runner.start(spec, events.clone())?;
    let code = match rx.recv_timeout(timeout) {
        Ok(code) => code,
        Err(_) => {
            runner.kill_all();
            let _ = runner.kill(id);
            return Err("Media inspection timed out".into());
        }
    };
    let out = std::mem::take(&mut *hold(&events.out));
    let err = std::mem::take(&mut *hold(&events.err));
    if code == Some(0) {
        Ok((out, err))
    } else {
        Err(if err.trim().is_empty() {
            format!("Process exited: {code:?}")
        } else {
            err
        })
    }
}

fn hold<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn valid_job_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 64
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Calls `f` with every line of `src`, splitting on \n and \r (progress lines often end with \r).
pub fn for_each_line(src: impl Read, mut f: impl FnMut(String)) {
    let mut reader = BufReader::new(src);
    let mut line = Vec::new();
    let mut send = |line: &mut Vec<u8>| {
        if !line.is_empty() {
            f(String::from_utf8_lossy(line).trim_end().to_string());
            line.clear();
        }
    };
    loop {
        let buf = match reader.fill_buf() {
            Ok([]) | Err(_) => break,
            Ok(b) => b,
        };
        let n = buf.len();
        for &c in buf {
            if c == b'\n' || c == b'\r' {
                send(&mut line);
            } else {
                line.push(c);
                if line.len() >= 1024 * 1024 {
                    send(&mut line);
                }
            }
        }
        reader.consume(n);
    }
    send(&mut line);
}

fn pump(
    events: Arc<dyn ProcessEvents>,
    id: u32,
    stream: Stream,
    src: impl Read + Send + 'static,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || for_each_line(src, |line| events.line(id, stream, &line)))
}

impl ProcessRunner {
    pub fn new() -> Self {
        Self::default()
    }

    /// Starts the program and returns its process id (not the OS pid). Its end is reported through `events.finished`.
    pub fn start(&self, spec: ProcessSpec, events: Arc<dyn ProcessEvents>) -> Result<u32, String> {
        let mut cmd = Command::new(&spec.program);
        cmd.args(&spec.args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(dir) = spec
            .working_dir
            .as_deref()
            .or_else(|| spec.program.parent())
            && dir.is_dir()
        {
            cmd.current_dir(dir);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;
            cmd.creation_flags(
                CREATE_NO_WINDOW
                    | if spec.low_priority {
                        BELOW_NORMAL_PRIORITY_CLASS
                    } else {
                        0
                    },
            );
        }
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("{}: {e}", spec.program.display()))?;
        let id = self.inner.next.fetch_add(1, Ordering::Relaxed) + 1;
        let pid = child.id();
        let key = spec
            .job
            .filter(|j| valid_job_key(j))
            .unwrap_or_else(|| format!("p{id}"));
        {
            let mut trees = hold(&self.inner.trees);
            let tree = trees.entry(key.clone()).or_default();
            tree.pids.push(pid);
            #[cfg(windows)]
            win::assign(tree, &child);
        }
        let out = pump(
            events.clone(),
            id,
            Stream::Out,
            child.stdout.take().ok_or("no output")?,
        );
        let err = pump(
            events.clone(),
            id,
            Stream::Err,
            child.stderr.take().ok_or("no output")?,
        );
        let child = Arc::new(Mutex::new(child));
        hold(&self.inner.procs).insert(id, child.clone());
        let inner = self.inner.clone();
        std::thread::spawn(move || {
            let mut peak: u64 = 0;
            let code = loop {
                peak = peak.max(memory_of(&hold(&child)).unwrap_or(0));
                if let Ok(Some(status)) = hold(&child).try_wait() {
                    break status.code();
                }
                std::thread::sleep(Duration::from_millis(100));
            };
            let _ = out.join();
            let _ = err.join();
            hold(&inner.procs).remove(&id);
            {
                let mut trees = hold(&inner.trees);
                if let Some(tree) = trees.get_mut(&key) {
                    tree.pids.retain(|x| *x != pid);
                    if tree.pids.is_empty()
                        && let Some(tree) = trees.remove(&key)
                    {
                        close_tree(tree);
                    }
                }
            }
            events.finished(id, code, peak / (1024 * 1024));
        });
        Ok(id)
    }

    /// Ends one process.
    pub fn kill(&self, id: u32) -> Result<(), String> {
        if let Some(child) = hold(&self.inner.procs).get(&id) {
            hold(child).kill().map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// Cancelling a job: every process it started and their children end at once.
    pub fn kill_job(&self, job: &str) {
        let tree = hold(&self.inner.trees).remove(job);
        if let Some(tree) = tree {
            kill_tree(&tree);
            close_tree(tree);
        }
    }

    /// Closing the app: every program still running stops with it (Windows leaves a child running after its parent).
    pub fn kill_all(&self) {
        for child in hold(&self.inner.procs).values() {
            let _ = hold(child).kill();
        }
        for (_, tree) in hold(&self.inner.trees).drain() {
            kill_tree(&tree);
            close_tree(tree);
        }
    }

    pub fn running(&self) -> usize {
        hold(&self.inner.procs).len()
    }
}

#[allow(unused_variables)]
fn kill_tree(t: &Tree) {
    #[cfg(windows)]
    win::terminate(t);
}

#[allow(unused_variables)]
fn close_tree(t: Tree) {
    #[cfg(windows)]
    win::close(t);
}

/// The highest memory a running process has held, in bytes (Windows only; 0 elsewhere)
#[allow(unused_variables)]
fn memory_of(c: &Child) -> Option<u64> {
    #[cfg(windows)]
    {
        win::peak_memory(c)
    }
    #[cfg(not(windows))]
    {
        None
    }
}

#[cfg(windows)]
mod win {
    use super::Tree;
    use std::{os::windows::io::AsRawHandle, process::Child};
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::{
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
                SetInformationJobObject, TerminateJobObject,
            },
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
                SetInformationJobObject(
                    h,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const _,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
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
            (GetProcessMemoryInfo(c.as_raw_handle() as _, &mut m, m.cb) != 0)
                .then_some(m.PeakWorkingSetSize as u64)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lines_split_on_newline_and_carriage_return() {
        let mut got = vec![];
        for_each_line(
            std::io::Cursor::new(b"0.00%\r12.50%\r\nERROR: x\n\nlast".to_vec()),
            |l| got.push(l),
        );
        assert_eq!(got, vec!["0.00%", "12.50%", "ERROR: x", "last"]);
    }

    #[test]
    fn job_keys_are_plain_identifiers() {
        assert!(valid_job_key("job-1_a"));
        assert!(!valid_job_key(""));
        assert!(!valid_job_key("a b"));
        assert!(!valid_job_key("../x"));
        assert!(!valid_job_key(&"a".repeat(65)));
    }
}
