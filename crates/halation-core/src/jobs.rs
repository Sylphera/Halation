//! The Jobs page's service: a thin view over the scheduler and process engine (`engine`).
//! No tool engine is registered in this beta, so nothing can be submitted from the UI (`submit` says so);
//! the page lists whatever the engine holds and lets the user cancel or clear it.

use crate::{
    engine::JobEngine,
    queue::{Job, JobState},
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JobRequest {
    pub tool: String,
    pub description: String,
}

/// One row of the Jobs page
#[derive(Debug, Clone, PartialEq)]
pub struct JobEntry {
    pub id: String,
    pub name: String,
    pub detail: String,
    /// Short state label shown on the row
    pub state: String,
    /// 0..1, or `None` while the tool has not reported any
    pub progress: Option<f32>,
    pub cancellable: bool,
    pub finished: bool,
    pub failed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JobsError {
    NoEngine,
}

impl std::fmt::Display for JobsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoEngine => write!(
                f,
                "processing engines are not connected in this beta; nothing was queued"
            ),
        }
    }
}

impl std::error::Error for JobsError {}

pub struct JobsService {
    engine: JobEngine,
}

impl Default for JobsService {
    fn default() -> Self {
        Self::new(|| {})
    }
}

impl JobsService {
    pub const CAPABILITY: &'static str = "Engines disconnected — nothing can be queued or run.";

    /// `changed` runs on worker threads whenever the job list or a job's progress changes.
    pub fn new(changed: impl Fn() + Send + Sync + 'static) -> Self {
        Self {
            engine: JobEngine::new(changed),
        }
    }

    pub fn capability(&self) -> &'static str {
        Self::CAPABILITY
    }

    pub fn engine(&self) -> &JobEngine {
        &self.engine
    }

    pub fn jobs(&self) -> Vec<JobEntry> {
        self.engine.jobs().iter().map(entry).collect()
    }

    pub fn submit(&self, _request: JobRequest) -> Result<(), JobsError> {
        Err(JobsError::NoEngine)
    }

    pub fn cancel(&self, id: &str) {
        self.engine.cancel(id);
    }

    pub fn clear_finished(&self) {
        self.engine.clear_finished();
    }

    pub fn shutdown(&self) {
        self.engine.shutdown();
    }
}

fn entry(job: &Job) -> JobEntry {
    let state = match &job.state {
        JobState::Queued if job.waiting => "Waiting for room",
        JobState::Queued => "Queued",
        JobState::Held => "On hold",
        JobState::Running if job.cancelling => "Cancelling…",
        JobState::Running => "Running",
        JobState::Done => "Done",
        JobState::Failed(_) => "Failed",
        JobState::Cancelled => "Cancelled",
    };
    let detail = match &job.state {
        JobState::Failed(reason) => reason.clone(),
        _ if !job.stage.is_empty() => job.stage.clone(),
        _ => job.spec.detail.clone(),
    };
    JobEntry {
        id: job.id.clone(),
        name: job.spec.title.clone(),
        detail,
        state: state.to_owned(),
        progress: job.progress.map(|p| p.clamp(0.0, 1.0)),
        cancellable: !job.state.finished() && !job.cancelling,
        finished: job.state.finished(),
        failed: matches!(job.state, JobState::Failed(_)),
    }
}
