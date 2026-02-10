"""
Stage upstream Kubernetes release data for processing.

This module handles fetching and staging raw upstream data:
1. release-notes.json from cdn.dl.k8s.io
2. CHANGELOG files from local kubernetes repo clone

All staged data goes to pipeline/data/upstream/k8s/releases/ and is committed to git.
This ensures reproducible builds from cached upstream data.
"""

import json
import shutil
import sys
from pathlib import Path
from typing import Any

import httpx

from ..core.config import K8S_VERSIONS, PIPELINE_DATA_DIR, PIPELINE_ROOT, REPOS_DIR

# Paths
UPSTREAM_DIR = PIPELINE_DATA_DIR / "upstream" / "k8s" / "releases"
RELEASE_NOTES_DIR = UPSTREAM_DIR / "release-notes"
CHANGELOGS_DIR = UPSTREAM_DIR / "changelogs"
K8S_REPO = REPOS_DIR / "kubernetes"

# URL pattern for official release notes JSON
RELEASE_NOTES_URL = "https://cdn.dl.k8s.io/release/v{version}/release-notes.json"


def log(msg: str) -> None:
    """Print with flush for immediate output."""
    print(msg, file=sys.stderr, flush=True)


def ensure_dirs() -> None:
    """Create upstream staging directories if they don't exist."""
    RELEASE_NOTES_DIR.mkdir(parents=True, exist_ok=True)
    CHANGELOGS_DIR.mkdir(parents=True, exist_ok=True)


def get_release_notes_path(version: str) -> Path:
    """Get path for staged release-notes.json."""
    # Use X.YY.0 format for the filename
    if version.count(".") == 1:
        version = f"{version}.0"
    return RELEASE_NOTES_DIR / f"{version}.json"


def get_changelog_path(version: str) -> Path:
    """Get path for staged CHANGELOG file."""
    # Use X.YY format (minor version only)
    if version.count(".") == 2:
        version = ".".join(version.split(".")[:2])
    return CHANGELOGS_DIR / f"CHANGELOG-{version}.md"


def is_release_notes_staged(version: str) -> bool:
    """Check if release-notes.json is already staged."""
    return get_release_notes_path(version).exists()


def is_changelog_staged(version: str) -> bool:
    """Check if CHANGELOG is already staged."""
    return get_changelog_path(version).exists()


def fetch_release_notes(version: str, force: bool = False) -> dict[str, Any] | None:
    """
    Fetch release-notes.json from cdn.dl.k8s.io and stage it.

    Args:
        version: K8s version like "1.35" or "1.35.0"
        force: If True, fetch even if already staged

    Returns:
        The parsed JSON data, or None if skipped
    """
    ensure_dirs()

    # Normalize version
    if version.count(".") == 1:
        full_version = f"{version}.0"
    else:
        full_version = version

    output_path = get_release_notes_path(version)

    # Check if already staged
    if output_path.exists() and not force:
        log(f"  [SKIP] release-notes/{full_version}.json already staged")
        with open(output_path) as f:
            return json.load(f)

    # Fetch from CDN
    url = RELEASE_NOTES_URL.format(version=full_version)
    log(f"  [FETCH] {url}")

    try:
        response = httpx.get(url, timeout=60.0)
        response.raise_for_status()
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            log(f"  [WARN] release-notes.json not available for v{full_version}")
            return None
        raise

    content = response.text
    log(f"  [OK] Downloaded {len(content):,} bytes")

    # Fix trailing comma issues in the JSON (known issue with krel output)
    import re

    content = re.sub(r",(\s*[}\]])", r"\1", content)

    # Parse to validate
    data = json.loads(content)
    log(f"  [OK] Parsed {len(data)} entries")

    # Write to staging
    with open(output_path, "w") as f:
        json.dump(data, f, indent=2)
    log(f"  [STAGED] {output_path.relative_to(PIPELINE_ROOT)}")

    return data


def stage_changelog(version: str, force: bool = False) -> str | None:
    """
    Copy CHANGELOG from local kubernetes repo to staging.

    Args:
        version: K8s version like "1.35"
        force: If True, copy even if already staged

    Returns:
        The CHANGELOG content, or None if not found
    """
    ensure_dirs()

    # Normalize version to X.YY
    if version.count(".") == 2:
        minor_version = ".".join(version.split(".")[:2])
    else:
        minor_version = version

    output_path = get_changelog_path(version)

    # Check if already staged
    if output_path.exists() and not force:
        log(f"  [SKIP] changelogs/CHANGELOG-{minor_version}.md already staged")
        return output_path.read_text()

    # Find source CHANGELOG
    source_path = K8S_REPO / "CHANGELOG" / f"CHANGELOG-{minor_version}.md"

    if not source_path.exists():
        log(f"  [WARN] CHANGELOG not found: {source_path}")
        log(
            "  [HINT] Run: cd pipeline/repos && git clone --depth 1 https://github.com/kubernetes/kubernetes.git"
        )
        return None

    # Copy to staging
    content = source_path.read_text()
    log(f"  [COPY] {source_path.name} ({len(content):,} bytes)")

    shutil.copy2(source_path, output_path)
    log(f"  [STAGED] {output_path.relative_to(PIPELINE_ROOT)}")

    return content


def stage_release(version: str, force: bool = False) -> dict[str, Any]:
    """
    Stage all upstream data for a release version.

    Args:
        version: K8s version like "1.35"
        force: If True, re-fetch/copy even if already staged

    Returns:
        Dict with staging results
    """
    log(f"\n{'=' * 60}")
    log(f"Staging upstream data for Kubernetes {version}")
    log(f"{'=' * 60}")

    result = {
        "version": version,
        "release_notes": None,
        "changelog": None,
    }

    # Stage release-notes.json
    log("\n[1/2] Release notes from cdn.dl.k8s.io...")
    release_notes = fetch_release_notes(version, force=force)
    if release_notes:
        result["release_notes"] = {
            "path": str(get_release_notes_path(version).relative_to(PIPELINE_ROOT)),
            "entries": len(release_notes),
        }

    # Stage CHANGELOG
    log("\n[2/2] CHANGELOG from local repo...")
    changelog = stage_changelog(version, force=force)
    if changelog:
        result["changelog"] = {
            "path": str(get_changelog_path(version).relative_to(PIPELINE_ROOT)),
            "size": len(changelog),
        }

    log(f"\n{'=' * 60}")
    log(f"Staging complete for {version}")
    if result["release_notes"]:
        log(f"  Release notes: {result['release_notes']['entries']} entries")
    else:
        log("  Release notes: NOT AVAILABLE")
    if result["changelog"]:
        log(f"  CHANGELOG: {result['changelog']['size']:,} bytes")
    else:
        log("  CHANGELOG: NOT FOUND")
    log(f"{'=' * 60}\n")

    return result


def stage_all_releases(force: bool = False) -> list[dict[str, Any]]:
    """
    Stage upstream data for all configured K8s versions.

    Args:
        force: If True, re-fetch/copy even if already staged

    Returns:
        List of staging results for each version
    """
    results = []

    log(f"\n{'#' * 60}")
    log(f"Staging all K8s releases: {K8S_VERSIONS}")
    log(f"{'#' * 60}")

    for version in K8S_VERSIONS:
        result = stage_release(version, force=force)
        results.append(result)

    # Summary
    log(f"\n{'#' * 60}")
    log("STAGING SUMMARY")
    log(f"{'#' * 60}")

    staged_notes = sum(1 for r in results if r["release_notes"])
    staged_changelogs = sum(1 for r in results if r["changelog"])

    log(f"  Versions processed: {len(results)}")
    log(f"  Release notes staged: {staged_notes}/{len(results)}")
    log(f"  CHANGELOGs staged: {staged_changelogs}/{len(results)}")

    return results


def get_staging_status() -> dict[str, Any]:
    """
    Get status of all staged upstream data.

    Returns:
        Dict with status for each version
    """
    status = {
        "versions": {},
        "summary": {
            "release_notes": 0,
            "changelogs": 0,
        },
    }

    for version in K8S_VERSIONS:
        has_notes = is_release_notes_staged(version)
        has_changelog = is_changelog_staged(version)

        status["versions"][version] = {
            "release_notes": has_notes,
            "changelog": has_changelog,
        }

        if has_notes:
            status["summary"]["release_notes"] += 1
        if has_changelog:
            status["summary"]["changelogs"] += 1

    return status
