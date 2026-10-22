#!/usr/bin/env python3
"""Checks the repository's Markdown: every relative link and image points to a file that exists (and, for a link
with a #heading into a Markdown file, to a heading that exists), and every spec in docs/features/ declares its state
on a `Status:` line. Only the standard library; run from anywhere: `python tools/check-docs.py`. Exit code 1 lists
each problem as `file:line: message`.

It checks paths, not behaviour: a feature's real state comes from its tests and reviews (docs/features/README.md)."""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKIP_DIRS = {".git", "target", ".tools", "node_modules"}
LINK = re.compile(r"!?\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)|<(?:img|a)\s[^>]*?(?:src|href)=\"([^\"]+)\"")
STATUS = re.compile(r"^(?:>\s*)?\**Status:?\**:?\s*\S", re.MULTILINE)


def markdown_files():
    for path in ROOT.rglob("*.md"):
        if not SKIP_DIRS.intersection(path.relative_to(ROOT).parts):
            yield path


def anchors(path):
    """GitHub-style slugs of a Markdown file's headings"""
    slugs = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        heading = re.match(r"^#{1,6}\s+(.*?)\s*#*\s*$", line)
        if heading:
            text = re.sub(r"[`*_\[\]()]", "", heading.group(1)).strip().lower()
            slugs.add(re.sub(r"\s", "-", re.sub(r"[^\w\s-]", "", text)))
    return slugs


def check(path):
    problems = []
    text = path.read_text(encoding="utf-8")
    in_code = False
    for number, line in enumerate(text.splitlines(), 1):
        if line.lstrip().startswith("```"):
            in_code = not in_code
        if in_code:
            continue
        for match in LINK.finditer(re.sub(r"`[^`]*`", "", line)):
            target = match.group(1) or match.group(2)
            if re.match(r"^[a-z][a-z0-9+.-]*:", target, re.I) or target.startswith("#"):
                continue
            file_part, _, anchor = target.partition("#")
            resolved = (path.parent / file_part).resolve()
            where = f"{path.relative_to(ROOT)}:{number}"
            if not resolved.exists():
                problems.append(f"{where}: broken link {target}")
            elif anchor and resolved.suffix == ".md" and anchor.lower() not in anchors(resolved):
                problems.append(f"{where}: no heading #{anchor} in {file_part}")
    return problems


def main():
    problems = []
    for path in sorted(markdown_files()):
        problems += check(path)
    features = ROOT / "docs" / "features"
    for spec in sorted(features.glob("*.md")) if features.is_dir() else []:
        if spec.name != "README.md" and not STATUS.search(spec.read_text(encoding="utf-8")):
            problems.append(f"{spec.relative_to(ROOT)}:1: no Status: line")
    for problem in problems:
        print(problem)
    print(f"{len(problems)} problem(s)" if problems else "docs: all links and Status: lines are in place")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
