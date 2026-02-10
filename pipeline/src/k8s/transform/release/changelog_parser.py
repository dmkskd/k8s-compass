"""
Parse Kubernetes CHANGELOG files to extract structured data.

This module parses CHANGELOG-X.YY.md files to extract:
- Urgent Upgrade Notes (breaking changes)
- Security Information (CVEs)
- Patch releases with their changes
- Dependencies (added/changed/removed)
"""

import re
import sys
from dataclasses import dataclass, field
from typing import Any

from ...input.upstream_stager import CHANGELOGS_DIR


def log(msg: str) -> None:
    """Print with flush for immediate output."""
    print(msg, file=sys.stderr, flush=True)


@dataclass
class ChangeEntry:
    """A single change entry from the CHANGELOG."""

    description: str
    pr_number: int | None = None
    pr_url: str | None = None
    author: str | None = None
    sigs: list[str] = field(default_factory=list)


@dataclass
class CVEEntry:
    """A CVE/security entry from the CHANGELOG."""

    cve: str
    title: str
    description: str
    affected_versions: list[str] = field(default_factory=list)
    fixed_versions: list[str] = field(default_factory=list)
    affected_components: list[str] = field(default_factory=list)
    reporter: str | None = None
    patch_version: str | None = None


@dataclass
class ActionRequiredNote:
    """An action required note (breaking change requiring user action)."""

    description: str
    pr_number: int | None = None
    pr_url: str | None = None
    author: str | None = None
    sigs: list[str] = field(default_factory=list)


@dataclass
class PatchRelease:
    """A patch release (e.g., 1.35.1)."""

    version: str
    changelog_since: str | None = None
    security_fixes: list[CVEEntry] = field(default_factory=list)
    changes_by_kind: dict[str, list[ChangeEntry]] = field(default_factory=dict)
    dependencies: dict[str, list[str]] = field(default_factory=dict)


@dataclass
class ParsedChangelog:
    """Complete parsed CHANGELOG data."""

    version: str
    action_required: list[ActionRequiredNote] = field(default_factory=list)
    security_information: list[CVEEntry] = field(default_factory=list)
    patch_releases: list[PatchRelease] = field(default_factory=list)
    dependencies: dict[str, list[str]] = field(default_factory=dict)


# Regex patterns
VERSION_HEADER_RE = re.compile(r"^# (v\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?)\s*$", re.MULTILINE)
CHANGELOG_SINCE_RE = re.compile(r"## Changelog since (v[\d.]+(?:-[\w.]+)?)")
PR_LINK_RE = re.compile(r"\[#(\d+)\]\((https://github\.com/kubernetes/kubernetes/pull/\d+)\)")
AUTHOR_RE = re.compile(r"\[@([\w-]+)\]\(https://github\.com/[\w-]+\)")
SIG_RE = re.compile(r"\[SIG ([^\]]+)\]")
CVE_HEADER_RE = re.compile(r"^### (CVE-\d{4}-\d+):\s*(.+)$", re.MULTILINE)
AFFECTED_VERSIONS_RE = re.compile(
    r"\*\*Affected Versions?\*\*:?\s*\n((?:\s*-\s*.+\n)+)", re.IGNORECASE
)
FIXED_VERSIONS_RE = re.compile(r"\*\*Fixed Versions?\*\*:?\s*\n((?:\s*-\s*.+\n)+)", re.IGNORECASE)


def parse_change_entry(text: str) -> ChangeEntry:
    """Parse a single change entry line."""
    pr_match = PR_LINK_RE.search(text)
    pr_number = int(pr_match.group(1)) if pr_match else None
    pr_url = pr_match.group(2) if pr_match else None

    author_match = AUTHOR_RE.search(text)
    author = author_match.group(1) if author_match else None

    sig_match = SIG_RE.search(text)
    sigs = [s.strip() for s in sig_match.group(1).split(",")] if sig_match else []

    description = text.strip()
    description = re.sub(r"\s*\(\[#\d+\].*$", "", description)
    description = description.lstrip("- ").strip()

    return ChangeEntry(
        description=description, pr_number=pr_number, pr_url=pr_url, author=author, sigs=sigs
    )


def parse_cve_section(content: str, cve_id: str, title: str) -> CVEEntry:
    """Parse a CVE section."""
    pattern = rf"### {re.escape(cve_id)}[^\n]*\n(.*?)(?=\n###|\n##[^#]|\Z)"
    match = re.search(pattern, content, re.DOTALL)

    if not match:
        return CVEEntry(cve=cve_id, title=title, description="")

    section = match.group(1)

    affected = []
    affected_match = AFFECTED_VERSIONS_RE.search(section)
    if affected_match:
        for line in affected_match.group(1).strip().split("\n"):
            line = line.strip().lstrip("- ").strip()
            if line:
                affected.append(line)

    fixed = []
    fixed_match = FIXED_VERSIONS_RE.search(section)
    if fixed_match:
        for line in fixed_match.group(1).strip().split("\n"):
            line = line.strip().lstrip("- ").strip()
            if line:
                fixed.append(line)

    desc_end = section.find("**Affected")
    if desc_end == -1:
        desc_end = section.find("**Fixed")
    if desc_end == -1:
        desc_end = len(section)

    description = section[:desc_end].strip()

    components = set()
    for v in affected:
        if "<=" in v or ">=" in v or "==" in v:
            comp = v.split()[0]
            components.add(comp)

    return CVEEntry(
        cve=cve_id,
        title=title,
        description=description,
        affected_versions=affected,
        fixed_versions=fixed,
        affected_components=list(components),
    )


def parse_action_required_notes(content: str) -> list[ActionRequiredNote]:
    """Parse the Urgent Upgrade Notes section (action required items).

    Handles multi-line entries with nested bullet points. A new entry starts with
    a top-level `- ` (0 or 1 leading spaces). Bullets with 2+ leading spaces like
    `  - ` are considered part of the current entry (nested bullets).
    """
    notes = []
    pattern = r"## Urgent Upgrade Notes.*?\n(.*?)(?=\n## [A-Z]|\Z)"
    match = re.search(pattern, content, re.DOTALL | re.IGNORECASE)

    if not match:
        return notes

    section = match.group(1)
    section = re.sub(r"###.*MUST read.*\n", "", section)

    current_entry = []
    for line in section.split("\n"):
        stripped = line.lstrip()
        leading_spaces = len(line) - len(stripped)

        # Check if this line starts a bullet point
        if stripped.startswith("- "):
            # Top-level bullet (0 or 1 leading spaces) starts a new entry
            # Nested bullets (2+ leading spaces) are part of current entry
            if leading_spaces < 2:
                # Top-level bullet - start new entry
                if current_entry:
                    entry_text = "\n".join(current_entry)
                    notes.append(parse_change_entry(entry_text))
                current_entry = [line]
            else:
                # Nested bullet - part of current entry
                if current_entry:
                    current_entry.append(line)
        elif current_entry and line.strip():
            current_entry.append(line)

    if current_entry:
        entry_text = "\n".join(current_entry)
        notes.append(parse_change_entry(entry_text))

    return [
        ActionRequiredNote(
            description=e.description,
            pr_number=e.pr_number,
            pr_url=e.pr_url,
            author=e.author,
            sigs=e.sigs,
        )
        for e in notes
    ]


def parse_dependencies(content: str) -> dict[str, list[str]]:
    """Parse the Dependencies section."""
    deps = {"added": [], "changed": [], "removed": []}
    pattern = r"## Dependencies\s*\n(.*?)(?=\n## [A-Z]|\n# v|\Z)"
    match = re.search(pattern, content, re.DOTALL)

    if not match:
        return deps

    section = match.group(1)
    current_type = None
    for line in section.split("\n"):
        line = line.strip()
        if line.startswith("### Added"):
            current_type = "added"
        elif line.startswith("### Changed"):
            current_type = "changed"
        elif line.startswith("### Removed"):
            current_type = "removed"
        elif line.startswith("- ") and current_type:
            deps[current_type].append(line[2:].strip())

    return deps


def split_by_version(content: str) -> dict[str, str]:
    """Split CHANGELOG content by version headers."""
    versions = {}
    matches = list(VERSION_HEADER_RE.finditer(content))

    for i, match in enumerate(matches):
        version = match.group(1)
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(content)
        versions[version] = content[start:end]

    return versions


def is_patch_release(version: str, minor_version: str) -> bool:
    """Check if version is a patch release (not .0, alpha, beta, rc)."""
    if "-" in version:
        return False
    parts = version.lstrip("v").split(".")
    if len(parts) != 3:
        return False
    return int(parts[2]) > 0


def parse_version_section(version: str, content: str) -> PatchRelease | None:
    """Parse a single version section."""
    since_match = CHANGELOG_SINCE_RE.search(content)
    changelog_since = since_match.group(1) if since_match else None

    security_fixes = []
    for cve_match in CVE_HEADER_RE.finditer(content):
        cve_id = cve_match.group(1)
        title = cve_match.group(2)
        cve_entry = parse_cve_section(content, cve_id, title)
        cve_entry.patch_version = version
        security_fixes.append(cve_entry)

    changes_by_kind = {}
    kind_pattern = r"### (Deprecation|API Change|Feature|Bug or Regression|Documentation|Failing Test|Other.*?)\s*\n(.*?)(?=\n### |\n## |\Z)"

    for kind_match in re.finditer(kind_pattern, content, re.DOTALL):
        kind_name = kind_match.group(1).strip()
        kind_content = kind_match.group(2)

        kind_key = {
            "Deprecation": "deprecation",
            "API Change": "apiChange",
            "Feature": "feature",
            "Bug or Regression": "bugOrRegression",
            "Documentation": "documentation",
            "Failing Test": "failingTest",
        }.get(kind_name, "other")

        entries = []
        current_entry = []
        for line in kind_content.split("\n"):
            if line.strip().startswith("- "):
                if current_entry:
                    entries.append(parse_change_entry("\n".join(current_entry)))
                current_entry = [line]
            elif current_entry and line.strip():
                current_entry.append(line)

        if current_entry:
            entries.append(parse_change_entry("\n".join(current_entry)))

        if entries:
            changes_by_kind[kind_key] = entries

    dependencies = parse_dependencies(content)

    return PatchRelease(
        version=version,
        changelog_since=changelog_since,
        security_fixes=security_fixes,
        changes_by_kind=changes_by_kind,
        dependencies=dependencies,
    )


def parse_changelog(version: str) -> ParsedChangelog:
    """Parse a CHANGELOG file for a given minor version."""
    if version.count(".") == 2:
        version = ".".join(version.split(".")[:2])

    changelog_path = CHANGELOGS_DIR / f"CHANGELOG-{version}.md"

    if not changelog_path.exists():
        raise FileNotFoundError(f"CHANGELOG not found: {changelog_path}")

    log(f"Parsing CHANGELOG-{version}.md...")
    content = changelog_path.read_text()

    result = ParsedChangelog(version=version)
    version_sections = split_by_version(content)
    log(f"  Found {len(version_sections)} version sections")

    main_version = f"v{version}.0"
    if main_version in version_sections:
        main_content = version_sections[main_version]
        result.action_required = parse_action_required_notes(main_content)
        log(f"  Action required notes: {len(result.action_required)}")
        result.dependencies = parse_dependencies(main_content)
        log(f"  Dependencies: {sum(len(v) for v in result.dependencies.values())} total")

    for ver, ver_content in version_sections.items():
        if is_patch_release(ver, version):
            patch = parse_version_section(ver, ver_content)
            if patch:
                result.patch_releases.append(patch)
                if patch.security_fixes:
                    result.security_information.extend(patch.security_fixes)

    result.patch_releases.sort(key=lambda p: [int(x) for x in p.version.lstrip("v").split(".")])

    log(f"  Patch releases: {len(result.patch_releases)}")
    log(f"  Security fixes (CVEs): {len(result.security_information)}")

    return result


def changelog_to_dict(parsed: ParsedChangelog) -> dict[str, Any]:
    """Convert ParsedChangelog to a dictionary for JSON serialization."""
    return {
        "version": parsed.version,
        "actionRequired": [
            {
                "description": n.description,
                "prNumber": n.pr_number,
                "prUrl": n.pr_url,
                "author": n.author,
                "sigs": n.sigs,
            }
            for n in parsed.action_required
        ],
        "securityInformation": [
            {
                "cve": c.cve,
                "title": c.title,
                "description": c.description,
                "affectedVersions": c.affected_versions,
                "fixedVersions": c.fixed_versions,
                "affectedComponents": c.affected_components,
                "reporter": c.reporter,
                "patchVersion": c.patch_version,
            }
            for c in parsed.security_information
        ],
        "patchReleases": [
            {
                "version": p.version,
                "changelogSince": p.changelog_since,
                "securityFixes": [
                    {
                        "cve": c.cve,
                        "title": c.title,
                        "description": c.description,
                        "affectedVersions": c.affected_versions,
                        "fixedVersions": c.fixed_versions,
                    }
                    for c in p.security_fixes
                ],
                "changesByKind": {
                    kind: [
                        {
                            "description": e.description,
                            "prNumber": e.pr_number,
                            "prUrl": e.pr_url,
                            "author": e.author,
                            "sigs": e.sigs,
                        }
                        for e in entries
                    ]
                    for kind, entries in p.changes_by_kind.items()
                },
                "dependencies": p.dependencies,
            }
            for p in parsed.patch_releases
        ],
        "dependencies": parsed.dependencies,
    }
