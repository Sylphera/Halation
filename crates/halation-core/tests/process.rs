//! The process runner against real child processes (Windows `cmd.exe`).
#![cfg(windows)]

use halation_core::process::{ProcessEvents, ProcessRunner, ProcessSpec, Stream};
use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex,
        mpsc::{Receiver, Sender, channel},
    },
    time::{Duration, Instant},
};

#[derive(Debug)]
enum Event {
    Line(Stream, String),
    Done(Option<i32>),
}

struct Collector(Mutex<Sender<Event>>);

impl ProcessEvents for Collector {
    fn line(&self, _id: u32, stream: Stream, line: &str) {
        let _ = self
            .0
            .lock()
            .unwrap()
            .send(Event::Line(stream, line.to_owned()));
    }
    fn finished(&self, _id: u32, code: Option<i32>, _peak_mb: u64) {
        let _ = self.0.lock().unwrap().send(Event::Done(code));
    }
}

fn collector() -> (Arc<Collector>, Receiver<Event>) {
    let (tx, rx) = channel();
    (Arc::new(Collector(Mutex::new(tx))), rx)
}

fn cmd(script: &str) -> ProcessSpec {
    ProcessSpec {
        program: PathBuf::from("cmd.exe"),
        args: vec!["/C".into(), script.into()],
        ..ProcessSpec::default()
    }
}

fn wait_done(rx: &Receiver<Event>, timeout: Duration) -> (Vec<(Stream, String)>, Option<i32>) {
    let deadline = Instant::now() + timeout;
    let mut lines = Vec::new();
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        match rx
            .recv_timeout(left)
            .expect("the process did not finish in time")
        {
            Event::Line(stream, line) => lines.push((stream, line)),
            Event::Done(code) => return (lines, code),
        }
    }
}

#[test]
fn output_lines_and_exit_code_reach_the_listener() {
    let runner = ProcessRunner::new();
    let (events, rx) = collector();
    runner.start(cmd("echo one& echo two"), events).unwrap();
    let (lines, code) = wait_done(&rx, Duration::from_secs(10));
    let out: Vec<_> = lines
        .iter()
        .filter(|(s, _)| *s == Stream::Out)
        .map(|(_, l)| l.as_str())
        .collect();
    assert_eq!(out, ["one", "two"]);
    assert_eq!(code, Some(0));
}

#[test]
fn a_failing_exit_code_and_stderr_are_reported() {
    let runner = ProcessRunner::new();
    let (events, rx) = collector();
    runner.start(cmd("echo bad 1>&2 & exit 3"), events).unwrap();
    let (lines, code) = wait_done(&rx, Duration::from_secs(10));
    assert!(
        lines.contains(&(Stream::Err, "bad".to_owned())),
        "{lines:?}"
    );
    assert_eq!(code, Some(3));
}

#[test]
fn a_missing_program_is_an_error_naming_it() {
    let runner = ProcessRunner::new();
    let (events, _rx) = collector();
    let error = runner
        .start(
            ProcessSpec {
                program: PathBuf::from("halation-no-such-program.exe"),
                ..ProcessSpec::default()
            },
            events,
        )
        .unwrap_err();
    assert!(error.contains("halation-no-such-program.exe"), "{error}");
    assert_eq!(runner.running(), 0);
}

#[test]
fn cancelling_a_job_ends_its_process_and_children() {
    let runner = ProcessRunner::new();
    let (events, rx) = collector();
    let mut spec = cmd("ping -n 60 127.0.0.1 >nul");
    spec.job = Some("job-cancel".into());
    runner.start(spec, events).unwrap();
    std::thread::sleep(Duration::from_millis(500));
    assert_eq!(runner.running(), 1);
    let started = Instant::now();
    runner.kill_job("job-cancel");
    let (_, code) = wait_done(&rx, Duration::from_secs(10));
    assert_ne!(code, Some(0));
    assert!(started.elapsed() < Duration::from_secs(10));
    assert_eq!(runner.running(), 0);
}

#[test]
fn kill_all_stops_everything_still_running() {
    let runner = ProcessRunner::new();
    let (events, rx) = collector();
    runner
        .start(cmd("ping -n 60 127.0.0.1 >nul"), events.clone())
        .unwrap();
    runner
        .start(cmd("ping -n 60 127.0.0.1 >nul"), events)
        .unwrap();
    std::thread::sleep(Duration::from_millis(500));
    runner.kill_all();
    wait_done(&rx, Duration::from_secs(10));
    wait_done(&rx, Duration::from_secs(10));
    assert_eq!(runner.running(), 0);
}
