#!/usr/bin/env python3
"""Tests for the read-only native repository contract checker."""
import importlib.util
import shutil
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("check_structure", Path(__file__).with_name("check-structure.py"))
check = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(check)


class StructureTests(unittest.TestCase):
    def test_current_checkout_passes(self):
        self.assertEqual(check.check_repo(), [])

    def test_missing_feature_spec_index_row_detected(self):
        root = check.ROOT
        with tempfile.TemporaryDirectory(prefix="halation-structure-test-") as directory:
            fixture = Path(directory)
            for rel in (*check.REQUIRED_DOCS, "Cargo.toml", "crates/halation-core/Cargo.toml", "crates/halation-app/Cargo.toml", "AGENTS.md", "CLAUDE.md", "GEMINI.md", ".github/copilot-instructions.md", "tools/dev.py"):
                src = root / rel
                target = fixture / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(src, target)
            for src in (root / "docs/features").glob("*.md"):
                target = fixture / "docs/features" / src.name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(src, target)
            # Baseline fixture is as valid as the original for the contracts tested.
            self.assertEqual(check.check_repo(fixture), [])
            index = fixture / "docs/features/README.md"
            contents = index.read_text(encoding="utf8")
            self.assertIn("[settings.md](settings.md)", contents)
            index.write_text(contents.replace("[settings.md](settings.md)", "settings spec missing"), encoding="utf8")
            self.assertTrue(any("not in traceability index: settings" in issue for issue in check.check_repo(fixture)))

    def test_duplicate_claude_rules_are_detected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "CLAUDE.md").write_text("@AGENTS.md\ncheck cargo after every patch\n", encoding="utf8")
            issues = check.check_repo(root)
            self.assertTrue(any("CLAUDE.md must" in issue for issue in issues))

    def test_forbidden_core_dependency_is_detected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "crates/halation-core").mkdir(parents=True)
            (root / "crates/halation-app").mkdir(parents=True)
            (root / "Cargo.toml").write_text('[workspace]\nmembers=["crates/halation-core", "crates/halation-app"]\n', encoding="utf8")
            (root / "crates/halation-core/Cargo.toml").write_text('[dependencies]\nslint="1"\n', encoding="utf8")
            (root / "crates/halation-app/Cargo.toml").write_text('[dependencies]\nhalation-core={path="../halation-core"}\n', encoding="utf8")
            issues = check.check_repo(root)
            self.assertTrue(any("forbidden UI/runtime dependency" in issue for issue in issues))


if __name__ == "__main__":
    unittest.main(verbosity=2)