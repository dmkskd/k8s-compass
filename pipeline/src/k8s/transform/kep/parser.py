"""
Parse KEP (Kubernetes Enhancement Proposal) data from the enhancements repo.

## Overview

This module extracts structured feature data from KEP YAML files in the
kubernetes/enhancements repository. It builds the `features` array for each
K8s release by scanning kep.yaml files for milestone information.

## Data Sources

1. **kep.yaml files** in `pipeline/repos/enhancements/keps/sig-*/*/kep.yaml`
   - Contains: title, kep-number, owning-sig, stage, milestones, feature-gates
   - Authoritative source for when features graduated (alpha/beta/stable)

2. **release-notes.json** KEP links (optional cross-reference)
   - PRs link to KEPs via documentation[].url
   - Used to discover KEPs that might be missing from milestone scan

## Algorithm

For a given K8s version (e.g., 1.33):

1. Scan all kep.yaml files in the enhancements repo
2. Parse YAML to extract metadata
3. Check if any milestone matches the target version:
   - milestone.alpha == "v1.33" → feature is alpha in 1.33
   - milestone.beta == "v1.33" → feature is beta in 1.33
   - milestone.stable == "v1.33" → feature is stable in 1.33
4. Build Feature object with:
   - kep: "KEP-{number}"
   - kepPath: "{sig}/{number}-{name}" (for GitHub links)
   - title, stage, sig, feature gates
   - history: {alpha: "1.28", beta: "1.29", stable: "1.33"}

## Limitations

- KEPs without proper milestone fields won't be detected
- Some KEPs use issue links instead of kep.yaml paths
- Feature gates may not always be populated
- affectedKinds/affectedFields require manual curation or inference

## Usage

```python
from k8s.transform.kep_parser import extract_features_for_version

features = extract_features_for_version("1.33")
# Returns list of Feature dicts ready for release JSON
```
"""

import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from ...core.config import K8S_VERSIONS, OUTPUT_DIR, REPOS_DIR

ENHANCEMENTS_REPO = REPOS_DIR / "enhancements"
KEPS_DIR = ENHANCEMENTS_REPO / "keps"
RELEASES_DIR = OUTPUT_DIR / "releases"

# Cache for loaded release features
_release_features_cache: dict[str, set[str]] = {}


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def get_keps_in_release(version: str) -> set[str]:
    """Get set of KEP IDs that are actually in a release."""
    if version in _release_features_cache:
        return _release_features_cache[version]

    release_path = RELEASES_DIR / f"{version}.json"
    if not release_path.exists():
        _release_features_cache[version] = set()
        return set()

    try:
        import json
        with open(release_path) as f:
            data = json.load(f)
        keps = {f["kep"] for f in data.get("features", []) if f.get("kep")}
        _release_features_cache[version] = keps
        return keps
    except Exception:
        _release_features_cache[version] = set()
        return set()


@dataclass
class KepMetadata:
    """Parsed KEP metadata from kep.yaml."""
    kep_number: int
    title: str
    owning_sig: str
    status: str
    stage: str | None
    latest_milestone: str | None
    milestone_alpha: str | None
    milestone_beta: str | None
    milestone_stable: str | None
    feature_gates: list[str]
    kep_path: str  # e.g., "sig-node/753-sidecar-containers"


@dataclass
class Feature:
    """Feature data for release JSON."""
    kep: str
    kep_path: str
    title: str
    stage: str
    sig: str
    category: str
    labels: list[str]
    description: str
    impact: str | None
    feature_gate: str | None
    affected_kinds: list[str]
    affected_fields: list[str]
    history: dict[str, str]


def normalize_version(v: str | None) -> str | None:
    """Normalize version string: 'v1.33' -> '1.33', '1.33' -> '1.33'."""
    if not v:
        return None
    v = str(v).strip()
    if v.startswith("v"):
        v = v[1:]
    # Handle cases like "1.33.0" -> "1.33"
    parts = v.split(".")
    if len(parts) >= 2:
        return f"{parts[0]}.{parts[1]}"
    return v


def extract_title_from_readme(kep_dir: Path) -> str | None:
    """Extract title from README.md as fallback when kep.yaml title is wrong.

    README.md typically has the title in the first H1 heading:
    # KEP-XXXX: Actual Title Here
    """
    readme_path = kep_dir / "README.md"
    if not readme_path.exists():
        return None

    try:
        with open(readme_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("# "):
                    # Extract title, removing "KEP-XXXX: " prefix if present
                    title = line[2:].strip()
                    # Remove KEP number prefix like "KEP-2837: "
                    if title.upper().startswith("KEP-"):
                        parts = title.split(":", 1)
                        if len(parts) > 1:
                            title = parts[1].strip()
                    return title
        return None
    except Exception:
        return None


def is_template_title(title: str) -> bool:
    """Check if a title looks like an unfilled template placeholder."""
    if not title:
        return True
    title_lower = title.lower().strip()
    template_indicators = [
        "kep template",
        "template",
        "title goes here",
        "your title",
        "[title]",
        "untitled",
    ]
    return any(indicator in title_lower for indicator in template_indicators)


def parse_kep_yaml(kep_path: Path) -> KepMetadata | None:
    """Parse a kep.yaml file and extract metadata."""
    try:
        with open(kep_path) as f:
            data = yaml.safe_load(f)

        if not data or not isinstance(data, dict):
            return None

        kep_number = data.get("kep-number")
        if not kep_number:
            return None

        # Extract title, with fallback to README.md if it looks like a template
        title = data.get("title", "")
        if is_template_title(title):
            readme_title = extract_title_from_readme(kep_path.parent)
            if readme_title:
                log(f"  [INFO] Using README title for KEP-{kep_number}: '{readme_title}' (kep.yaml had '{title}')")
                title = readme_title

        # Extract milestone info
        milestone = data.get("milestone", {}) or {}

        # Extract feature gates
        feature_gates = []
        fg_data = data.get("feature-gates", []) or []
        for fg in fg_data:
            if isinstance(fg, dict) and fg.get("name"):
                feature_gates.append(fg["name"])
            elif isinstance(fg, str):
                feature_gates.append(fg)

        # Build kep_path from file location
        # e.g., /path/to/keps/sig-node/753-sidecar-containers/kep.yaml
        # -> sig-node/753-sidecar-containers
        rel_path = kep_path.parent.relative_to(KEPS_DIR)
        kep_path_str = str(rel_path)

        return KepMetadata(
            kep_number=int(kep_number),
            title=title,
            owning_sig=data.get("owning-sig", ""),
            status=data.get("status", ""),
            stage=data.get("stage"),
            latest_milestone=normalize_version(data.get("latest-milestone")),
            milestone_alpha=normalize_version(milestone.get("alpha")),
            milestone_beta=normalize_version(milestone.get("beta")),
            milestone_stable=normalize_version(milestone.get("stable")),
            feature_gates=feature_gates,
            kep_path=kep_path_str,
        )
    except Exception as e:
        log(f"  [WARN] Failed to parse {kep_path}: {e}")
        return None


def scan_all_keps() -> list[KepMetadata]:
    """Scan all kep.yaml files in the enhancements repo."""
    from ...input.repo_manager import get_current_ref

    keps = []

    if not KEPS_DIR.exists():
        log(f"[ERROR] Enhancements repo not found at {KEPS_DIR}")
        log("  Run: git clone https://github.com/kubernetes/enhancements pipeline/repos/enhancements")
        return []

    # Log the current git ref for traceability
    current_ref = get_current_ref("enhancements")
    log(f"  [GIT] enhancements repo at: {current_ref}")

    # Find all kep.yaml files
    for kep_yaml in KEPS_DIR.glob("*/*/kep.yaml"):
        metadata = parse_kep_yaml(kep_yaml)
        if metadata:
            keps.append(metadata)

    return keps


def get_stage_for_version(kep: KepMetadata, version: str) -> str | None:
    """
    Determine what stage a KEP is at for a given version.

    Returns 'stable', 'beta', 'alpha', or None if not present in that version.
    """
    # Check if this version is when the KEP reached each stage
    if kep.milestone_stable == version:
        return "stable"
    if kep.milestone_beta == version:
        return "beta"
    if kep.milestone_alpha == version:
        return "alpha"
    return None


def sig_to_category(sig: str) -> str:
    """Map SIG name to a feature category."""
    sig_lower = sig.lower().replace("sig-", "")

    category_map = {
        "node": "Workloads",
        "apps": "Workloads",
        "scheduling": "Scheduling",
        "autoscaling": "Scaling",
        "storage": "Storage",
        "network": "Networking",
        "auth": "Security",
        "security": "Security",
        "api-machinery": "API",
        "cli": "CLI",
        "cluster-lifecycle": "Cluster Lifecycle",
        "instrumentation": "Observability",
        "windows": "Platform",
        "architecture": "Architecture",
        "release": "Release",
        "testing": "Testing",
        "docs": "Documentation",
        "contributor-experience": "Community",
        "cloud-provider": "Cloud",
        "multicluster": "Multi-cluster",
        "etcd": "Storage",
        "ui": "UI",
    }

    return category_map.get(sig_lower, "Other")


def format_sig_name(sig: str) -> str:
    """Format SIG name for display: 'sig-node' -> 'Node'."""
    sig = sig.replace("sig-", "").replace("-", " ")
    return sig.title()


def compare_versions(v1: str, v2: str) -> int:
    """Compare two version strings. Returns -1 if v1 < v2, 0 if equal, 1 if v1 > v2."""
    try:
        parts1 = [int(x) for x in v1.split(".")]
        parts2 = [int(x) for x in v2.split(".")]
        for p1, p2 in zip(parts1, parts2, strict=False):
            if p1 < p2:
                return -1
            if p1 > p2:
                return 1
        return 0
    except (ValueError, AttributeError):
        return 0


def kep_to_feature(kep: KepMetadata, stage: str, target_version: str | None = None) -> Feature:
    """Convert KEP metadata to Feature for release JSON.

    If target_version is provided, milestones after target_version are marked as tentative.
    """
    # Build history from milestones
    history = {}
    if kep.milestone_alpha:
        history["alpha"] = kep.milestone_alpha
    if kep.milestone_beta:
        history["beta"] = kep.milestone_beta
    if kep.milestone_stable:
        history["stable"] = kep.milestone_stable

    # Mark future milestones as tentative and verify if they actually happened
    kep_id = f"KEP-{kep.kep_number}"
    if target_version:
        tentative = []
        verified = []
        for stage_name in ["alpha", "beta", "stable"]:
            if stage_name in history:
                milestone_version = history[stage_name]
                if compare_versions(milestone_version, target_version) > 0:
                    # This is a future milestone - check if it actually happened
                    keps_in_that_release = get_keps_in_release(milestone_version)
                    if kep_id in keps_in_that_release:
                        # The KEP is in that release, so milestone was achieved
                        verified.append(stage_name)
                    else:
                        # Not verified - mark as tentative
                        tentative.append(stage_name)
        if tentative:
            history["tentative"] = tentative
        if verified:
            history["verified"] = verified

    return Feature(
        kep=f"KEP-{kep.kep_number}",
        kep_path=kep.kep_path,
        title=kep.title,
        stage=stage,
        sig=format_sig_name(kep.owning_sig),
        category=sig_to_category(kep.owning_sig),
        labels=[],  # TODO: populate via LLM or curated data
        description="",  # Would need to parse README.md for this
        impact=None,
        feature_gate=kep.feature_gates[0] if kep.feature_gates else None,
        affected_kinds=[],  # Would need manual curation or inference
        affected_fields=[],
        history=history,
    )


def extract_features_for_version(version: str) -> list[Feature]:
    """
    Extract all features that graduated in a specific K8s version.

    Scans kep.yaml files and finds KEPs where any milestone matches the version.
    """
    log(f"\n[KEP] Extracting features for Kubernetes {version}")

    all_keps = scan_all_keps()
    log(f"  [OK] Found {len(all_keps)} KEPs in enhancements repo")

    features = []
    by_stage = {"alpha": 0, "beta": 0, "stable": 0}

    for kep in all_keps:
        stage = get_stage_for_version(kep, version)
        if stage:
            feature = kep_to_feature(kep, stage, target_version=version)
            features.append(feature)
            by_stage[stage] += 1

    log(f"  [OK] Found {len(features)} features for {version}")
    log(f"       Alpha: {by_stage['alpha']}, Beta: {by_stage['beta']}, Stable: {by_stage['stable']}")

    # Sort by stage (stable first) then by KEP number
    stage_order = {"stable": 0, "beta": 1, "alpha": 2}
    features.sort(key=lambda f: (stage_order.get(f.stage, 3), f.kep))

    return features


def features_to_dict(features: list[Feature]) -> list[dict[str, Any]]:
    """Convert Feature objects to dicts for JSON serialization."""
    return [
        {
            "kep": f.kep,
            "kepPath": f.kep_path,
            "title": f.title,
            "stage": f.stage,
            "sig": f.sig,
            "category": f.category,
            "description": f.description,
            "impact": f.impact,
            "featureGate": f.feature_gate,
            "affectedKinds": f.affected_kinds,
            "affectedFields": f.affected_fields,
            "history": f.history,
        }
        for f in features
    ]


def build_features_summary(features: list[Feature]) -> dict[str, int]:
    """Build summary counts for release JSON."""
    by_stage = {"alpha": 0, "beta": 0, "stable": 0}
    for f in features:
        if f.stage in by_stage:
            by_stage[f.stage] += 1

    return {
        "total": len(features),
        "stable": by_stage["stable"],
        "beta": by_stage["beta"],
        "alpha": by_stage["alpha"],
    }


def extract_features_all_versions() -> dict[str, list[Feature]]:
    """Extract features for all configured K8s versions."""
    log("\n" + "=" * 60)
    log("Extracting KEP features for all versions")
    log("=" * 60)

    results = {}
    for version in K8S_VERSIONS:
        features = extract_features_for_version(version)
        results[version] = features

    log("\n" + "=" * 60)
    log("SUMMARY")
    log("=" * 60)
    for version, features in sorted(results.items()):
        log(f"  {version}: {len(features)} features")

    return results
