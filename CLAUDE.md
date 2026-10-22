@AGENTS.md

## Claude Code only

- Subagents in `.claude/agents/`: `test-runner` runs the checks of `AGENTS.md` and reports failures or "all green";
  `visual-reviewer` reviews offscreen screenshots against the criteria it is given. Neither edits files.
- Skills in `.claude/skills/`: `context7` (current library docs before using an API the code does not use yet) and
  `frontend-design` (visual direction for new UI).
- Implementation runs at High effort, one phase after another; no agent teams, no fast mode.
