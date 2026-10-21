//! Runs the jobs the scheduler admits as external processes (docs/JOBS_SPEC.md: one planner, a process tree per job).
//! Event-driven: nothing runs while no job exists (no timer, no polling). A change listener is called from worker
//! threads, after the state lock is released; the UI layer forwards it to the GUI thread.

use super::{
    process::{ProcessEvents, ProcessRunner, ProcessSpec, Stream},
    queue::{CancelOutcome, Job, JobSpec, Scheduler},
};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, MutexGuard},
    time::Instant,
};

/// Reads a progress value (0..1) out of one output line of the tool, when it carries one
pub type ProgressParser = fn(&str) -> Option<f32>;

struct Work {
    process: ProcessSpec,
    parse: Option<ProgressParser>,
}

struct State {
    scheduler: Scheduler,
    work: HashMap<String, Work>,
}

#[derive(Clone)]
pub struct JobEngine {
    state: Arc<Mutex<State>>,
    runner: ProcessRunner,
    changed: Arc<dyn Fn() + Send + Sync>,
}

fn hold<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Hears one job's process and feeds the scheduler
struct JobEvents {
    engine: JobEngine,
    job: String,
}

impl ProcessEvents for JobEvents {
    fn line(&self, _id: u32, _stream: Stream, line: &str) {
        let progress = {
            let mut state = hold(&self.engine.state);
            let parse = state.work.get(&self.job).and_then(|w| w.parse);
            match parse.and_then(|p| p(line)) {
                Some(value) => {
                    state.scheduler.progress(&self.job, Some(value), None);
                    true
                }
                None => false,
            }
        };
        if progress {
            (self.engine.changed)();
        }
    }

    fn finished(&self, _id: u32, code: Option<i32>, _peak_mb: u64) {
        let failure = match code {
            Some(0) => None,
            Some(code) => Some(format!("exit code {code}")),
            None => Some("ended without an exit code".to_owned()),
        };
        {
            let mut state = hold(&self.engine.state);
            state.scheduler.finish(&self.job, failure, Instant::now());
            state.work.remove(&self.job);
        }
        (self.engine.changed)();
        self.engine.pump();
    }
}

impl JobEngine {
    pub fn new(changed: impl Fn() + Send + Sync + 'static) -> Self {
        Self {
            state: Arc::new(Mutex::new(State {
                scheduler: Scheduler::new(),
                work: HashMap::new(),
            })),
            runner: ProcessRunner::new(),
            changed: Arc::new(changed),
        }
    }

    /// Queues a job that runs `process`; answers at once (the job starts when its lane has room).
    pub fn submit(
        &self,
        spec: JobSpec,
        process: ProcessSpec,
        parse: Option<ProgressParser>,
    ) -> String {
        let id = {
            let mut state = hold(&self.state);
            let id = state.scheduler.submit(spec, Instant::now());
            state.work.insert(id.clone(), Work { process, parse });
            id
        };
        (self.changed)();
        self.pump();
        id
    }

    /// Starts every job the scheduler admits; a program that cannot start fails its job without blocking the queue.
    fn pump(&self) {
        let mut failed = false;
        {
            let mut state = hold(&self.state);
            let ids = state.scheduler.schedule(Instant::now());
            for id in ids {
                let Some(mut process) = state.work.get(&id).map(|w| w.process.clone()) else {
                    continue;
                };
                process.job = Some(id.clone());
                process.low_priority |= state
                    .scheduler
                    .get(&id)
                    .is_some_and(|j| j.spec.priority == super::queue::Priority::Background);
                let events = Arc::new(JobEvents {
                    engine: self.clone(),
                    job: id.clone(),
                });
                if let Err(error) = self.runner.start(process, events) {
                    state.scheduler.finish(&id, Some(error), Instant::now());
                    state.work.remove(&id);
                    failed = true;
                }
            }
        }
        if failed {
            (self.changed)();
            self.pump();
        }
    }

    /// Cancels a job by id or a whole group: queued jobs end now, running ones have their process tree killed.
    pub fn cancel(&self, target: &str) -> CancelOutcome {
        let outcome = {
            let mut state = hold(&self.state);
            let outcome = state.scheduler.cancel(target, Instant::now());
            for id in &outcome.dequeued {
                state.work.remove(id);
            }
            outcome
        };
        for id in &outcome.running {
            self.runner.kill_job(id);
        }
        (self.changed)();
        outcome
    }

    pub fn hold(&self, id: &str, on: bool) {
        hold(&self.state).scheduler.hold(id, on);
        (self.changed)();
        self.pump();
    }

    pub fn clear_finished(&self) {
        hold(&self.state).scheduler.clear_finished();
        (self.changed)();
    }

    /// A snapshot of every job, for the UI layer
    pub fn jobs(&self) -> Vec<Job> {
        hold(&self.state).scheduler.list().cloned().collect()
    }

    pub fn busy(&self, tool: Option<&str>) -> bool {
        hold(&self.state).scheduler.busy(tool)
    }

    /// Closing the app: every process still running stops with it.
    pub fn shutdown(&self) {
        self.runner.kill_all();
    }
}
