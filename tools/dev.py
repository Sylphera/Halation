#!/usr/bin/env python3
"""Zero-dependency developer entrypoint for Halation Slint.

No command runs a model, installs packages, launches the app or builds a release.
Checks are DRY-RUN by default; --run explicitly allows only the listed commands.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Area:
    purpose: str
    spec: tuple[str, ...]
    code: tuple[str, ...]
    tests: tuple[str, ...]


# An index of *starting points*, not a duplicate product specification.
# Planned features deliberately have a spec but no invented implementation path.
AREAS: dict[str, Area] = {
    "settings": Area("Global preferences, search and persistence", ("docs/features/settings.md", "docs/features/save-location.md"), ("crates/halation-app/ui/pages/settings.slint", "crates/halation-core/src/settings.rs", "crates/halation-app/src/navigation.rs"), ("crates/halation-app/tests/services.rs", "crates/halation-app/tests/ui_layout.rs")),
    "navigation": Area("Page history, sidebar and shell", ("planning/active/ui-redesign.md", "docs/SLINT_VISUAL_SYSTEM.md"), ("crates/halation-app/src/navigation.rs", "crates/halation-app/src/app.rs", "crates/halation-app/ui/app.slint"), ("crates/halation-app/src/app/tests.rs", "crates/halation-app/tests/ui_layout.rs")),
    "frame-capture": Area("Native frame capture and decoding", ("docs/features/frame-capture.md", "docs/SLINT_BACKEND_IMPORT.md"), ("crates/halation-core/src/framegrab.rs", "crates/halation-core/src/frame_decoder.rs", "crates/halation-app/src/framegrab.rs", "crates/halation-app/ui/pages/framegrab.slint"), ("crates/halation-core/src/framegrab/tests.rs", "crates/halation-app/src/framegrab/tests.rs", "crates/halation-app/tests/services.rs", "crates/halation-app/tests/ui_layout.rs")),
    "converter": Area("Media conversion, jobs and destinations", ("docs/features/converter.md",), ("crates/halation-core/src/convert.rs", "crates/halation-app/src/converter.rs", "crates/halation-app/ui/pages/converter.slint"), ("crates/halation-app/src/converter/tests.rs", "crates/halation-app/tests/services.rs", "crates/halation-app/tests/ui_layout.rs")),
    "jobs": Area("Shared processing, queue and engines", ("docs/features/jobs.md",), ("crates/halation-core/src/jobs.rs", "crates/halation-core/src/queue.rs", "crates/halation-core/src/process.rs", "crates/halation-core/src/engine.rs"), ("crates/halation-app/tests/services.rs",)),
    "library": Area("Media library, sections and folders", ("docs/features/library.md",), ("crates/halation-core/src/library.rs", "crates/halation-core/src/sections.rs", "crates/halation-app/src/library.rs", "crates/halation-app/ui/pages/library.slint"), ("crates/halation-app/tests/services.rs", "crates/halation-app/tests/ui_layout.rs")),
    "home": Area("Home and visual shell", ("docs/SLINT_VISUAL_SYSTEM.md", "planning/active/ui-redesign.md"), ("crates/halation-app/ui/pages/home.slint", "crates/halation-app/ui/app.slint", "crates/halation-app/src/backdrop.rs"), ("crates/halation-app/tests/ui_layout.rs",)),
    "assets": Area("Staged local icons, fonts and artwork", ("docs/SLINT_VISUAL_SYSTEM.md",), ("crates/halation-app/src/assets.rs", "crates/halation-app/build.rs"), ("crates/halation-app/src/assets.rs",)),
    "cover-test": Area("Planned native cover preview tool", ("docs/features/cover-test.md",), (), ()),
    "downloader": Area("Planned native downloader", ("docs/features/downloader.md",), (), ()),
    "audio-visualizer": Area("Planned native audio visualization", ("docs/features/audio-visualizer.md",), (), ()),
    "upscale": Area("Planned native AI upscaling", ("docs/features/upscale.md",), (), ()),
    "framerate": Area("Planned native interpolation", ("docs/features/framerate.md",), (), ()),
    "remove-background": Area("Planned native background removal", ("docs/features/remove-background.md",), (), ()),
    "grade-looks": Area("Planned native image grading", ("docs/features/grade-looks.md",), (), ()),
    "vocal-remover": Area("Planned native vocal separation", ("docs/features/vocal-remover.md",), (), ()),
}


# A lightweight *output-bounded* symbol index. It reads local source to find line
# numbers, but never feeds whole large modules back into an agent conversation.
RUST_SYMBOL = re.compile(r"^\s*(?:(?:pub(?:\([^)]*\))?|async|unsafe|const)\s+)*fn\s+(\w+)\b")
SLINT_SYMBOL = re.compile(r"^\s*(?:(?:export|private|pure)\s+)*(?:component|global|callback|function)\s+([\w-]+)\b")


def symbol_lines(path: Path) -> list[tuple[int, str, str]]:
    regex = RUST_SYMBOL if path.suffix == ".rs" else SLINT_SYMBOL
    if path.suffix not in (".rs", ".slint") or not path.is_file():
        return []
    symbols = []
    for line_no, line in enumerate(path.read_text(encoding="utf8").splitlines(), 1):
        match = regex.match(line)
        if match:
            symbols.append((line_no, "fn" if path.suffix == ".rs" else "ui", match.group(1)))
    return symbols


def symbols_for_area(area_name: str, find: str | None = None) -> list[dict[str, object]]:
    if area_name not in AREAS:
        raise ValueError(f"Unknown feature '{area_name}'. Run 'map' to see known areas.")
    results = []
    seen = set()
    for relative in AREAS[area_name].code:
        if relative in seen:
            continue
        seen.add(relative)
        for line_no, kind, name in symbol_lines(ROOT / relative):
            if find is None or find.casefold() in name.casefold():
                results.append({"file": relative, "line": line_no, "kind": kind, "name": name})
    return results


class GitError(RuntimeError):
    pass


def git(*args: str) -> str:
    cmd = ["git", "-C", str(ROOT), *args]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode:
        raise GitError(f"git {args[0]}: {proc.stderr.strip()}")
    return proc.stdout


def safe_paths(blob: str) -> set[str]:
    """Git -z output includes filenames with spaces and platform-specific Unicode."""
    return {name.replace("\\", "/") for name in blob.split("\0") if name}


def files_changed(base: str | None) -> set[str]:
    # Compare committed branch work against merge-base if specified, then include WIP.
    changed = set()
    if base:
        merge_base = git("merge-base", base, "HEAD").strip()
        changed |= safe_paths(git("diff", "--name-only", "-z", merge_base, "HEAD"))
    changed |= safe_paths(git("diff", "--name-only", "-z"))
    changed |= safe_paths(git("diff", "--cached", "--name-only", "-z"))
    changed |= safe_paths(git("ls-files", "--others", "--exclude-standard", "-z"))
    return changed


def area_for_file(path: str) -> list[str]:
    return sorted(key for key, area in AREAS.items() if path in area.spec + area.code + area.tests)


def status_from_spec(relative: str) -> str:
    path = ROOT / relative
    if not path.is_file():
        return "missing"
    for line in path.read_text(encoding="utf-8").splitlines()[:20]:
        if line.lower().startswith("status:"):
            return line.split(":", 1)[1].strip()
    return "not declared"


def categorize(changed: set[str]) -> set[str]:
    groups = set()
    for name in changed:
        if name.startswith("assets/"):
            groups.update(("assets", "app", "ui"))
        if name.startswith("crates/halation-core/"):
            groups.add("core")
        if name.startswith("crates/halation-app/"):
            groups.add("app")
            if name.startswith("crates/halation-app/ui/") or name.endswith("ui_layout.rs"):
                groups.add("ui")
        if name.endswith(".rs") or name in ("Cargo.toml", "Cargo.lock", "rust-toolchain.toml"):
            groups.add("rust")
        if name.endswith(".slint"):
            groups.update(("rust", "ui"))
        if name.endswith(".md") or name.startswith(("docs/", "planning/", "archive/")):
            groups.add("docs")
        if name.startswith("tools/") or name.startswith(".github/workflows/"):
            groups.add("tooling")
        if name in ("Cargo.toml", "Cargo.lock", "rust-toolchain.toml"):
            groups.update(("core", "app", "rust"))
    return groups


@dataclass(frozen=True)
class Check:
    argv: tuple[str, ...]
    reason: str

    def command(self) -> str:
        return subprocess.list2cmdline(list(self.argv))


def checks_for_changes(changed: set[str], mode: str) -> list[Check]:
    groups = categorize(changed)
    checks: list[Check] = []

    def add(args: tuple[str, ...], why: str) -> None:
        check = Check(args, why)
        if all(existing.argv != check.argv for existing in checks):
            checks.append(check)

    if "tooling" in groups:
        add(("python", "tools/test_dev.py"), "Workflow tooling self-tests")
    if "docs" in groups or "tooling" in groups:
        add(("python", "tools/check-docs.py"), "Documentation links and feature status")
    if "rust" in groups or mode == "full":
        add(("cargo", "fmt", "--all", "--check"), "Formatting is fast; never changes source")
    if mode == "targeted":
        if "core" in groups:
            add(("cargo", "check", "-p", "halation-core", "--locked"), "Core crate integration")
            add(("cargo", "test", "-p", "halation-core", "--locked"), "Core regression tests")
        if "app" in groups:
            add(("cargo", "check", "-p", "halation-app", "--locked"), "Native app + Slint integration")
            add(("cargo", "test", "-p", "halation-app", "--locked", "--lib"), "Native app unit tests")
            if "ui" in groups:
                add(("cargo", "test", "-p", "halation-app", "--locked", "--test", "ui_layout"), "UI structure and interaction regression tests")
            if "ui" not in groups or any(n.startswith("crates/halation-app/src/") for n in changed):
                add(("cargo", "test", "-p", "halation-app", "--locked", "--test", "services"), "App service and controller tests")
    if mode == "full":
        add(("cargo", "clippy", "--workspace", "--all-targets", "--locked", "--", "-D", "warnings"), "Workspace lint, required before integration")
        add(("cargo", "test", "--workspace", "--locked"), "Complete workspace tests before integration")
        add(("python", "tools/check-docs.py"), "Documentation integrity")
    return checks


def environment_report() -> dict[str, object]:
    required = ["Cargo.toml", "rust-toolchain.toml", "crates/halation-core/src/lib.rs", "crates/halation-app/ui/app.slint", "AGENTS.md", "docs/README.md"]
    tools = {name: bool(shutil.which(name)) for name in ("git", "python", "cargo", "rustc")}
    return {"root": str(ROOT), "branch": git("branch", "--show-current").strip(), "required_paths": {name: (ROOT / name).exists() for name in required}, "commands_on_path": tools, "dirty_paths": len(files_changed(None))}


def show_area(query: str | None, json_mode: bool) -> None:
    if query is None:
        if json_mode:
            print(json.dumps({key: area.purpose for key, area in AREAS.items()}, indent=2))
        else:
            for key, area in AREAS.items():
                print(f"{key:20} {area.purpose}")
        return
    choices = {key: area for key, area in AREAS.items() if query.lower() in key.lower()}
    if not choices:
        raise ValueError(f"Unknown feature '{query}'. Run 'map' to see known areas.")
    if json_mode:
        print(json.dumps({key: asdict(area) for key, area in choices.items()}, indent=2))
        return
    for key, area in choices.items():
        print(f"{key}: {area.purpose}")
        for kind, paths in (("Specifications", area.spec), ("Implementation", area.code), ("Relevant tests", area.tests)):
            print(f"  {kind}:")
            if not paths:
                print("    - not yet implemented here; inspect the active spec before designing")
            for path in paths:
                marker = "" if (ROOT / path).exists() else " [MISSING]"
                tag = f" ({status_from_spec(path)})" if path.startswith("docs/features/") else ""
                print(f"    - {path}{tag}{marker}")


def handoff_report(base: str | None) -> dict[str, object]:
    """Generate a factual checkpoint without rereading source or claiming validation."""
    changed = files_changed(base)
    return {
        "branch": git("branch", "--show-current").strip(),
        "compared_with": base or "working tree against HEAD",
        "modified_paths": sorted(changed),
        "possible_feature_areas": sorted({feature for path in changed for feature in area_for_file(path)}),
        "changed_code_categories": sorted(categorize(changed)),
        "targeted_checks_not_yet_executed": [c.command() for c in checks_for_changes(changed, "targeted")],
        "verification": "UNKNOWN ? run the checks and record actual results",
        "completion": "UNKNOWN ? compare user acceptance criteria and behavior before claiming done",
    }


def run_checks(checks: list[Check], do_run: bool) -> int:
    if not checks:
        print("No changes detected that require the mapped checks. Specify --base to inspect committed changes.")
        return 0
    for n, check in enumerate(checks, 1):
        print(f"{n}. {check.command()}  # {check.reason}", flush=True)
    if not do_run:
        print("DRY RUN â€” pass --run to execute. For Rust, --mode targeted/full must be selected explicitly.")
        return 0
    for check in checks:
        result = subprocess.run(check.argv, cwd=ROOT, check=False)
        if result.returncode:
            print(f"FAILED ({result.returncode}): {check.command()}", file=sys.stderr)
            return result.returncode
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    doctor = sub.add_parser("doctor", help="Read-only toolchain/checkout diagnosis")
    doctor.add_argument("--json", action="store_true")
    mapping = sub.add_parser("map", help="Find specs, source and tests for a feature")
    mapping.add_argument("area", nargs="?")
    mapping.add_argument("--json", action="store_true")
    handoff = sub.add_parser("handoff", help="Factual Git-backed handoff for a new agent or contributor")
    handoff.add_argument("--base", help="Include commits since merge-base with the given ref")
    handoff.add_argument("--json", action="store_true")
    symbols = sub.add_parser("symbols", help="Bounded symbol/line locator for large Rust + Slint modules")
    symbols.add_argument("area", choices=tuple(AREAS))
    symbols.add_argument("--find", help="Filter symbol names, case-insensitive substring")
    symbols.add_argument("--limit", type=int, default=35, help="Maximum number of matches shown (1..200)")
    symbols.add_argument("--json", action="store_true")
    changes = sub.add_parser("changes", help="Show changed paths (including WIP)")
    changes.add_argument("--base", help="Compare committed branch changes from merge-base with ref")
    changes.add_argument("--json", action="store_true")
    check = sub.add_parser("check", help="Propose a minimal test plan; DRY RUN by default")
    check.add_argument("--base", help="Compare against Git reference and include uncommitted files")
    check.add_argument("--mode", choices=("fast", "targeted", "full"), default="fast")
    check.add_argument("--run", action="store_true", help="Explicitly run checks (no releases)")
    check.add_argument("--json", action="store_true", help="Emit the dry-run test plan as JSON")
    args = parser.parse_args(argv)
    try:
        if args.command == "doctor":
            report = environment_report()
            if args.json:
                print(json.dumps(report, indent=2))
            else:
                print("Checkout:", report["root"], "branch:", report["branch"])
                print("Toolchain:", ", ".join(f"{k}={'yes' if v else 'MISSING'}" for k,v in report["commands_on_path"].items()))
                print("Required paths:", "OK" if all(report["required_paths"].values()) else "MISSING")
                print("Changed/untracked paths:", report["dirty_paths"])
            return 0 if all(report["required_paths"].values()) else 1
        if args.command == "map":
            show_area(args.area, args.json)
            return 0
        if args.command == "symbols":
            if not 1 <= args.limit <= 200:
                raise ValueError("--limit must be between 1 and 200")
            results = symbols_for_area(args.area, args.find)
            limited = results[:args.limit]
            if args.json:
                print(json.dumps({"matches": limited, "total": len(results), "truncated": len(results) > len(limited)}, indent=2))
            else:
                for item in limited:
                    print(f"{item['file']}:{item['line']}: {item['kind']} {item['name']}")
                if len(results) > len(limited):
                    print(f"... {len(results) - len(limited)} more; use --find <symbol> or raise --limit")
                if not results:
                    print("No matching native source symbols. Run 'map' to see the feature status.")
            return 0
        if args.command == "handoff":
            report = handoff_report(args.base)
            if args.json:
                print(json.dumps(report, indent=2))
            else:
                print(f"# Handoff: {report['branch']}")
                print("Compared with:", report["compared_with"])
                print("Modified paths:")
                for name in report["modified_paths"]:
                    print("-", name)
                print("Likely areas:", ", ".join(report["possible_feature_areas"]) or "none mapped")
                print("Categories:", ", ".join(report["changed_code_categories"]) or "none")
                print("Suggested checks (NOT executed):")
                for cmd in report["targeted_checks_not_yet_executed"]:
                    print("-", cmd)
                print("Verification:", report["verification"])
                print("Completion:", report["completion"])
                print("Add: original user request, actual code outcome, test results, blockers and remaining work.")
            return 0
        changed = files_changed(args.base)
        if args.command == "changes":
            result = [{"path": path, "areas": area_for_file(path)} for path in sorted(changed)]
            if args.json:
                print(json.dumps(result, indent=2))
            else:
                for item in result:
                    print(item["path"], "  [" + ", ".join(item["areas"]) + "]" if item["areas"] else "")
            return 0
        checks = checks_for_changes(changed, args.mode)
        if args.json:
            if args.run:
                raise ValueError("--json cannot be used with --run")
            print(json.dumps({"mode": args.mode, "changed": sorted(changed), "checks": [asdict(c) for c in checks]}, indent=2))
            return 0
        return run_checks(checks, args.run)
    except (GitError, ValueError, OSError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())