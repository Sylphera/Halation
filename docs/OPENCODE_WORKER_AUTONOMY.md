# Worker autonomy (OmO Slim)

Status: 2026-10-19. Prompts and grants live in the user layer; runtime behavior
is confirmed by worker sessions, not by inspecting transcripts.

## Contract

A worker receives **one complete unit** of engineering work: goal, owned files
or areas, acceptance criteria, checks and required evidence. It owns the whole
cycle inside its session — understand, investigate, design within scope,
implement in small steps, test, diagnose, correct, re-verify and self-review —
and returns only when the unit is complete, blocked or a product decision is
required.

A worker does not:

- expand the unit into adjacent systems or unrelated cleanups;
- disable, skip or weaken tests to obtain green output;
- switch provider or model to escape a failing check;
- push, open pull requests, merge, release or restart host services without
  explicit authorization.

The coordinator keeps one conversation visible, delegates without duplicating
the worker's task, and reconciles sessions and commits after interruptions. It
may split into parallel units only when scopes are disjoint and there is no
mutual dependency; otherwise one worker owns the converging deliverable.

## Prompt composition

The plugin resolves prompts nearest-first:

1. the user layer (`~/.opencode/oh-my-opencode-slim/`) defines the base prompt
   for orchestrator, fixer and explorer;
2. an `_append` file in the same layer adds coordinator or worker policy;
3. a project file with the same name **replaces** the ancestor prompt; it does
   not merge.

Because replacement is destructive, this repository deliberately ships no
project-level prompt copies. Project rules live in `AGENTS.md` and this docs
set; worker policy lives in the user layer so every checkout inherits it.

## Models

- Coordinator: `openai/gpt-6.1-sol` at medium.
- Workers: DeepSeek Flash Free by default, with the maximum variant where
  configured; Luna medium is the provider fallback; LongCat is a deliberate last
  resort for simple tasks after both are unavailable.
- A failing test or build is not a model-availability signal. Diagnose the code
  and fix the cause.

## Evidence

A completed unit reports:

- files changed and why;
- commands actually run and their results;
- the behavior verified directly, beyond existing tests;
- self-review: regressions checked, scope respected, requirements re-read;
- remaining limits, integration needs or the exact blocker.

A build or a green test is implementation evidence, not completion evidence.
Configured-but-unexecuted capabilities must be labeled as such.

## What the plugin does not provide

- No scheduler, queue, polling or automatic retry for workers.
- No cross-session reconciliation of commits or worktrees.
- No guarantee that an idle worker means the mission is complete.
- No transcript reading or run-log inspection from the sidebar; it shows native
  session state only.

## Limits and rollback

Worker behavior depends on the user-layer prompts and configuration. Changing
or rolling back that policy is a user-layer action outside this repository; the
repository only records the current contract. If a worker ignores its unit,
stop it and re-issue a bounded unit; do not compensate by widening the
coordinator's scope.
