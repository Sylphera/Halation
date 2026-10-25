#!/usr/bin/env python3
"""No-dependency tests of the developer workflow; no model or Cargo calls."""
from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import dev


class MapTests(unittest.TestCase):
    def test_all_feature_specs_and_current_source_paths_exist(self):
        for name, area in dev.AREAS.items():
            for path in area.spec + area.code + area.tests:
                with self.subTest(area=name, path=path):
                    self.assertTrue((dev.ROOT / path).is_file(), f"Stale feature mapping: {path}")

    def test_planned_features_are_not_invented_source_paths(self):
        for name in ("cover-test", "downloader", "upscale", "framerate", "vocal-remover"):
            with self.subTest(name=name):
                self.assertEqual(dev.AREAS[name].code, ())

    def test_paths_have_area_membership(self):
        self.assertIn("settings", dev.area_for_file("crates/halation-app/ui/pages/settings.slint"))
        self.assertIn("converter", dev.area_for_file("docs/features/converter.md"))

    def test_symbol_index_has_real_file_lines(self):
        matches = dev.symbols_for_area("frame-capture", "capture")
        self.assertTrue(matches)
        for entry in matches:
            with self.subTest(file=entry["file"], name=entry["name"]):
                source = (dev.ROOT / entry["file"]).read_text(encoding="utf8").splitlines()
                self.assertIn(entry["name"], source[entry["line"] - 1])

    def test_planned_feature_has_no_source_symbols(self):
        self.assertEqual(dev.symbols_for_area("cover-test"), [])

    def test_symbol_index_supports_rust_async_and_slint_callbacks(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / "fixture.rs"
            p.write_text("pub(crate) async fn load_data() {}\nfn second() {}\n", encoding="utf8")
            self.assertEqual([(line, name) for line, _, name in dev.symbol_lines(p)], [(1, "load_data"), (2, "second")])
            p = Path(directory) / "fixture.slint"
            p.write_text("export component A inherits Rectangle {}\n    callback changed(int);\n", encoding="utf8")
            self.assertEqual([(line, name) for line, _, name in dev.symbol_lines(p)], [(1, "A"), (2, "changed")])

    def test_missing_area_is_not_silently_guessed(self):
        with self.assertRaisesRegex(ValueError, "Unknown feature"):
            dev.show_area("does-not-exist", False)


class CheckPlanningTests(unittest.TestCase):
    def test_docs_only_does_not_run_cargo(self):
        checks = dev.checks_for_changes({"docs/features/settings.md"}, "targeted")
        self.assertEqual([ch.argv for ch in checks], [("python", "tools/check-docs.py")])

    def test_tooling_change_has_fast_self_test(self):
        checks = dev.checks_for_changes({"tools/dev.py"}, "fast")
        self.assertEqual([ch.argv for ch in checks], [("python", "tools/test_dev.py"), ("python", "tools/check-docs.py")])

    def test_core_change_targeted(self):
        checks = dev.checks_for_changes({"crates/halation-core/src/queue.rs"}, "targeted")
        cmds = [ch.argv for ch in checks]
        self.assertIn(("cargo", "fmt", "--all", "--check"), cmds)
        self.assertIn(("cargo", "test", "-p", "halation-core", "--locked"), cmds)
        self.assertNotIn(("cargo", "test", "--workspace", "--locked"), cmds)
        self.assertTrue(all("--release" not in c for c in cmds))

    def test_slimit_ui_never_requests_release_build(self):
        checks = dev.checks_for_changes({"crates/halation-app/ui/app.slint"}, "full")
        cmds = [ch.argv for ch in checks]
        self.assertIn(("cargo", "test", "-p", "halation-app", "--locked", "--test", "ui_layout"), cmds)
        self.assertIn(("cargo", "test", "--workspace", "--locked"), cmds)
        self.assertFalse(any("build" in command or "--release" in command for command in cmds))

    def test_shared_cargo_manifest_covers_both_crates(self):
        cmds = [c.argv for c in dev.checks_for_changes({"Cargo.toml"}, "targeted")]
        self.assertIn(("cargo", "check", "-p", "halation-core", "--locked"), cmds)
        self.assertIn(("cargo", "check", "-p", "halation-app", "--locked"), cmds)

    def test_plan_is_dry_run_by_default(self):
        with patch.object(dev.subprocess, "run", side_effect=AssertionError("Executed command during dry run")):
            with redirect_stdout(StringIO()) as output:
                self.assertEqual(dev.run_checks(dev.checks_for_changes({"Cargo.toml"}, "full"), False), 0)
        self.assertIn("DRY RUN", output.getvalue())

    def test_json_run_flag_rejected(self):
        with patch.object(dev, "files_changed", return_value={"Cargo.toml"}), redirect_stderr(StringIO()):
            self.assertEqual(dev.main(["check", "--json", "--run"]), 2)

    def test_handoff_never_claims_checks_passed(self):
        with patch.object(dev, "files_changed", return_value={"docs/features/settings.md"}), patch.object(dev, "git", return_value="slint/workflow\n"):
            result = dev.handoff_report("slint/frame-ui")
        self.assertEqual(result["branch"], "slint/workflow")
        self.assertIn("UNKNOWN", result["verification"])
        self.assertIn("UNKNOWN", result["completion"])
        self.assertIn("settings", result["possible_feature_areas"])

    def test_no_changes_does_not_run_implicit_checks(self):
        self.assertEqual(dev.checks_for_changes(set(), "fast"), [])


class GitScopeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="halation-dev-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.addCleanup(setattr, dev, "ROOT", dev.ROOT)
        dev.ROOT = self.root
        self.command("git", "init", "-q")
        self.command("git", "config", "user.name", "Fixture")
        self.command("git", "config", "user.email", "fixture@example.invalid")
        (self.root / "README.md").write_text("baseline", encoding="utf8")
        self.command("git", "add", ".")
        self.command("git", "commit", "-q", "-m", "baseline")

    def command(self, *args):
        result = subprocess.run(args, cwd=self.root, capture_output=True, text=True, encoding="utf8")
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def test_working_changes_and_untracked_file_with_spaces(self):
        (self.root / "README.md").write_text("changed", encoding="utf8")
        (self.root / "new feature.md").write_text("draft", encoding="utf8")
        self.assertEqual(dev.files_changed(None), {"README.md", "new feature.md"})

    def test_staged_and_committed_since_base(self):
        old = self.command("git", "rev-parse", "HEAD").strip()
        (self.root / "staged file.md").write_text("test", encoding="utf8")
        self.command("git", "add", ".")
        self.assertIn("staged file.md", dev.files_changed(None))
        self.command("git", "commit", "-q", "-m", "second")
        self.assertEqual(dev.files_changed(None), set())
        self.assertIn("staged file.md", dev.files_changed(old))

    def test_readonly_changed_paths_preserves_status(self):
        (self.root / "local.txt").write_text("untracked", encoding="utf8")
        before = self.command("git", "status", "--porcelain")
        dev.files_changed(None)
        after = self.command("git", "status", "--porcelain")
        self.assertEqual(before, after)


if __name__ == "__main__":
    unittest.main(verbosity=2)