#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JobRequest {
    pub tool: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JobEntry {
    pub id: String,
    pub name: String,
    pub detail: String,
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

/// Explicit no-engine capability. There is deliberately no scheduler, queue, process or timer.
#[derive(Debug, Default)]
pub struct JobsService {
    jobs: Vec<JobEntry>,
}

impl JobsService {
    pub const CAPABILITY: &'static str = "Engines disconnected — nothing can be queued or run.";

    pub fn capability(&self) -> &'static str {
        Self::CAPABILITY
    }

    pub fn jobs(&self) -> &[JobEntry] {
        &self.jobs
    }

    pub fn submit(&mut self, _request: JobRequest) -> Result<(), JobsError> {
        Err(JobsError::NoEngine)
    }
}
