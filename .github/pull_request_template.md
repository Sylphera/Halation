## Outcome and acceptance

- What **working behavior** changed? Link the source feature spec and show pending acceptance criteria; do not equate new files/LOC with completion.
- Which worktree/integration base? Any overlapping WIP on app.rs, app.slint, navigation, models or assets?
- For design/layout: which current approved [design contract](../docs/design/design.md) and actual native-window review apply? Explicitly state **pending human review** when not approved.

## Evidence and checks

- [ ] `python tools/dev.py onboard` for a fresh checkout (or equivalent repository reading)
- [ ] `python tools/dev.py check --mode targeted` was used to scope the check plan
- [ ] `python tools/test_dev.py` and `python tools/test_structure.py` if tooling or CI changed
- [ ] `python tools/check-docs.py` and `python tools/check-structure.py` if docs/architecture changed
- [ ] Applicable Cargo fmt/check/tests run at **milestones**, not after each micro-edit
- [ ] Final workspace checks as appropriate, with actual results and pending checks disclosed
- [ ] Data/profile/update/release effects? Confirmed no real-user migration or installer release without approval

## Tests actually run, remaining work, evidence

Commands and results:

Remaining acceptance or manual review:

No merge into `main`, package publication or installer execution is authorized by this PR template.
