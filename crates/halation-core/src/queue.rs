//! The job scheduler of docs/features/jobs.md (§3 model, §4 planning): lanes with their own capacity, costs, priorities,
//! backfill with a starvation guard, holding, cancelling by id or group. Pure state, no threads, no clock of its own:
//! the caller passes `now`, so every rule is testable. `engine.rs` runs the jobs it admits.
//!
//! Not yet implemented from the spec: VRAM/RAM/disk `needs`, measured statistics (§4.3), `yield()`, reordering,
//! stage changes (`switch`) and the minimized-window pause.

use std::{
    collections::VecDeque,
    time::{Duration, Instant},
};

/// A queued job that has waited this long keeps its place: nothing behind it may overtake it (§4.4).
pub const STARVATION: Duration = Duration::from_secs(30);
/// Finished jobs kept for the tray (§3).
pub const FINISHED_KEPT: usize = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Lane {
    Gpu,
    Cpu,
    Net,
    Light,
}

impl Lane {
    /// Capacity of the "Balanced" profile (§4.1)
    pub fn capacity(self) -> f32 {
        match self {
            Self::Gpu | Self::Cpu => 2.0,
            Self::Net => 3.0,
            Self::Light => 16.0,
        }
    }

    fn heavy(self) -> bool {
        self != Self::Light
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Priority {
    Background,
    Normal,
    User,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JobState {
    Queued,
    /// Queued by hand: never starts until released
    Held,
    Running,
    Done,
    Failed(String),
    Cancelled,
}

impl JobState {
    pub fn finished(&self) -> bool {
        matches!(self, Self::Done | Self::Failed(_) | Self::Cancelled)
    }
}

#[derive(Debug, Clone)]
pub struct JobSpec {
    pub tool: String,
    pub kind: String,
    pub title: String,
    pub detail: String,
    pub group: Option<String>,
    pub priority: Priority,
    pub lane: Lane,
    /// How much of the lane's capacity it takes while running (default 1)
    pub cost: f32,
}

impl JobSpec {
    pub fn new(tool: &str, title: &str, lane: Lane) -> Self {
        Self {
            tool: tool.to_owned(),
            kind: tool.to_owned(),
            title: title.to_owned(),
            detail: String::new(),
            group: None,
            priority: Priority::Normal,
            lane,
            cost: 1.0,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Job {
    pub id: String,
    pub spec: JobSpec,
    pub state: JobState,
    /// Queued and ready, but its lane has no room (§3 `waiting`)
    pub waiting: bool,
    /// A running job whose cancellation was requested and whose process has not ended yet
    pub cancelling: bool,
    pub progress: Option<f32>,
    pub stage: String,
    pub created: Instant,
    pub started: Option<Instant>,
    pub ended: Option<Instant>,
    seq: u64,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct CancelOutcome {
    /// Were still queued: cancelled at once
    pub dequeued: Vec<String>,
    /// Are running: the caller must end their processes, then call `finish`
    pub running: Vec<String>,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Counts {
    pub queued: usize,
    pub running: usize,
    pub finished: usize,
}

#[derive(Debug, Default)]
pub struct Scheduler {
    jobs: VecDeque<Job>,
    next: u64,
}

impl Scheduler {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn submit(&mut self, spec: JobSpec, now: Instant) -> String {
        self.next += 1;
        let id = format!("j_{:06}", self.next);
        self.jobs.push_back(Job {
            id: id.clone(),
            spec,
            state: JobState::Queued,
            waiting: false,
            cancelling: false,
            progress: None,
            stage: String::new(),
            created: now,
            started: None,
            ended: None,
            seq: self.next,
        });
        id
    }

    pub fn get(&self, id: &str) -> Option<&Job> {
        self.jobs.iter().find(|j| j.id == id)
    }

    fn get_mut(&mut self, id: &str) -> Option<&mut Job> {
        self.jobs.iter_mut().find(|j| j.id == id)
    }

    pub fn list(&self) -> impl Iterator<Item = &Job> {
        self.jobs.iter()
    }

    pub fn counts(&self) -> Counts {
        let mut c = Counts::default();
        for j in &self.jobs {
            match j.state {
                JobState::Queued | JobState::Held => c.queued += 1,
                JobState::Running => c.running += 1,
                _ => c.finished += 1,
            }
        }
        c
    }

    /// Something of this tool (or of any tool) is queued or running
    pub fn busy(&self, tool: Option<&str>) -> bool {
        self.jobs
            .iter()
            .any(|j| !j.state.finished() && tool.is_none_or(|t| j.spec.tool == t))
    }

    pub fn idle(&self) -> bool {
        !self.busy(None)
    }

    pub fn hold(&mut self, id: &str, on: bool) {
        if let Some(j) = self.get_mut(id) {
            match (&j.state, on) {
                (JobState::Queued, true) => j.state = JobState::Held,
                (JobState::Held, false) => j.state = JobState::Queued,
                _ => {}
            }
        }
    }

    pub fn progress(&mut self, id: &str, value: Option<f32>, stage: Option<&str>) {
        if let Some(j) = self.get_mut(id).filter(|j| j.state == JobState::Running) {
            j.progress = value.map(|v| v.clamp(0.0, 1.0));
            if let Some(s) = stage {
                j.stage = s.to_owned();
            }
        }
    }

    /// Cancels a job by id, or every job of a group. Queued ones end now; running ones are returned for the caller to kill.
    pub fn cancel(&mut self, target: &str, now: Instant) -> CancelOutcome {
        let mut out = CancelOutcome::default();
        for j in &mut self.jobs {
            if j.id != target && j.spec.group.as_deref() != Some(target) {
                continue;
            }
            match j.state {
                JobState::Queued | JobState::Held => {
                    j.state = JobState::Cancelled;
                    j.waiting = false;
                    j.ended = Some(now);
                    out.dequeued.push(j.id.clone());
                }
                JobState::Running if !j.cancelling => {
                    j.cancelling = true;
                    out.running.push(j.id.clone());
                }
                _ => {}
            }
        }
        self.trim();
        out
    }

    /// A running job ended. A job whose cancellation was requested ends as cancelled whatever the outcome.
    pub fn finish(&mut self, id: &str, failure: Option<String>, now: Instant) {
        if let Some(j) = self.get_mut(id).filter(|j| j.state == JobState::Running) {
            j.state = match (j.cancelling, failure) {
                (true, _) => JobState::Cancelled,
                (false, None) => JobState::Done,
                (false, Some(error)) => JobState::Failed(error),
            };
            if j.state == JobState::Done {
                j.progress = Some(1.0);
            }
            j.ended = Some(now);
        }
        self.trim();
    }

    pub fn clear_finished(&mut self) {
        self.jobs.retain(|j| !j.state.finished());
    }

    fn trim(&mut self) {
        let mut finished = self.jobs.iter().filter(|j| j.state.finished()).count();
        while finished > FINISHED_KEPT {
            if let Some(pos) = self.jobs.iter().position(|j| j.state.finished()) {
                self.jobs.remove(pos);
                finished -= 1;
            } else {
                break;
            }
        }
    }

    /// Marks the jobs that can start now as running and returns their ids, in the order they were admitted (§4.4).
    pub fn schedule(&mut self, now: Instant) -> Vec<String> {
        let mut started = Vec::new();
        for lane in [Lane::Gpu, Lane::Cpu, Lane::Net, Lane::Light] {
            let mut used: f32 = self
                .jobs
                .iter()
                .filter(|j| j.state == JobState::Running && j.spec.lane == lane)
                .map(|j| j.spec.cost)
                .sum();
            let foreground = self.jobs.iter().any(|j| {
                j.spec.lane == lane
                    && j.spec.priority != Priority::Background
                    && matches!(j.state, JobState::Running | JobState::Queued)
            });
            let mut order: Vec<usize> = (0..self.jobs.len())
                .filter(|&i| {
                    self.jobs[i].spec.lane == lane && self.jobs[i].state == JobState::Queued
                })
                .collect();
            order.sort_by_key(|&i| {
                (
                    std::cmp::Reverse(self.jobs[i].spec.priority),
                    self.jobs[i].seq,
                )
            });
            let mut reserved = false;
            for i in order {
                let (priority, cost, waited) = {
                    let j = &self.jobs[i];
                    (
                        j.spec.priority,
                        j.spec.cost,
                        now.saturating_duration_since(j.created),
                    )
                };
                // background work gives way while anything else is queued or running in its lane
                let blocked_by_foreground = priority == Priority::Background && foreground;
                let capacity = lane.capacity()
                    + if priority == Priority::User && lane.heavy() {
                        1.0
                    } else {
                        0.0
                    };
                let fits = used + cost <= capacity + f32::EPSILON || used == 0.0;
                if !reserved && fits && !blocked_by_foreground {
                    used += cost;
                    let j = &mut self.jobs[i];
                    j.state = JobState::Running;
                    j.waiting = false;
                    j.started = Some(now);
                    started.push(j.id.clone());
                } else {
                    self.jobs[i].waiting = true;
                    // the first job that does not fit keeps its place once it has waited long enough
                    if !fits && waited > STARVATION {
                        reserved = true;
                    }
                }
            }
        }
        started
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(lane: Lane, cost: f32, priority: Priority) -> JobSpec {
        JobSpec {
            cost,
            priority,
            ..JobSpec::new("t", "job", lane)
        }
    }

    #[test]
    fn a_lane_admits_up_to_its_capacity_and_the_rest_wait() {
        let now = Instant::now();
        let mut s = Scheduler::new();
        let ids: Vec<_> = (0..3)
            .map(|_| s.submit(spec(Lane::Gpu, 1.0, Priority::Normal), now))
            .collect();
        assert_eq!(s.schedule(now), ids[..2]);
        assert!(s.get(&ids[2]).unwrap().waiting);
        s.finish(&ids[0], None, now);
        assert_eq!(s.schedule(now), ids[2..]);
        assert_eq!(s.get(&ids[0]).unwrap().state, JobState::Done);
    }

    #[test]
    fn lanes_are_independent() {
        let now = Instant::now();
        let mut s = Scheduler::new();
        s.submit(spec(Lane::Gpu, 2.0, Priority::Normal), now);
        s.submit(spec(Lane::Cpu, 1.0, Priority::Normal), now);
        s.submit(spec(Lane::Net, 1.0, Priority::Normal), now);
        s.submit(spec(Lane::Light, 1.0, Priority::Normal), now);
        assert_eq!(s.schedule(now).len(), 4);
    }

    #[test]
    fn user_jobs_go_first_and_may_use_the_spare_unit() {
        let now = Instant::now();
        let mut s = Scheduler::new();
        let a = s.submit(spec(Lane::Gpu, 1.0, Priority::Normal), now);
        let b = s.submit(spec(Lane::Gpu, 1.0, Priority::Normal), now);
        s.schedule(now);
        let c = s.submit(spec(Lane::Gpu, 1.0, Priority::Normal), now);
        let u = s.submit(spec(Lane::Gpu, 1.0, Priority::User), now);
        assert_eq!(s.schedule(now), vec![u.clone()]);
        assert_eq!(s.get(&c).unwrap().state, JobState::Queued);
        assert!(s.get(&a).is_some() && s.get(&b).is_some());
    }

    #[test]
    fn backfill_lets_a_small_job_pass_a_big_one_until_it_has_waited_too_long() {
        let now = Instant::now();
        let mut s = Scheduler::new();
        let running = s.submit(spec(Lane::Gpu, 1.0, Priority::Normal), now);
        s.schedule(now);
        let big = s.submit(spec(Lane::Gpu, 2.0, Priority::Normal), now);
        let small = s.submit(spec(Lane::Gpu, 0.5, Priority::Normal), now);
        assert_eq!(s.schedule(now), vec![small.clone()]);
        s.finish(&small, None, now);
        let later = now + STARVATION + Duration::from_secs(1);
        let small2 = s.submit(spec(Lane::Gpu, 0.5, Priority::Normal), later);
        assert!(
            s.schedule(later).is_empty(),
            "the old big job keeps its place"
        );
        assert_eq!(s.get(&small2).unwrap().state, JobState::Queued);
        s.finish(&running, None, later);
        assert_eq!(s.schedule(later), vec![big]);
    }

    #[test]
    fn background_waits_while_other_work_is_queued_or_running_in_its_lane() {
        let now = Instant::now();
        let mut s = Scheduler::new();
        let bg = s.submit(spec(Lane::Cpu, 1.0, Priority::Background), now);
        let n = s.submit(spec(Lane::Cpu, 1.0, Priority::Normal), now);
        assert_eq!(s.schedule(now), vec![n.clone()]);
        assert_eq!(s.get(&bg).unwrap().state, JobState::Queued);
        s.finish(&n, None, now);
        assert_eq!(s.schedule(now), vec![bg]);
    }

    #[test]
    fn held_jobs_do_not_start_until_released() {
        let now = Instant::now();
        let mut s = Scheduler::new();
        let a = s.submit(spec(Lane::Net, 1.0, Priority::Normal), now);
        s.hold(&a, true);
        assert!(s.schedule(now).is_empty());
        s.hold(&a, false);
        assert_eq!(s.schedule(now), vec![a]);
    }

    #[test]
    fn cancelling_a_group_ends_queued_jobs_and_returns_running_ones() {
        let now = Instant::now();
        let mut s = Scheduler::new();
        let grouped = |s: &mut Scheduler| {
            s.submit(
                JobSpec {
                    group: Some("batch".into()),
                    ..spec(Lane::Cpu, 1.0, Priority::Normal)
                },
                now,
            )
        };
        let (a, b, c) = (grouped(&mut s), grouped(&mut s), grouped(&mut s));
        let other = s.submit(spec(Lane::Cpu, 1.0, Priority::Normal), now);
        s.schedule(now);
        let out = s.cancel("batch", now);
        assert_eq!(out.running, vec![a.clone(), b.clone()]);
        assert_eq!(out.dequeued, vec![c.clone()]);
        assert_eq!(s.get(&c).unwrap().state, JobState::Cancelled);
        assert_eq!(s.get(&other).unwrap().state, JobState::Queued);
        s.finish(&a, Some("killed".into()), now);
        assert_eq!(s.get(&a).unwrap().state, JobState::Cancelled);
        assert!(
            s.cancel("batch", now).running.is_empty(),
            "a job already cancelling is not returned twice ({b})"
        );
    }

    #[test]
    fn failures_do_not_block_the_queue_and_progress_is_clamped() {
        let now = Instant::now();
        let mut s = Scheduler::new();
        let a = s.submit(spec(Lane::Gpu, 2.0, Priority::Normal), now);
        let b = s.submit(spec(Lane::Gpu, 2.0, Priority::Normal), now);
        s.schedule(now);
        s.progress(&a, Some(1.7), Some("Upscaling"));
        assert_eq!(s.get(&a).unwrap().progress, Some(1.0));
        assert_eq!(s.get(&a).unwrap().stage, "Upscaling");
        s.finish(&a, Some("exit code 1".into()), now);
        assert_eq!(
            s.get(&a).unwrap().state,
            JobState::Failed("exit code 1".into())
        );
        assert_eq!(s.schedule(now), vec![b]);
        assert_eq!(
            s.counts(),
            Counts {
                queued: 0,
                running: 1,
                finished: 1
            }
        );
    }

    #[test]
    fn finished_jobs_are_capped_and_busy_follows_the_tool() {
        let now = Instant::now();
        let mut s = Scheduler::new();
        for _ in 0..(FINISHED_KEPT + 5) {
            let id = s.submit(JobSpec::new("upscale", "x", Lane::Light), now);
            s.schedule(now);
            s.finish(&id, None, now);
        }
        assert_eq!(s.counts().finished, FINISHED_KEPT);
        assert!(s.idle());
        s.submit(JobSpec::new("convert", "y", Lane::Cpu), now);
        assert!(s.busy(Some("convert")) && !s.busy(Some("upscale")));
        s.clear_finished();
        assert_eq!(s.counts().finished, 0);
    }
}
