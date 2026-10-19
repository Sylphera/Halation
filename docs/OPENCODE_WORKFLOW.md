# OpenCode workflow (OmO Slim)

Status: 2026-10-19. Verified against OpenCode 2.0.32 and the official
`oh-my-opencode-slim` 3.0.4 plugin. This document records the repository
adapter and the shared user-level harness; it is not a visual approval.

## Layers

| Layer | Lives in | Contains | Versioned |
| --- | --- | --- | --- |
| User | `~/.config/opencode/opencode.json`, `~/.config/opencode/oh-my-opencode-slim.jsonc`, `~/.opencode/` | official plugin registration, models, prompts, skills, MCP grants, CLI preferences | no |
| Project (this repository) | `.opencode/` | registration of the local sidebar presentation, default agent and model for this tree, project overrides | yes |
| Local state | `.tools/`, `.serena/` | probes, evidence, handoffs, Serena project and memories | no (ignored) |

The rule: anything that must behave the same in every checkout belongs to the
user layer. The repository only carries rules, languages, project context and
the minimum adapter. Versioned files must not contain personal paths, session
IDs, credentials or private evidence.

## Working session

- One visible conversation with the `orchestrator` agent (`openai/gpt-6.1-sol`,
  medium) coordinates work. Implementation, broad research, tests and fixes are
  delegated to native workers; the coordinator does not duplicate their work.
- One unit of work = one worker. A unit carries goal, owned files, acceptance
  criteria, checks and evidence. Split into parallel lanes only when scopes are
  genuinely disjoint and independent.
- Workers: DeepSeek Flash Free by default; Luna medium is the provider fallback;
  LongCat is a deliberate last resort for simple tasks. A failing test or build
  is a code problem: diagnose it, do not switch models to escape it.
- The coordinator may continue independent work while workers run; it must not
  poll. Results return to the conversation. Reconcile sessions and commits
  before repeating work after an interruption.
- Do not push, open PRs, merge to remote `main`, release or restart host
  services without explicit user authorization.

## Task sidebar

The repository registers a local presentation plugin at
`.opencode/ui-patches/omo-slim-3.0.4/plugin`. It replaces the stock role/model
catalog with the actual native child tasks of the visible conversation. The
official server package keeps its dispatch, providers, fallback, workers and Git
behavior unchanged.

The compiled presentation is not vendored. It is loaded from a neutral
user-level runtime:

- `OMO_READABLE_SIDEBAR_RUNTIME`, when set (absolute path, portable relocation);
- `~/.local/share/omo-slim-readable-ui/3.0.4` (shared runtime);
- `<checkout>/.tools/orchestrator-replacement/runtime` (legacy local build).

`runtime-manifest.json` pins the package version and the sha256 of the compiled
`dist/tui2.js`; every candidate is checked against both. A missing, stale or
rebuilt-without-update runtime produces an explicit startup error listing the
paths checked and the recovery procedure. The sidebar is never silently
replaced by the stock one. See the patch README for the runtime layout, the
rebuild recipe and the rollback.

## Verification

```powershell
opencode debug config     # effective user + project configuration
opencode plugin list      # official plugin + local presentation plugin
```

The wrapper can be probed without opening the UI: importing
`.opencode/ui-patches/omo-slim-3.0.4/plugin/tui.js` with bun resolves the pinned
runtime and reaches the host-provided `@opentui` modules; a missing runtime
fails first, with the explicit error. The projection tests run with the pinned
bun (`bun test readable-sidebar.test.ts`): 6 tests.

Configured is not executed: a plugin list entry does not prove the TUI mounted
the presentation. Live mount evidence is per-conversation and remains manual;
visual acceptance is always manual.

## Boundaries and recovery

- The old Codex/Drive harness is retired. Do not restore `.agent-harness/`, its
  plugin or `agent-harness.cmd`.
- OpenChamber is installed and launched independently of this repository; its
  staged UI patch is not applied and no host restart is performed from here.
- Rollback of the sidebar: remove the presentation entry from
  `.opencode/opencode.json`; the official TUI remains.
- Rollback of local Serena state: delete `.serena/` (ignored; never versioned).
- Runtime updates: rebuild from the pinned upstream commit and `tui.patch`,
  copy the artifact to the shared runtime, update the manifest hash, rerun the
  projection tests. Do not patch OpenCode's shared npm cache: other projects
  use it.
