"""
Extract Kubernetes feature gates from the kubernetes/website documentation.

This module parses the feature gate markdown files from the website repo to extract:
- Feature gate names
- Stage progression (Alpha → Beta → GA → Deprecated)
- Default values at each version
- Version ranges (fromVersion, toVersion)
- Descriptions

Data source:
- kubernetes/website repo
- content/en/docs/reference/command-line-tools-reference/feature-gates/*.md

The website repo uses tags like `snapshot-final-v1.32` for each K8s release.
Processing by tag allows us to see the feature gate status at any given K8s version.
"""

import json
import re
from pathlib import Path
from typing import Any

import yaml
from rich.console import Console

from ...input.repo_manager import get_repo_path
from .component_extractor import checkout_website_version

console = Console()

# Path to feature gate docs in website repo
FEATURE_GATES_PATH = "content/en/docs/reference/command-line-tools-reference/feature-gates"


def parse_feature_gate_file(file_path: Path) -> dict[str, Any] | None:
    """
    Parse a single feature gate markdown file.

    The file format is:
    ---
    title: FeatureGateName
    content_type: feature_gate
    stages:
      - stage: alpha
        defaultValue: false
        fromVersion: "1.27"
        toVersion: "1.32"
      - stage: beta
        defaultValue: true
        fromVersion: "1.33"
    ---
    Description text here.

    Returns dict with name, stages, description, and removed flag.
    """
    if not file_path.exists():
        return None

    content = file_path.read_text(encoding="utf-8")

    # Parse YAML frontmatter
    frontmatter_match = re.match(r'^---\s*\n(.*?)\n---\s*\n(.*)$', content, re.DOTALL)
    if not frontmatter_match:
        return None

    try:
        frontmatter = yaml.safe_load(frontmatter_match.group(1))
    except yaml.YAMLError:
        return None

    if not frontmatter:
        return None

    # Skip index.md and other non-feature-gate files
    if frontmatter.get("content_type") != "feature_gate":
        return None

    name = frontmatter.get("title")
    if not name:
        return None

    stages = frontmatter.get("stages", [])
    if not stages:
        return None

    # Extract description (content after frontmatter)
    description = frontmatter_match.group(2).strip()
    # Clean up Hugo shortcodes and markdown
    description = re.sub(r'\{\{[^}]+\}\}', '', description)
    description = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', description)  # [text](url) -> text
    description = re.sub(r'\s+', ' ', description).strip()

    # Limit description length
    if len(description) > 500:
        description = description[:497] + "..."

    return {
        "name": name,
        "stages": stages,
        "description": description,
        "removed": frontmatter.get("removed", False),
    }


def get_status_at_version(
    stages: list[dict[str, Any]],
    target_version: str,
) -> dict[str, Any] | None:
    """
    Get the feature gate status at a specific K8s version.

    Returns the stage entry that applies to the target version,
    or None if the feature didn't exist yet or was removed.
    """
    # Parse target version
    try:
        target_parts = [int(x) for x in target_version.split(".")]
        target_tuple = (target_parts[0], target_parts[1])
    except (ValueError, IndexError):
        return None

    applicable_stage = None

    for stage in stages:
        from_version = stage.get("fromVersion")
        to_version = stage.get("toVersion")

        if not from_version:
            continue

        try:
            from_parts = [int(x) for x in str(from_version).split(".")]
            from_tuple = (from_parts[0], from_parts[1])
        except (ValueError, IndexError):
            continue

        # Check if target is >= fromVersion
        if target_tuple < from_tuple:
            continue

        # Check if target is <= toVersion (if specified)
        if to_version:
            try:
                to_parts = [int(x) for x in str(to_version).split(".")]
                to_tuple = (to_parts[0], to_parts[1])
                if target_tuple > to_tuple:
                    continue
            except (ValueError, IndexError):
                pass

        # This stage applies to the target version
        applicable_stage = {
            "stage": stage.get("stage", "unknown"),
            "default": stage.get("defaultValue", False),
            "lock_to_default": stage.get("locked", False),
            "from_version": from_version,
            "to_version": to_version,
        }

    return applicable_stage


def build_version_history(stages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Convert stages array to version history format for storage.
    """
    history = []
    for stage in stages:
        entry = {
            "version": stage.get("fromVersion"),
            "stage": stage.get("stage"),
            "default": stage.get("defaultValue", False),
            "lock_to_default": stage.get("locked", False),
        }
        if stage.get("toVersion"):
            entry["to_version"] = stage.get("toVersion")
        history.append(entry)
    return history


def extract_feature_gates_for_version(
    version: str,
    quiet: bool = False,
) -> dict[str, Any]:
    """
    Extract feature gates for a specific K8s version from the website docs.

    This checks out the website repo to that version's tag and parses the
    feature gate markdown files.

    Args:
        version: K8s version like "1.32"
        quiet: Suppress output

    Returns:
        Dict with version and list of feature gates with their status at that version
    """
    repo_path = get_repo_path("website")
    if not repo_path.exists():
        if not quiet:
            console.print("[red]Website repo not found. Run: uv run k8s-pipeline sync-repos website[/red]")
        return {"version": version, "feature_gates": []}

    # Checkout specific version
    if not checkout_website_version(version, quiet=quiet):
        if not quiet:
            console.print(f"[yellow]Could not checkout version {version}[/yellow]")
        return {"version": version, "feature_gates": []}

    feature_gates_path = repo_path / FEATURE_GATES_PATH

    if not feature_gates_path.exists():
        if not quiet:
            console.print(f"[red]Feature gates docs not found at {feature_gates_path}[/red]")
        return {"version": version, "feature_gates": []}

    if not quiet:
        console.print(f"\n[bold]Extracting feature gates for {version}[/bold]")

    gates_at_version = []

    # Parse all feature gate files
    for file_path in sorted(feature_gates_path.glob("*.md")):
        if file_path.name == "index.md":
            continue

        gate_data = parse_feature_gate_file(file_path)
        if not gate_data:
            continue

        # Get status at this version
        status = get_status_at_version(gate_data["stages"], version)
        if status is None:
            # Feature didn't exist at this version
            continue

        gate_entry = {
            "name": gate_data["name"],
            "stage": status["stage"],
            "default": status["default"],
            "lock_to_default": status["lock_to_default"],
            "description": gate_data["description"],
            "removed": gate_data["removed"],
            # Include full history for reference
            "version_history": build_version_history(gate_data["stages"]),
        }

        gates_at_version.append(gate_entry)

        if not quiet:
            stage_color = {
                "alpha": "magenta",
                "beta": "yellow",
                "stable": "green",
                "deprecated": "red",
            }.get(status["stage"], "white")
            default_str = "on" if status["default"] else "off"
            console.print(f"  [{stage_color}]{status['stage']:10}[/{stage_color}] {gate_data['name']} (default: {default_str})")

    result = {
        "version": version,
        "feature_gate_count": len(gates_at_version),
        "feature_gates": gates_at_version,
    }

    if not quiet:
        # Summary by stage
        by_stage: dict[str, int] = {}
        for gate in gates_at_version:
            stage = gate["stage"]
            by_stage[stage] = by_stage.get(stage, 0) + 1

        console.print(f"\n[bold]Summary for {version}:[/bold]")
        for stage in ["alpha", "beta", "stable", "deprecated"]:
            if stage in by_stage:
                console.print(f"  {stage}: {by_stage[stage]}")
        console.print(f"  [bold]Total: {len(gates_at_version)}[/bold]")

    return result


def compare_feature_gates(
    version1: str,
    version2: str,
    quiet: bool = False,
) -> dict[str, Any]:
    """
    Compare feature gates between two K8s versions.

    Returns dict with added, removed, and changed gates.
    """
    if not quiet:
        console.print(f"\n[bold]Comparing feature gates {version1} → {version2}[/bold]")

    # Extract for both versions
    data1 = extract_feature_gates_for_version(version1, quiet=True)
    data2 = extract_feature_gates_for_version(version2, quiet=True)

    gates1 = {g["name"]: g for g in data1.get("feature_gates", [])}
    gates2 = {g["name"]: g for g in data2.get("feature_gates", [])}

    added = set(gates2.keys()) - set(gates1.keys())
    removed = set(gates1.keys()) - set(gates2.keys())

    # Check for stage changes
    stage_changes = []
    for name in set(gates1.keys()) & set(gates2.keys()):
        if gates1[name]["stage"] != gates2[name]["stage"]:
            stage_changes.append({
                "name": name,
                "from_stage": gates1[name]["stage"],
                "to_stage": gates2[name]["stage"],
            })

    diff = {
        "from_version": version1,
        "to_version": version2,
        "added": [gates2[n] for n in sorted(added)],
        "removed": [gates1[n] for n in sorted(removed)],
        "stage_changes": stage_changes,
    }

    if not quiet:
        if added:
            console.print(f"\n  [green]+{len(added)} new feature gates[/green]")
            for name in sorted(added):
                console.print(f"    [green]+[/green] {name} ({gates2[name]['stage']})")

        if removed:
            console.print(f"\n  [red]-{len(removed)} removed feature gates[/red]")
            for name in sorted(removed):
                console.print(f"    [red]-[/red] {name}")

        if stage_changes:
            console.print(f"\n  [yellow]{len(stage_changes)} stage changes[/yellow]")
            for change in stage_changes:
                console.print(f"    {change['name']}: {change['from_stage']} → {change['to_stage']}")

    return diff


def save_feature_gates_data(output_path: Path, data: dict[str, Any]) -> None:
    """Save extracted feature gates data to JSON."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(data, f, indent=2)
    console.print(f"[green]✓ Saved to {output_path}[/green]")


def extract_and_save_feature_gates(
    version: str,
    output_path: Path | None = None,
    quiet: bool = False,
) -> dict[str, Any]:
    """
    Extract feature gates for a version and save to JSON.

    Args:
        version: K8s version like "1.32"
        output_path: Output file path (default: curated/feature-gates/feature_gates_{version}.json)
        quiet: Suppress output

    Returns:
        Extracted feature gates data
    """
    from ...core.config import CURATED_FEATURE_GATES_DIR

    if output_path is None:
        output_path = CURATED_FEATURE_GATES_DIR / f"feature_gates_{version}.json"

    data = extract_feature_gates_for_version(version=version, quiet=quiet)
    save_feature_gates_data(output_path, data)

    return data


def extract_all_versions(
    quiet: bool = False,
) -> dict[str, dict[str, Any]]:
    """
    Extract feature gates for all K8s versions.

    Args:
        quiet: Suppress output

    Returns:
        Dict mapping version -> feature gates data
    """
    from ...core.config import CURATED_FEATURE_GATES_DIR, K8S_VERSIONS

    if not quiet:
        console.print("\n[bold]Extracting feature gates for all versions[/bold]")

    results = {}

    for version in K8S_VERSIONS:
        if not quiet:
            console.print(f"\n[bold cyan]═══ Version {version} ═══[/bold cyan]")

        output_path = CURATED_FEATURE_GATES_DIR / f"feature_gates_{version}.json"
        data = extract_feature_gates_for_version(version=version, quiet=quiet)

        if data.get("feature_gates"):
            save_feature_gates_data(output_path, data)
            results[version] = data
        else:
            if not quiet:
                console.print(f"  [yellow]No feature gates data found for {version}[/yellow]")

    if not quiet:
        console.print(f"\n[bold green]✓ Extracted feature gates for {len(results)} versions[/bold green]")

    return results


def link_feature_gates_to_keps(
    feature_gates: list[dict[str, Any]],
    quiet: bool = False,
) -> list[dict[str, Any]]:
    """
    Link feature gates to KEPs using the keps table.

    Updates feature gates in place with kep field if a match is found.
    """
    from ...core.config import PIPELINE_DATA_DIR

    # Try to load KEPs from parquet
    parquet_path = PIPELINE_DATA_DIR / "output" / "parquet" / "keps.parquet"
    keps_by_gate: dict[str, dict[str, Any]] = {}

    if parquet_path.exists():
        try:
            import pyarrow.parquet as pq
            table = pq.read_table(parquet_path)

            for i in range(table.num_rows):
                feature_gate = table.column("feature_gate")[i].as_py()
                if feature_gate:
                    keps_by_gate[feature_gate] = {
                        "kep": table.column("kep")[i].as_py(),
                        "title": table.column("title")[i].as_py(),
                        "kep_path": table.column("kep_path")[i].as_py(),
                    }
        except Exception as err:
            if not quiet:
                console.print(f"[yellow]Warning: Could not load KEPs: {err}[/yellow]")

    linked_count = 0
    for gate in feature_gates:
        gate_name = gate["name"]

        # Check if we have a KEP with this feature gate
        if gate_name in keps_by_gate:
            kep_info = keps_by_gate[gate_name]
            gate["kep"] = kep_info["kep"]
            gate["kep_title"] = kep_info["title"]
            gate["kep_path"] = kep_info["kep_path"]
            linked_count += 1

    if not quiet and linked_count > 0:
        console.print(f"[green]Linked {linked_count} feature gates to KEPs[/green]")

    return feature_gates
