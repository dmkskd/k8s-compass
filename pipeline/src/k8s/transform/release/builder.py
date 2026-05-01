"""
Build release JSON files from staged upstream data.

Combines:
1. release-notes.json from dl.k8s.io (changesByKind)
2. Parsed CHANGELOG data (actionRequired, patchReleases, securityInformation)
3. KEP features extracted from enhancements repo (kep.yaml milestone data)
4. Curated features from existing v2 JSON (if available, merged with extracted)
5. GitHub PR details (optional, for user-facing changes and related issues)

## Feature Extraction

Features are extracted from the kubernetes/enhancements repo by scanning kep.yaml
files for milestone information. For each version, we find KEPs where:
- milestone.alpha == version → feature is alpha
- milestone.beta == version → feature is beta
- milestone.stable == version → feature is stable

Curated features (from v2 JSON) are merged with extracted features, with curated
data taking precedence for fields like description, impact, affectedKinds.

## PR Enrichment

When --with-prs is enabled, the builder fetches PR details from GitHub to enrich
changes with:
- userFacingChange: The release note from the PR body
- relatedIssues: Issues referenced via "Fixes #xxx" in the PR
- relatedKeps: KEPs mentioned in the PR body (supplements kepLinks from release-notes)
"""

import json
import sys
from typing import Any

from ...core.config import K8S_VERSIONS, PIPELINE_DATA_DIR
from ...core.config import OUTPUT_DIR as JSON_OUTPUT_DIR
from ...input.upstream_stager import (
    get_release_notes_path,
    is_changelog_staged,
)
from .changelog_parser import changelog_to_dict, parse_changelog
from ..kep.parser import (
    extract_features_for_version,
    features_to_dict,
)

OUTPUT_DIR = JSON_OUTPUT_DIR / "releases"
CURATED_RELEASES_DIR = PIPELINE_DATA_DIR / "curated" / "releases"


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def load_staged_release_notes(version: str) -> dict[str, Any] | None:
    """Load staged release-notes.json."""
    path = get_release_notes_path(version)
    if not path.exists():
        return None
    with open(path) as f:
        return json.load(f)


def load_curated_features(version: str) -> dict[str, Any] | None:
    """Load curated JSON if it exists (contains metadata like codename, description, themes)."""
    curated_path = CURATED_RELEASES_DIR / f"{version}-curated.json"
    if not curated_path.exists():
        # Fallback to main release JSON for existing curated data
        main_path = OUTPUT_DIR / f"{version}.json"
        if main_path.exists():
            with open(main_path) as f:
                return json.load(f)
        return None
    with open(curated_path) as f:
        return json.load(f)


def merge_features(
    extracted: list[dict[str, Any]], curated: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """
    Merge extracted KEP features with curated features.

    Curated data takes precedence for fields like description, impact, affectedKinds.
    Extracted data provides the base (kep, title, stage, sig, history).
    """
    # Index curated by KEP number
    curated_by_kep = {f["kep"]: f for f in curated}

    merged = []
    seen_keps = set()

    # Start with extracted features, merge in curated data
    for feat in extracted:
        kep = feat["kep"]
        seen_keps.add(kep)

        if kep in curated_by_kep:
            # Merge: curated fields override extracted
            curated_feat = curated_by_kep[kep]
            merged_feat = {**feat}  # Start with extracted

            # Override with curated data if present and non-empty
            for key in ["description", "impact", "affectedKinds", "affectedFields",
                        "category", "featureGate", "isHighlight"]:
                if curated_feat.get(key):
                    merged_feat[key] = curated_feat[key]

            # Merge history (curated may have more accurate dates)
            if curated_feat.get("history"):
                merged_feat["history"] = {
                    **feat.get("history", {}),
                    **curated_feat["history"],
                }

            merged.append(merged_feat)
        else:
            merged.append(feat)

    # Add curated features not in extracted (manual additions)
    for kep, feat in curated_by_kep.items():
        if kep not in seen_keps:
            merged.append(feat)

    # Sort by stage (stable first) then KEP number
    stage_order = {"stable": 0, "beta": 1, "alpha": 2}
    merged.sort(key=lambda f: (stage_order.get(f.get("stage", ""), 3), f.get("kep", "")))

    return merged


def transform_release_notes_to_changes(
    raw_notes: dict[str, Any],
) -> tuple[dict[str, list[dict[str, Any]]], list[dict[str, Any]]]:
    """Transform raw release-notes.json entries to changesByKind format.

    Returns:
        Tuple of (changes_by_kind, action_required_notes)
        - changes_by_kind: Dict mapping kind to list of change entries
        - action_required_notes: List of entries with action_required=True
    """
    changes_by_kind: dict[str, list[dict[str, Any]]] = {}
    action_required_notes: list[dict[str, Any]] = []

    kind_map = {
        "feature": "feature",
        "bug": "bugOrRegression",
        "api-change": "apiChange",
        "deprecation": "deprecation",
        "documentation": "documentation",
        "failing-test": "failingTest",
        "cleanup": "other",
        "flake": "other",
        "other": "other",
    }

    for _pr_id, entry in raw_notes.items():
        if not isinstance(entry, dict):
            continue

        raw_kinds = entry.get("kinds", ["other"])
        if not raw_kinds:
            raw_kinds = ["other"]

        raw_kind = raw_kinds[0].lower() if raw_kinds else "other"
        kind = kind_map.get(raw_kind, "other")

        if kind not in changes_by_kind:
            changes_by_kind[kind] = []

        sigs = [sig.replace("sig-", "").replace("-", " ").title() for sig in entry.get("sigs", [])]

        change_entry = {
            "description": entry.get("text", ""),
            "prNumber": entry.get("pr_number"),
            "prUrl": entry.get("pr_url") or None,
            "author": entry.get("author") or None,
            "sigs": sigs,
        }

        kep_links = [
            doc.get("url", "")
            for doc in entry.get("documentation", [])
            if isinstance(doc, dict) and doc.get("type") == "KEP"
        ]
        if kep_links:
            change_entry["kepLinks"] = kep_links

        changes_by_kind[kind].append(change_entry)

        # Extract action_required entries
        if entry.get("action_required"):
            action_required_notes.append({
                "description": entry.get("text", ""),
                "prNumber": entry.get("pr_number"),
                "prUrl": entry.get("pr_url") or None,
                "author": entry.get("author") or None,
                "sigs": sigs,
            })

    return changes_by_kind, action_required_notes


def enrich_changes_with_prs(
    changes_by_kind: dict[str, list[dict[str, Any]]],
    force_fetch: bool = False,
    fetch_issues: bool = True,
) -> dict[str, list[dict[str, Any]]]:
    """
    Enrich changes with PR details from GitHub.

    Adds to each change:
    - userFacingChange: The release note from PR body (if different from description)
    - relatedIssues: Issue numbers referenced via "Fixes #xxx"
    - issueContext: Full issue details (title, body) for enrichment
    - relatedKeps: KEPs mentioned in PR body (merged with existing kepLinks)
    """
    from ...input.github_fetcher import GitHubFetcher

    # Collect all PR numbers
    pr_numbers = []
    for changes in changes_by_kind.values():
        for change in changes:
            if pr_num := change.get("prNumber"):
                if pr_num not in pr_numbers:
                    pr_numbers.append(pr_num)

    if not pr_numbers:
        log("  [INFO] No PR numbers to fetch")
        return changes_by_kind

    log(f"  [INFO] Fetching {len(pr_numbers)} PRs from GitHub...")

    fetcher = GitHubFetcher()
    pr_details = fetcher.fetch_prs(pr_numbers, force=force_fetch, progress=True)

    # Collect all issue numbers from PRs
    all_issue_numbers: set[int] = set()
    for pr in pr_details.values():
        all_issue_numbers.update(pr.related_issues)

    # Fetch issues if requested
    issue_details: dict[int, Any] = {}
    if fetch_issues and all_issue_numbers:
        log(f"  [INFO] Fetching {len(all_issue_numbers)} linked issues from GitHub...")
        issue_details = {
            issue.number: issue
            for issue in fetcher.fetch_issues(list(all_issue_numbers), force=force_fetch).values()
        }

    # Enrich changes
    enriched_count = 0
    issues_linked = 0
    for changes in changes_by_kind.values():
        for change in changes:
            pr_num = change.get("prNumber")
            if not pr_num or pr_num not in pr_details:
                continue

            pr = pr_details[pr_num]

            # Add user-facing change if it's different/better than description
            if pr.user_facing_change:
                # Only add if it provides new info (not just a repeat of description)
                desc = change.get("description", "").lower()
                uf = pr.user_facing_change.lower()
                if uf not in desc and desc not in uf:
                    change["userFacingChange"] = pr.user_facing_change
                    enriched_count += 1

            # Add related issues with full context
            if pr.related_issues:
                change["relatedIssues"] = pr.related_issues

                # Add issue context for enrichment
                issue_contexts = []
                for issue_num in pr.related_issues:
                    if issue_num in issue_details:
                        issue = issue_details[issue_num]
                        issue_contexts.append({
                            "number": issue.number,
                            "title": issue.title,
                            "body": issue.body[:2000] if issue.body else "",  # Truncate long bodies
                            "labels": issue.labels,
                        })
                        issues_linked += 1

                if issue_contexts:
                    change["issueContext"] = issue_contexts

            # Merge KEPs from PR body with existing kepLinks
            if pr.related_keps:
                existing_keps = set(change.get("kepLinks", []))
                # Convert KEP-1234 to URL format for consistency
                for kep in pr.related_keps:
                    kep_num = kep.replace("KEP-", "")
                    # Check if this KEP is already in kepLinks (by number)
                    if not any(kep_num in link for link in existing_keps):
                        if "kepLinks" not in change:
                            change["kepLinks"] = []
                        # Add as a reference (not full URL since we don't know the path)
                        change["kepLinks"].append(f"KEP-{kep_num}")

    log(f"  [OK] Enriched {enriched_count} changes with user-facing notes")
    if issues_linked:
        log(f"  [OK] Linked {issues_linked} issues with context")

    return changes_by_kind


def build_release(version: str, force: bool = False, with_prs: bool = False) -> dict[str, Any] | None:
    """Build a complete release JSON file from staged upstream data."""
    log(f"\n{'=' * 60}")
    log(f"Building release JSON for Kubernetes {version}")
    log(f"{'=' * 60}")

    if not with_prs:
        log("")
        log("  [INFO] Running without --with-prs flag")
        log("         PR details and issue context will NOT be fetched.")
        log("         For production builds, use: build-release VERSION --with-prs")
        log("")

    output_path = OUTPUT_DIR / f"{version}.json"

    if output_path.exists() and not force:
        log(f"  [SKIP] {output_path.name} already exists (use --force to rebuild)")
        with open(output_path) as f:
            return json.load(f)

    log("\n[1/4] Loading staged release-notes.json...")
    raw_notes = load_staged_release_notes(version)
    cdn_urgent_notes: list[dict[str, Any]] = []
    if raw_notes:
        log(f"  [OK] Loaded {len(raw_notes)} entries")
        changes_by_kind, cdn_urgent_notes = transform_release_notes_to_changes(raw_notes)
        total_changes = sum(len(v) for v in changes_by_kind.values())
        log(f"  [OK] Transformed to {total_changes} changes in {len(changes_by_kind)} kinds")
        if cdn_urgent_notes:
            log(f"  [OK] Found {len(cdn_urgent_notes)} action_required entries")
    else:
        log("  [WARN] No release-notes.json staged")
        changes_by_kind = {}

    log("\n[2/4] Parsing CHANGELOG...")
    changelog_data = None
    if is_changelog_staged(version):
        try:
            parsed_changelog = parse_changelog(version)
            changelog_data = changelog_to_dict(parsed_changelog)
            log("  [OK] Parsed CHANGELOG")
        except Exception as e:
            log(f"  [ERROR] Failed to parse CHANGELOG: {e}")
    else:
        log("  [WARN] No CHANGELOG staged")

    # Enrich changes with PR details (optional)
    if with_prs and changes_by_kind:
        log("\n[2.5/4] Enriching changes with GitHub PR details...")
        changes_by_kind = enrich_changes_with_prs(changes_by_kind, force_fetch=force)

    log("\n[3/4] Extracting KEP features from enhancements repo...")
    extracted_features = extract_features_for_version(version)
    extracted_features_dict = features_to_dict(extracted_features)
    log(f"  [OK] Extracted {len(extracted_features)} features")

    log("\n[4/4] Loading curated features...")
    curated = load_curated_features(version)
    curated_features = curated.get("features", []) if curated else []
    if curated_features:
        log(f"  [OK] Loaded {len(curated_features)} curated features")
    else:
        log("  [INFO] No curated features found")

    # Merge extracted and curated features
    if extracted_features_dict and curated_features:
        features = merge_features(extracted_features_dict, curated_features)
        log(f"  [OK] Merged to {len(features)} total features")
    elif extracted_features_dict:
        features = extracted_features_dict
    else:
        features = curated_features

    log("\n[BUILD] Assembling release JSON...")

    # Build summary from merged features
    summary = {
        "total": len(features),
        "stable": sum(1 for f in features if f.get("stage") == "stable"),
        "beta": sum(1 for f in features if f.get("stage") == "beta"),
        "alpha": sum(1 for f in features if f.get("stage") == "alpha"),
    }

    release = {
        "version": version,
        "codename": curated.get("codename") if curated else None,
        "description": curated.get("description") if curated else None,
        "releaseDate": curated.get("releaseDate") if curated else None,
        "endOfLifeDate": curated.get("endOfLifeDate") if curated else None,
        "summary": summary,
        "themes": curated.get("themes", []) if curated else [],
    }

    # Action required notes: prefer CDN (action_required), fallback to CHANGELOG, then curated
    if cdn_urgent_notes:
        release["actionRequired"] = cdn_urgent_notes
    elif changelog_data and changelog_data.get("actionRequired"):
        release["actionRequired"] = changelog_data["actionRequired"]
    elif curated and curated.get("actionRequired"):
        release["actionRequired"] = curated["actionRequired"]

    if changelog_data and changelog_data.get("securityInformation"):
        release["securityInformation"] = changelog_data["securityInformation"]

    release["features"] = features

    if changes_by_kind:
        release["changesByKind"] = changes_by_kind

    if curated and curated.get("deprecations"):
        release["deprecations"] = curated["deprecations"]
    if curated and curated.get("removals"):
        release["removals"] = curated["removals"]
    if changelog_data and changelog_data.get("dependencies"):
        release["dependencies"] = changelog_data["dependencies"]
    if changelog_data and changelog_data.get("patchReleases"):
        release["patchReleases"] = changelog_data["patchReleases"]
    if curated and curated.get("references"):
        release["references"] = curated["references"]

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(release, f, indent=2)

    file_size = output_path.stat().st_size
    log(f"\n[DONE] Wrote {output_path.name} ({file_size / 1024:.1f} KB)")
    log(f"       Features: {summary['total']} (stable: {summary['stable']}, beta: {summary['beta']}, alpha: {summary['alpha']})")

    return release


def build_all_releases(force: bool = False, with_prs: bool = False) -> list[dict[str, Any]]:
    """Build release JSON files for all configured K8s versions."""
    results = []
    log(f"\n{'#' * 60}")
    log(f"Building all K8s releases: {K8S_VERSIONS}")
    if with_prs:
        log("  (with GitHub PR enrichment)")
    log(f"{'#' * 60}")

    for version in K8S_VERSIONS:
        result = build_release(version, force=force, with_prs=with_prs)
        if result:
            results.append(result)

    log(f"\n{'#' * 60}")
    log(f"BUILD SUMMARY: {len(results)}/{len(K8S_VERSIONS)} versions built")
    log(f"{'#' * 60}")

    return results


def build_release_index() -> dict[str, Any]:
    """Build the releases index.json file."""
    log("\nBuilding releases index.json...")

    releases = []
    latest_version = None

    for version in sorted(K8S_VERSIONS, key=lambda v: [int(x) for x in v.split(".")], reverse=True):
        release_path = OUTPUT_DIR / f"{version}.json"
        if not release_path.exists():
            continue

        with open(release_path) as f:
            release = json.load(f)

        releases.append(
            {
                "version": version,
                "codename": release.get("codename"),
                "releaseDate": release.get("releaseDate"),
                "summary": release.get("summary", {}),
            }
        )

        if latest_version is None:
            latest_version = version

    index = {"latestVersion": latest_version, "releases": releases}

    index_path = OUTPUT_DIR / "index.json"
    with open(index_path, "w") as f:
        json.dump(index, f, indent=2)

    log(f"  [OK] Wrote index.json with {len(releases)} releases")
    return index
