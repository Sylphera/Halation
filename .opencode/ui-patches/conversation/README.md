# Readable coordinator conversation

User-authorized presentation preferences, 2026-10-18. This uses native OpenCode transcript grouping, not a replacement transcript, message filter or server patch. The approved OmO task sidebar is unchanged.

Merge `cli-preferences.json` into the existing global `~/.config/opencode/cli.json`; do not replace unrelated preferences. OpenCode has no project-local CLI settings file. This affects the terminal UI globally, not model reasoning effort, prompts, server transport or worker scheduling. Existing sidebar and permission settings are preserved. Valid edits reload live. Tool/thought sequences are summarized at low verbosity; native group expansion retains technical details. This does not rewrite stored messages or clean exported transcripts. Already manually expanded groups can retain their per-session expansion state.

The separate, approved communication rules in `AGENTS.md` and the orchestrator append ask for outcome, consequence and next step, meaningful updates only, and no repeated internal permission acknowledgements. They retain failure reporting, permission controls and substantive final delivery. They apply to subsequent turns; historical prose is unchanged. No model was prompted solely to demonstrate the new wording.

Verification: the open TUI's native keymap reported `Verbosity: Low` after the file edit, without tab switching or service restart. Temporary observation code was removed. Configuration reload succeeded and the same two active native sessions remained active before and after. The approved sidebar bundle hash was unchanged and its six projection tests passed. These checks verify activation and preservation, not visual acceptance of the conversation or a guarantee of future model wording. Manual visual review remains pending. No screenshots, product edits, commits or remote operations.

Rollback: remove only the three added session preference keys (or restore their previous values), preserving subsequent unrelated changes. Remove the new readability paragraph from the orchestrator append and the corresponding repository instruction if desired. Local before-copies and activation evidence are under `.tools/conversation-readability/`; never replace newer settings wholesale with an old backup.

Native references: [CLI settings and live reload](https://opencode.ai/v2/docs/cli/config), [published session verbosity schema](https://opencode.ai/v2/cli.json).
