#!/usr/bin/env python3
"""Fast, read-only repository contract checks. No Cargo invocation or model usage.

Guards the approved Rust/Slint layout, single agent-policy entrypoint,
feature-spec index coverage and source-backed architecture documentation.
Not a substitute for cargo tree, behavior tests, user visual review or a release audit.
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

try:
    import tomllib
except ImportError:
    tomllib = None

ROOT = Path(__file__).resolve().parent.parent
REQUIRED_DOCS = (
    "docs/architecture/overview.md",
    "docs/architecture/persistence.md",
    "docs/architecture/distribution.md",
    "docs/design/design.md",
    "docs/development/PROJECT_GUIDE.md",
    "docs/DEVELOPMENT.md",
    "docs/features/README.md",
    "docs/README.md",
    "planning/active/repo-reorg.md",
)


def check_repo(root: Path = ROOT) -> list[str]:
    issues: list[str] = []
    def require(rel: str) -> bool:
        if not (root / rel).is_file():
            issues.append(f"missing required file: {rel}")
            return False
        return True

    for f in REQUIRED_DOCS:
        require(f)
    for f in ("Cargo.toml", "crates/halation-core/Cargo.toml", "crates/halation-app/Cargo.toml", "AGENTS.md", "CLAUDE.md", "GEMINI.md", ".github/copilot-instructions.md", "tools/dev.py"):
        require(f)
    for legacy in ("app", "slint", "legacy", ".opencode"):
        if (root / legacy).exists():
            issues.append(f"retired product/tool checkout at repository root: {legacy}")

    if require("AGENTS.md"):
        content = (root / "AGENTS.md").read_text(encoding="utf8")
        for key in ("tools/dev.py onboard", "docs/architecture/overview.md", "docs/design/design.md", "docs/features/README.md"):
            if key not in content:
                issues.append(f"AGENTS.md missing automatic entry reference: {key}")
    if (root / "CLAUDE.md").is_file() and (root / "CLAUDE.md").read_text(encoding="utf8").strip() != "@AGENTS.md":
        issues.append("CLAUDE.md must be a minimal @AGENTS.md adapter, not another policy")
    for adapter in ("GEMINI.md", ".github/copilot-instructions.md"):
        if (root / adapter).is_file() and "AGENTS.md" not in (root / adapter).read_text(encoding="utf8"):
            issues.append(f"{adapter} must point at the single AGENTS.md policy")

    feat = root / "docs/features"
    index = feat / "README.md"
    if index.is_file() and feat.is_dir():
        text = index.read_text(encoding="utf8")
        listed = re.findall(r"\[([\w-]+)\.md\]\(([\w-]+)\.md\)", text)
        names = [left for left, right in listed if left == right]
        for left, right in listed:
            if left != right:
                issues.append(f"feature index link mismatch: {left} vs {right}")
        expected = {p.stem for p in feat.glob("*.md") if p.name != "README.md"}
        actual = set(names)
        for key in sorted(expected - actual):
            issues.append(f"feature spec not in traceability index: {key}")
        for key in sorted(actual - expected):
            issues.append(f"feature index links to nonexistent spec: {key}")
        for key in sorted(expected):
            contents = (feat / f"{key}.md").read_text(encoding="utf8")
            m = re.search(r"^Status:\s*(?:\*\*)?(Planned|Partial|Implemented)", contents, re.M | re.I)
            if not m:
                issues.append(f"feature spec missing recognizable Status: {key}")
                continue
            # Status is copied from the source, not guessed from the path.
            row = next((line for line in text.splitlines() if line.startswith("| ") and f"[{key}.md]({key}.md)" in line), None)
            if row is None:
                continue
            cells = [c.strip() for c in row.split("|")]
            declared = cells[2].lower() if len(cells) > 3 else ""
            if m.group(1).lower() not in declared:
                issues.append(f"index status disagrees with spec for {key}: {m.group(1)}")

    if tomllib is not None and (root / "Cargo.toml").exists():
        try:
            workspace = tomllib.loads((root / "Cargo.toml").read_text(encoding="utf8"))
            members = set(workspace.get("workspace", {}).get("members", []))
            if not {"crates/halation-core", "crates/halation-app"}.issubset(members):
                issues.append("Cargo workspace missing required core/app members")
            core = tomllib.loads((root / "crates/halation-core/Cargo.toml").read_text(encoding="utf8"))
            app = tomllib.loads((root / "crates/halation-app/Cargo.toml").read_text(encoding="utf8"))
            for section in ("dependencies", "dev-dependencies", "build-dependencies"):
                for name, value in core.get(section, {}).items():
                    if "slint" in name.lower() or "tauri" in name.lower() or "qt" == name.lower():
                        issues.append(f"core has forbidden UI/runtime dependency: {section}.{name}")
                    if isinstance(value, dict) and "path" in value and not (root / "crates/halation-core" / value["path"]).resolve().is_relative_to(root):
                        issues.append(f"core has a path dependency outside the checkout: {section}.{name}")
            if "halation-core" not in app.get("dependencies", {}):
                issues.append("halation-app must depend on halation-core")
        except (OSError, ValueError, KeyError) as e:
            issues.append(f"cannot parse workspace manifests: {e}")
    else:
        issues.append("Python >=3.11 and Cargo manifests required to verify dependency contracts")
    return issues


def main() -> int:
    issues = check_repo()
    for message in issues:
        print(message)
    print(f"structure: {len(issues)} problem(s)" if issues else "structure: architecture, agent entrypoints, feature index and workspace contracts OK")
    return 1 if issues else 0


if __name__ == "__main__":
    sys.exit(main())