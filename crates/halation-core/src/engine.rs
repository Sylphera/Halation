//! Runs the jobs the scheduler admits as external processes (docs/features/jobs.md: one planner, a process tree per job).
//! Event-driven: nothing runs while no job exists (no timer, no polling). A change listener is called from worker
//! threads, after the state lock is released; the UI layer forwards it to the GUI thread.

use super::{
    process::{ProcessEvents, ProcessRunner, ProcessSpec, Stream},
    queue::{CancelOutcome, Job, JobSpec, Scheduler},
};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc,
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
    task: Option<Task>,
    cancelled: Arc<AtomicBool>,
}

type Task = Box<dyn FnOnce(TaskContext) -> Result<(), String> + Send>;

/// A finite scheduled task. Processes started through this context belong to the same cancellable tree.
pub struct TaskContext {
    engine: JobEngine,
    job: String,
    cancelled: Arc<AtomicBool>,
}

impl TaskContext {
    /// Publish a completed result atomically with respect to cancellation.
    pub fn complete(&self, publish: impl FnOnce() -> Result<(), String>) -> Result<(), String> {
        {
            let mut state = hold(&self.engine.state);
            self.check_cancelled()?;
            publish()?;
            state.scheduler.finish(&self.job, None, Instant::now());
        }
        (self.engine.changed)();
        Ok(())
    }
    pub fn check_cancelled(&self) -> Result<(), String> {
        if self.cancelled.load(Ordering::Acquire) {
            Err("Cancelled".into())
        } else {
            Ok(())
        }
    }

    pub fn progress(&self, value: Option<f32>, stage: &str) {
        hold(&self.engine.state)
            .scheduler
            .progress(&self.job, value, Some(stage));
        (self.engine.changed)();
    }

    pub fn run_process(&self, mut spec: ProcessSpec, duration: f64) -> Result<(), String> {
        self.check_cancelled()?;
        spec.job = Some(self.job.clone());
        let (tx, rx) = mpsc::channel();
        let events = Arc::new(TaskEvents {
            engine: self.engine.clone(),
            job: self.job.clone(),
            duration,
            error: Mutex::new(String::new()),
            done: Mutex::new(Some(tx)),
        });
        // Serialize process creation with cancel so a late spawn cannot escape the job's kill request.
        {
            let _state = hold(&self.engine.state);
            self.check_cancelled()?;
            self.engine.runner.start(spec, events)?;
        }
        rx.recv()
            .map_err(|_| "Process completion was lost".to_owned())??;
        self.check_cancelled()
    }
}

struct TaskEvents {
    engine: JobEngine,
    job: String,
    duration: f64,
    error: Mutex<String>,
    done: Mutex<Option<mpsc::Sender<Result<(), String>>>>,
}

impl ProcessEvents for TaskEvents {
    fn line(&self, _: u32, stream: Stream, line: &str) {
        if stream == Stream::Err {
            let mut error = hold(&self.error);
            if error.len() + line.len() > 8192 {
                error.clear();
            }
            error.push_str(line);
            error.push('\n');
        } else if self.duration.is_finite()
            && self.duration > 0.0
            && let Some(value) = line
                .strip_prefix("out_time_us=")
                .and_then(|s| s.parse::<f64>().ok())
        {
            hold(&self.engine.state).scheduler.progress(
                &self.job,
                Some((value / 1_000_000.0 / self.duration).clamp(0.0, 0.99) as f32),
                None,
            );
            (self.engine.changed)();
        }
    }
    fn finished(&self, _: u32, code: Option<i32>, _: u64) {
        let result = if code == Some(0) {
            Ok(())
        } else {
            let error = hold(&self.error);
            Err(if error.trim().is_empty() {
                format!("Process exited: {code:?}")
            } else {
                error.trim().to_owned()
            })
        };
        if let Some(tx) = hold(&self.done).take() {
            let _ = tx.send(result);
        }
    }
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
            state.work.insert(
                id.clone(),
                Work {
                    process,
                    parse,
                    task: None,
                    cancelled: Arc::new(AtomicBool::new(false)),
                },
            );
            id
        };
        (self.changed)();
        self.pump();
        id
    }

    /// Runs finite native work in the same scheduler as external-process jobs.
    pub fn submit_task(
        &self,
        spec: JobSpec,
        task: impl FnOnce(TaskContext) -> Result<(), String> + Send + 'static,
    ) -> String {
        let id = {
            let mut state = hold(&self.state);
            let id = state.scheduler.submit(spec, Instant::now());
            state.work.insert(
                id.clone(),
                Work {
                    process: ProcessSpec::default(),
                    parse: None,
                    task: Some(Box::new(task)),
                    cancelled: Arc::new(AtomicBool::new(false)),
                },
            );
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
                if let Some(work) = state.work.get_mut(&id)
                    && let Some(task) = work.task.take()
                {
                    let context = TaskContext {
                        engine: self.clone(),
                        job: id.clone(),
                        cancelled: work.cancelled.clone(),
                    };
                    let engine = self.clone();
                    let job = id.clone();
                    if let Err(error) =
                        std::thread::Builder::new()
                            .name(format!("job-{id}"))
                            .spawn(move || {
                                let result =
                                    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                                        task(context)
                                    }))
                                    .unwrap_or_else(|_| Err("Worker failed unexpectedly".into()));
                                {
                                    let mut state = hold(&engine.state);
                                    state.scheduler.finish(&job, result.err(), Instant::now());
                                    state.work.remove(&job);
                                }
                                (engine.changed)();
                                engine.pump();
                            })
                    {
                        state
                            .scheduler
                            .finish(&id, Some(error.to_string()), Instant::now());
                        state.work.remove(&id);
                        failed = true;
                    }
                    continue;
                }
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
            for id in &outcome.running {
                if let Some(work) = state.work.get(id) {
                    work.cancelled.store(true, Ordering::Release);
                }
            }
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
        let ids: Vec<_> = self
            .jobs()
            .into_iter()
            .filter(|j| !j.state.finished())
            .map(|j| j.id)
            .collect();
        for id in ids {
            self.cancel(&id);
        }
        self.runner.kill_all();
    }
}
