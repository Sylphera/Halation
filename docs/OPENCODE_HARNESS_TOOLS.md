# Harness tools in OpenCode

Status: 2026-10-19. Scope: this repository and any checkout that inherits the
user-level layer. Replaces the retired Codex harness: Serena (MCP), Context7,
the Playwright CLI recipe and the `halation-dev` skill.

## 1. Where each piece lives

| Piece | Location | Layer | Why |
| --- | --- | --- | --- |
| Models, variants, MCP grants, prompts | `~/.config/opencode/oh-my-opencode-slim.jsonc` | User | shared by every checkout |
| Official plugin registration | `~/.config/opencode/opencode.json` | User | one cached OmO Slim 3.0.4 for all projects |
| Coordinator and worker prompts | `~/.opencode/oh-my-opencode-slim/` | User | resolved nearest-first; replace, never merge |
| Skill `halation-dev` | user skills directory (`~/.opencode/skills/`) | User | Serena navigation, bounded docs, build/test/run |
| Serena MCP server | `~/.config/opencode/opencode.json` (`mcp.serena`) | User | started per session via MCP |
| Serena project definition | `.serena/project.yml` | Local (ignored) | paths and languages of this tree |
| Context7 | OmO grant `mcps` (remote MCP) | User | narrow third-party documentation |
| Task sidebar adapter | `.opencode/ui-patches/` | Project (versioned) | presentation only |
| Probes, evidence, handoffs | `.tools/dev/`, other `.tools/` dirs | Local (ignored) | never product |

No project-level prompt copy may shadow the user prompts. The project layer
carries no agent, model or MCP policy.

## 2. Serena

Serena runs as a local MCP server (`serena start-mcp-server --context agent
--project-from-cwd`). The project definition is local and unversioned because it
contains machine-specific paths; `.serena/` is ignored in full.

A local `project.yml` defines: project name, ignored paths (`.tools`,
`.worktrees`, caches), and the enabled language servers. For this tree the
useful set is TypeScript, Rust, JSON, Python and YAML. QML is declared but not
activated: `qmlls` does not expose `documentSymbol`, so the navigation tools do
not work for QML. C++/clangd is intentionally off until the Qt phase needs it.

Activation rules:

- Do not restart or reinstall Serena, start language servers or open the web
  dashboard as part of ordinary repository work.
- Memories, caches and override files stay local. Never commit them or copy
  them into public documentation.
- A fresh checkout needs a local `.serena/project.yml` before Serena is useful;
  this is a local setup step, not a repository file.

## 3. Context7

Context7 is a remote MCP granted to workers through the user-layer
`mcps` policy. Usage is deliberately narrow:

- third-party library, SDK, CLI or API documentation directly needed by the
  assigned unit;
- one topic per query;
- no broad research, no web browsing, no credentials or private code in the
  query.

The worker prompt states the same restriction, so the grant and the instruction
agree.

## 4. Playwright CLI over CDP

The `halation-dev` skill documents an optional user-level Playwright CLI that can
drive a local Chromium over CDP for functional UI checks. It is not a
repository dependency and is not installed by the repository.

- Use it only when the task is about visible behavior and the user authorized
  running the app.
- Do not launch the app, a browser or a CDP endpoint merely to prove the harness
  works.
- During manual visual iterations, do not generate screenshots, videos, frame
  sequences or RGB comparisons. Visual approval is manual; automated evidence
  only on explicit request.

## 5. Verification discipline

Separate **configured** from **executed**:

- configured: `opencode debug config`, `opencode plugin list`, file presence and
  hashes;
- executed: a session that actually used the tool, or a focal probe that
  exercises the real path without opening a window.

Probes must not print credentials, tokens, session transcripts or personal
paths. Evidence files stay under `.tools/` (ignored) and are referenced by
purpose, not linked into public docs.

Useful commands:

```powershell
opencode debug config
opencode plugin list
git -C <checkout> status --porcelain
```

## 6. Limits and recovery

- MCP availability depends on the host configuration and network for Context7;
  a plugin list entry does not prove a worker used a tool.
- Serena symbol coverage depends on the language server; QML is limited as
  described above.
- If Serena state is corrupt, delete the local `.serena/` directory and let the
  project definition be recreated; never rewrite the shared MCP registration
  from a repository task.
- If a probe is stale or contains hardcoded paths from another checkout, fix the
  probe in `.tools/dev/` instead of adapting the host configuration.
