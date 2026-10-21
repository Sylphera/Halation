//! The job engine against real child processes (Windows `cmd.exe`).
#![cfg(windows)]

use halation_app::backend::{
    engine::JobEngine,
    process::ProcessSpec,
    queue::{JobSpec, JobState, Lane},
};
use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};

fn cmd(script: &str) -> ProcessSpec {
    ProcessSpec {
        program: PathBuf::from("cmd.exe"),
        args: vec!["/C".into(), script.into()],
        ..ProcessSpec::default()
    }
}

fn state_of(engine: &JobEngine, id: &str) -> JobState {
    engine
        .jobs()
        .into_iter()
        .find(|j| j.id == id)
        .expect("the job is listed")
        .state
}

fn wait_until(what: &str, mut ok: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(15);
    while !ok() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn percent(line: &str) -> Option<f32> {
    line.trim()
        .strip_suffix('%')?
        .parse::<f32>()
        .ok()
        .map(|p| p / 100.0)
}

#[test]
fn a_job_runs_reports_progress_and_finishes() {
    let changes = Arc::new(AtomicUsize::new(0));
    let seen = changes.clone();
    let engine = JobEngine::new(move || {
        seen.fetch_add(1, Ordering::Relaxed);
    });
    let id = engine.submit(
        JobSpec::new("convert", "a.png", Lane::Cpu),
        cmd("echo 50%& echo done"),
        Some(percent),
    );
    wait_until("the job to finish", || {
        state_of(&engine, &id) == JobState::Done
    });
    let job = engine.jobs().into_iter().next().unwrap();
    assert_eq!(job.progress, Some(1.0));
    assert!(
        changes.load(Ordering::Relaxed) >= 2,
        "the listener hears the changes"
    );
    assert!(!engine.busy(None));
}

#[test]
fn a_failing_program_fails_its_job_and_the_next_one_still_runs() {
    let engine = JobEngine::new(|| {});
    let bad = engine.submit(
        JobSpec::new("convert", "bad", Lane::Cpu),
        ProcessSpec {
            program: PathBuf::from("halation-no-such-program.exe"),
            ..ProcessSpec::default()
        },
        None,
    );
    let ok = engine.submit(
        JobSpec::new("convert", "ok", Lane::Cpu),
        cmd("exit 0"),
        None,
    );
    wait_until("both jobs to end", || {
        state_of(&engine, &bad).finished() && state_of(&engine, &ok).finished()
    });
    assert!(
        matches!(state_of(&engine, &bad), JobState::Failed(m) if m.contains("no-such-program"))
    );
    assert_eq!(state_of(&engine, &ok), JobState::Done);

    let exit = engine.submit(
        JobSpec::new("convert", "exit", Lane::Cpu),
        cmd("exit 7"),
        None,
    );
    wait_until("the exit job", || state_of(&engine, &exit).finished());
    assert_eq!(
        state_of(&engine, &exit),
        JobState::Failed("exit code 7".into())
    );
}

#[test]
fn a_lane_limits_how_many_run_and_the_queue_advances_when_one_ends() {
    let engine = JobEngine::new(|| {});
    let ids: Vec<_> = (0..3)
        .map(|n| {
            engine.submit(
                JobSpec::new("convert", &format!("j{n}"), Lane::Cpu),
                cmd("ping -n 4 127.0.0.1 >nul"),
                None,
            )
        })
        .collect();
    std::thread::sleep(Duration::from_millis(300));
    let running = ids
        .iter()
        .filter(|id| state_of(&engine, id) == JobState::Running)
        .count();
    assert_eq!(running, 2, "the CPU lane admits two");
    assert_eq!(state_of(&engine, &ids[2]), JobState::Queued);
    wait_until("all jobs to finish", || {
        ids.iter().all(|id| state_of(&engine, id) == JobState::Done)
    });
}

#[test]
fn cancelling_a_running_group_kills_its_processes_and_drops_the_queued_ones() {
    let engine = JobEngine::new(|| {});
    let grouped = |title: &str| JobSpec {
        group: Some("batch".into()),
        ..JobSpec::new("convert", title, Lane::Cpu)
    };
    let ids: Vec<_> = ["a", "b", "c"]
        .into_iter()
        .map(|t| engine.submit(grouped(t), cmd("ping -n 60 127.0.0.1 >nul"), None))
        .collect();
    wait_until("two jobs running", || {
        ids.iter()
            .filter(|id| state_of(&engine, id) == JobState::Running)
            .count()
            == 2
    });
    let outcome = engine.cancel("batch");
    assert_eq!(outcome.running.len(), 2);
    assert_eq!(outcome.dequeued, vec![ids[2].clone()]);
    wait_until("all cancelled", || {
        ids.iter()
            .all(|id| state_of(&engine, id) == JobState::Cancelled)
    });
    assert!(!engine.busy(None));
}

#[test]
fn shutdown_stops_what_is_running() {
    let engine = JobEngine::new(|| {});
    let id = engine.submit(
        JobSpec::new("download", "d", Lane::Net),
        cmd("ping -n 60 127.0.0.1 >nul"),
        None,
    );
    wait_until("the job to run", || {
        state_of(&engine, &id) == JobState::Running
    });
    engine.shutdown();
    wait_until("the job to end", || state_of(&engine, &id).finished());
}

#[test]
fn the_jobs_service_lists_rows_for_the_page_and_clears_finished_ones() {
    use halation_app::jobs::JobsService;

    let jobs = JobsService::default();
    let id = jobs.engine().submit(
        JobSpec::new("convert", "a.png", Lane::Cpu),
        cmd("echo 50%& echo done"),
        Some(percent),
    );
    wait_until("the row to finish", || {
        jobs.jobs().iter().any(|row| row.id == id && row.finished)
    });
    let row = jobs.jobs().into_iter().next().unwrap();
    assert_eq!(row.name, "a.png");
    assert_eq!(row.state, "Done");
    assert_eq!(row.progress, Some(1.0));
    assert!(!row.cancellable && !row.failed);

    let failing = jobs.engine().submit(
        JobSpec::new("convert", "bad", Lane::Cpu),
        ProcessSpec {
            program: PathBuf::from("Z:/no/such/program.exe"),
            ..ProcessSpec::default()
        },
        None,
    );
    wait_until("the failing row", || {
        jobs.jobs().iter().any(|r| r.id == failing && r.failed)
    });
    let bad = jobs.jobs().into_iter().find(|r| r.id == failing).unwrap();
    assert_eq!(bad.state, "Failed");
    assert!(!bad.detail.is_empty(), "the reason is shown");

    jobs.clear_finished();
    assert!(jobs.jobs().is_empty());
}
