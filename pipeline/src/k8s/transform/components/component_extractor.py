"""
Extract Kubernetes component configuration flags from official documentation.

This module parses the kubernetes/website repo to extract CLI flags
for control plane components (kube-apiserver, kube-scheduler, etc.)
and node components (kubelet, kube-proxy).

Data source:
- kubernetes/website repo
- content/en/docs/reference/command-line-tools-reference/*.md

The website repo uses tags like `snapshot-final-v1.32` for each K8s release.
"""

import json
import re
from pathlib import Path
from typing import Any

from rich.console import Console

from ...input.repo_manager import fetch_repo, get_repo_path, run_git

console = Console()

# Component definitions with their doc file names
COMPONENTS = {
    "kube-apiserver": {
        "type": "control-plane",
        "display_name": "API Server",
        "description": "The API server is the front end for the Kubernetes control plane. It exposes the Kubernetes API and handles REST operations.",
        "docs_url": "https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/",
        "doc_file": "kube-apiserver.md",
    },
    "kube-controller-manager": {
        "type": "control-plane",
        "display_name": "Controller Manager",
        "description": "Runs controller processes that regulate the state of the cluster. Each controller is a separate process compiled into a single binary.",
        "docs_url": "https://kubernetes.io/docs/reference/command-line-tools-reference/kube-controller-manager/",
        "doc_file": "kube-controller-manager.md",
    },
    "kube-scheduler": {
        "type": "control-plane",
        "display_name": "Scheduler",
        "description": "Watches for newly created Pods with no assigned node, and selects a node for them to run on.",
        "docs_url": "https://kubernetes.io/docs/reference/command-line-tools-reference/kube-scheduler/",
        "doc_file": "kube-scheduler.md",
    },
    "kubelet": {
        "type": "node",
        "display_name": "Kubelet",
        "description": "The primary node agent that runs on each node. It ensures containers are running in a Pod.",
        "docs_url": "https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet/",
        "doc_file": "kubelet.md",
    },
    "kube-proxy": {
        "type": "node",
        "display_name": "Kube Proxy",
        "description": "Network proxy that runs on each node, implementing part of the Kubernetes Service concept.",
        "docs_url": "https://kubernetes.io/docs/reference/command-line-tools-reference/kube-proxy/",
        "doc_file": "kube-proxy.md",
    },
    "etcd": {
        "type": "control-plane",
        "display_name": "etcd",
        "description": "Consistent and highly-available key value store used as Kubernetes' backing store for all cluster data.",
        "docs_url": "https://etcd.io/docs/",
        "doc_file": None,  # etcd is external
    },
    "coredns": {
        "type": "addon",
        "display_name": "CoreDNS",
        "description": "Flexible, extensible DNS server that provides DNS-based service discovery for Kubernetes.",
        "docs_url": "https://coredns.io/manual/toc/",
        "doc_file": None,  # CoreDNS is external
    },
    "containerd": {
        "type": "runtime",
        "display_name": "containerd",
        "description": "Industry-standard container runtime with an emphasis on simplicity, robustness and portability.",
        "docs_url": "https://containerd.io/docs/",
        "doc_file": None,  # containerd is external
    },
    "cni": {
        "type": "addon",
        "display_name": "CNI Plugin",
        "description": "Container Network Interface plugin provides networking for pods.",
        "docs_url": "https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/network-plugins/",
        "doc_file": None,  # CNI is external
    },
}

# Path to command-line reference docs in website repo
DOCS_PATH = "content/en/docs/reference/command-line-tools-reference"


def find_website_tag_for_version(repo_path: Path, version: str) -> str | None:
    """
    Find the website repo tag for a K8s version.

    Website uses tags like:
    - snapshot-final-v1.32 (preferred - more polished docs)
    - snapshot-initial-v1.32 (fallback - available for all versions)

    The "final" tag is created after docs are finalized for a release.
    The "initial" tag is created at the start of the release cycle.
    """
    # Try snapshot-final first (preferred - more polished)
    success, output = run_git(["tag", "-l", f"snapshot-final-v{version}"], cwd=repo_path)
    if success and output.strip():
        return output.strip()

    # Try snapshot-initial (available for all versions)
    success, output = run_git(["tag", "-l", f"snapshot-initial-v{version}"], cwd=repo_path)
    if success and output.strip():
        return output.strip()

    # Try plain snapshot-v (older format)
    success, output = run_git(["tag", "-l", f"snapshot-v{version}"], cwd=repo_path)
    if success and output.strip():
        return output.strip()

    # List all tags for this version and pick best match
    success, output = run_git(["tag", "-l", f"*v{version}*"], cwd=repo_path)
    if success and output.strip():
        tags = output.strip().split("\n")
        # Prefer snapshot-final, then snapshot-initial, then snapshot, then release
        for prefix in ["snapshot-final-", "snapshot-initial-", "snapshot-", "release-"]:
            for tag in tags:
                if tag.startswith(prefix):
                    return tag
        # Return first match
        return tags[0] if tags else None

    return None


def checkout_website_version(version: str, quiet: bool = False) -> bool:
    """
    Checkout the website repo to a specific K8s version.

    Args:
        version: K8s version like "1.32" or "1.33"
        quiet: Suppress output

    Returns:
        True if checkout succeeded
    """
    from ...input.repo_manager import get_current_ref

    repo_path = get_repo_path("website")

    if not repo_path.exists():
        console.print("[red]Website repo not found. Run: uv run k8s-pipeline sync-repos website[/red]")
        return False

    # Fetch latest tags
    fetch_repo("website", quiet=quiet)

    # Find the right tag
    tag = find_website_tag_for_version(repo_path, version)

    if not tag:
        if not quiet:
            console.print(f"[yellow]No website tag found for version {version}[/yellow]")
        return False

    # Checkout the tag
    success, output = run_git(["checkout", tag], cwd=repo_path)

    if success:
        if not quiet:
            # Log the actual ref for traceability
            current_ref = get_current_ref("website")
            console.print(f"  [green]✓ Checked out website: {current_ref}[/green]")
        return True
    else:
        if not quiet:
            console.print(f"[red]Failed to checkout {tag}: {output}[/red]")
        return False


def parse_flag_from_html_row(flag_row: str, desc_row: str) -> dict[str, Any] | None:
    """
    Parse a flag from HTML table rows.

    The format in the docs is:
    <tr>
    <td colspan="2">--flag-name type&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Default: value</td>
    </tr>
    <tr>
    <td></td><td>Description text (DEPRECATED: ...)</td>
    </tr>
    """
    flag = {}

    # Extract flag name, type, and default from first row
    # Pattern: --flag-name type     Default: value
    flag_match = re.search(r'--([a-zA-Z0-9_-]+)\s*(\w+)?', flag_row)
    if not flag_match:
        return None

    flag["name"] = f"--{flag_match.group(1)}"

    # Extract type if present
    if flag_match.group(2):
        flag_type = flag_match.group(2).lower()
        # Filter out common non-type words
        if flag_type not in ["default", "nbsp"]:
            flag["type"] = flag_type

    # Extract default value
    default_match = re.search(r'Default:\s*(?:<code>)?([^<\s]+)(?:</code>)?', flag_row)
    if default_match:
        default_val = default_match.group(1).strip()
        if default_val and default_val not in ["&nbsp;", ""]:
            flag["default_value"] = default_val

    # Extract description from second row
    # Remove HTML tags
    description = re.sub(r'<[^>]+>', ' ', desc_row)
    # Clean up entities
    description = description.replace('&nbsp;', ' ')
    description = description.replace('&lt;', '<')
    description = description.replace('&gt;', '>')
    description = description.replace('&quot;', '"')
    description = description.replace('&amp;', '&')
    # Clean up whitespace
    description = ' '.join(description.split())

    # Check for deprecation
    if "DEPRECATED" in description or "deprecated" in description.lower():
        flag["deprecated"] = True

    if description:
        flag["description"] = description[:500]  # Limit length

    return flag


def extract_flags_from_markdown(file_path: Path) -> list[dict[str, Any]]:
    """
    Extract all flag definitions from a component's markdown doc.

    The docs use HTML tables with this structure:
    <tr>
    <td colspan="2">--flag-name type     Default: value</td>
    </tr>
    <tr>
    <td></td><td>Description text</td>
    </tr>
    """
    if not file_path.exists():
        return []

    content = file_path.read_text(encoding="utf-8")
    flags = []

    # Find all table row pairs (flag definition + description)
    # Pattern: <tr>...<td colspan="2">--flag...</td>...</tr>\s*<tr>...<td></td><td>description</td>...</tr>
    row_pattern = r'<tr>\s*<td colspan="2">([^<]*--[^<]+)</td>\s*</tr>\s*<tr>\s*<td></td><td[^>]*>(.+?)</td>\s*</tr>'

    for match in re.finditer(row_pattern, content, re.DOTALL):
        flag_row = match.group(1)
        desc_row = match.group(2)

        flag = parse_flag_from_html_row(flag_row, desc_row)
        if flag and flag.get("name"):
            flags.append(flag)

    return flags


def extract_component_flags(
    component_id: str,
    version: str | None = None,
    quiet: bool = False,
) -> list[dict[str, Any]]:
    """
    Extract flags for a component from the website docs.

    Args:
        component_id: Component ID like "kube-apiserver"
        version: K8s version like "1.32" (optional, uses current checkout if not specified)
        quiet: Suppress output

    Returns:
        List of flag definitions
    """
    component = COMPONENTS.get(component_id)
    if not component:
        return []

    doc_file = component.get("doc_file")
    if not doc_file:
        return []  # External component, no docs in website repo

    repo_path = get_repo_path("website")
    if not repo_path.exists():
        if not quiet:
            console.print("[red]Website repo not found[/red]")
        return []

    # Checkout specific version if requested
    if version:
        if not checkout_website_version(version, quiet=quiet):
            return []

    # Find the doc file
    doc_path = repo_path / DOCS_PATH / doc_file

    if not doc_path.exists():
        if not quiet:
            console.print(f"[yellow]Doc file not found: {doc_path}[/yellow]")
        return []

    if not quiet:
        console.print(f"  [dim]Parsing {doc_file}...[/dim]")

    flags = extract_flags_from_markdown(doc_path)

    # Add component_id to each flag
    for flag in flags:
        flag["component_id"] = component_id

    return flags


def extract_all_components(
    version: str | None = None,
    quiet: bool = False,
) -> dict[str, Any]:
    """
    Extract component metadata and flags for all components.

    Args:
        version: K8s version like "1.32" (optional)
        quiet: Suppress output

    Returns:
        Dict with components list and flags dict
    """
    result = {
        "version": version,
        "components": [],
        "flags": {},
    }

    # Checkout version if specified
    if version:
        if not checkout_website_version(version, quiet=quiet):
            console.print(f"[yellow]Could not checkout version {version}, using current[/yellow]")

    for component_id, component_info in COMPONENTS.items():
        # Add component metadata
        result["components"].append({
            "id": component_id,
            "type": component_info["type"],
            "display_name": component_info["display_name"],
            "description": component_info["description"],
            "docs_url": component_info["docs_url"],
            "related_keps": [],
            "controllers": [],
        })

        # Extract flags if doc file is defined
        if component_info.get("doc_file"):
            flags = extract_component_flags(component_id, version=None, quiet=quiet)
            if flags:
                result["flags"][component_id] = flags
                if not quiet:
                    console.print(f"  [green]✓ {component_id}: {len(flags)} flags[/green]")

    return result


def compare_versions(
    version1: str,
    version2: str,
    quiet: bool = False,
) -> dict[str, Any]:
    """
    Compare component flags between two K8s versions.

    Returns dict with added, removed, and changed flags per component.
    """
    if not quiet:
        console.print(f"\n[bold]Comparing {version1} → {version2}[/bold]")

    # Extract flags for both versions
    data1 = extract_all_components(version=version1, quiet=True)
    data2 = extract_all_components(version=version2, quiet=True)

    diff = {
        "from_version": version1,
        "to_version": version2,
        "changes": {},
    }

    for component_id in COMPONENTS:
        flags1 = {f["name"]: f for f in data1.get("flags", {}).get(component_id, [])}
        flags2 = {f["name"]: f for f in data2.get("flags", {}).get(component_id, [])}

        added = set(flags2.keys()) - set(flags1.keys())
        removed = set(flags1.keys()) - set(flags2.keys())

        if added or removed:
            diff["changes"][component_id] = {
                "added": [flags2[name] for name in sorted(added)],
                "removed": [flags1[name] for name in sorted(removed)],
            }

            if not quiet:
                if added:
                    console.print(f"  [green]{component_id}: +{len(added)} flags[/green]")
                if removed:
                    console.print(f"  [red]{component_id}: -{len(removed)} flags[/red]")

    return diff


def save_component_data(output_path: Path, data: dict[str, Any]) -> None:
    """Save extracted component data to JSON."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(data, f, indent=2)
    console.print(f"[green]✓ Saved to {output_path}[/green]")


def update_curated_components(
    version: str,
    output_path: Path | None = None,
    quiet: bool = False,
) -> dict[str, Any]:
    """
    Extract flags and update the curated components.json file.

    This merges extracted flags with any manual enrichments.
    """
    from ...core.config import CURATED_COMPONENTS_DIR

    if output_path is None:
        output_path = CURATED_COMPONENTS_DIR / "components.json"

    if not quiet:
        console.print(f"\n[bold]Extracting component flags for {version}[/bold]")

    # Extract from docs
    data = extract_all_components(version=version, quiet=quiet)

    # Convert to the format expected by components.json
    components_json = {"components": []}

    for component in data["components"]:
        comp_entry = {
            "id": component["id"],
            "type": component["type"],
            "display_name": component["display_name"],
            "description": component["description"],
            "docs_url": component["docs_url"],
            "related_keps": component.get("related_keps", []),
            "key_flags": [],
        }

        # Add controllers for controller-manager
        if component["id"] == "kube-controller-manager":
            comp_entry["controllers"] = [
                "deployment", "replicaset", "node", "service", "endpoint",
                "namespace", "serviceaccount", "job", "cronjob", "daemonset",
                "statefulset", "garbage-collector"
            ]

        # Add flags
        flags = data.get("flags", {}).get(component["id"], [])
        for flag in flags:
            flag_entry = {
                "name": flag["name"],
                "type": flag.get("type", "string"),
                "description": flag.get("description", ""),
            }
            if flag.get("default_value"):
                flag_entry["default"] = flag["default_value"]
            if flag.get("deprecated"):
                flag_entry["deprecated_in"] = version
            if flag.get("introduced_in"):
                flag_entry["introduced_in"] = flag["introduced_in"]

            comp_entry["key_flags"].append(flag_entry)

        components_json["components"].append(comp_entry)

    # Save
    save_component_data(output_path, components_json)

    return components_json


def extract_feature_gate_from_description(description: str) -> str | None:
    """
    Extract feature gate name from a flag description.

    Patterns found in K8s docs:
    - "Requires the XxxYyy feature gate"
    - "Requires feature gate XxxYyy"
    - "the XxxYyy feature gate is enabled"
    - "Enable the XxxYyy feature gate"
    - "Requires enabling feature gate (XxxYyy)"
    - "XxxYyy feature gate"
    - "feature gate XxxYyy"
    - "Requires the XxxYyy feature to be enabled" (without "gate")
    - "XxxYyy feature is enabled"
    """
    if not description:
        return None

    # Pattern for feature gate names (PascalCase, may have numbers)
    # Feature gates are typically PascalCase like: StructuredAuthenticationConfiguration, LoggingAlphaOptions
    # Must start with uppercase, have at least one more uppercase letter (to distinguish from regular words)
    gate_pattern = r'([A-Z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*)'

    # Common false positives to filter out
    false_positives = {
        'this', 'the', 'alpha', 'beta', 'if', 'when', 'no', 'not', 'true', 'false',
        'warning', 'deprecated', 'default', 'options', 'example', 'examples',
        'api', 'apis', 'cpu', 'gpu', 'io', 'ip', 'uid', 'uri', 'url',
    }

    patterns = [
        # "Requires the XxxYyy feature gate"
        rf'[Rr]equires\s+(?:the\s+)?{gate_pattern}\s+feature\s*gate',
        # "Requires feature gate XxxYyy"
        rf'[Rr]equires\s+(?:enabling\s+)?feature\s*gate\s*\(?{gate_pattern}\)?',
        # "the XxxYyy feature gate is enabled"
        rf'the\s+{gate_pattern}\s+feature\s*gate\s+(?:is\s+)?(?:enabled|disabled)',
        # "Enable the XxxYyy feature gate"
        rf'[Ee]nable\s+the\s+{gate_pattern}\s+feature\s*gate',
        # "XxxYyy feature gate" (standalone)
        rf'\b{gate_pattern}\s+feature\s*gate\b',
        # "feature gate XxxYyy"
        rf'feature\s*gate\s+{gate_pattern}',
        # "feature gate (XxxYyy)"
        rf'feature\s*gate\s*\({gate_pattern}\)',
        # "Requires the XxxYyy feature to be enabled" (without "gate")
        rf'[Rr]equires\s+(?:the\s+)?{gate_pattern}\s+feature\s+(?:to\s+be\s+)?enabled',
        # "XxxYyy feature is enabled" / "XxxYyy feature enabled"
        rf'\b{gate_pattern}\s+feature\s+(?:is\s+)?(?:enabled|disabled)',
        # "enabling feature (XxxYyy)" or "enabling feature XxxYyy"
        rf'enabling\s+(?:the\s+)?(?:feature\s+)?\(?{gate_pattern}\)?',
    ]

    for pattern in patterns:
        match = re.search(pattern, description)
        if match:
            gate = match.group(1)
            # Filter out common false positives
            if gate.lower() not in false_positives and len(gate) >= 4:
                return gate

    return None


def load_keps_with_feature_gates() -> dict[str, dict]:
    """
    Load KEPs that have feature gates defined.

    Returns dict mapping feature_gate -> KEP info
    """
    from ...core.config import PIPELINE_DATA_DIR

    keps_by_gate: dict[str, dict] = {}

    # Try to load from parquet first
    parquet_path = PIPELINE_DATA_DIR / "output" / "parquet" / "keps.parquet"
    if parquet_path.exists():
        try:
            import pyarrow.parquet as pq
            table = pq.read_table(parquet_path)

            # Get column indices
            schema = table.schema
            kep_idx = schema.get_field_index("kep")
            title_idx = schema.get_field_index("title")
            sig_idx = schema.get_field_index("sig")
            kep_path_idx = schema.get_field_index("kep_path")
            feature_gate_idx = schema.get_field_index("feature_gate")

            # Iterate through rows
            for i in range(table.num_rows):
                feature_gate = table.column(feature_gate_idx)[i].as_py()
                if feature_gate:
                    keps_by_gate[feature_gate] = {
                        "kep": table.column(kep_idx)[i].as_py(),
                        "title": table.column(title_idx)[i].as_py(),
                        "sig": table.column(sig_idx)[i].as_py(),
                        "kep_path": table.column(kep_path_idx)[i].as_py(),
                    }
        except Exception as e:
            console.print(f"[yellow]Warning: Could not load KEPs from parquet: {e}[/yellow]")

    return keps_by_gate


def link_flags_to_keps(
    components_data: dict[str, Any],
    quiet: bool = False,
) -> dict[str, Any]:
    """
    Link component flags to KEPs based on feature gates and text matching.

    Updates the components_data in place, adding related_keps and
    related_feature_gates to flags.
    """
    keps_by_gate = load_keps_with_feature_gates()

    if not keps_by_gate:
        if not quiet:
            console.print("[yellow]No KEPs with feature gates found[/yellow]")
        return components_data

    if not quiet:
        console.print(f"\n[bold]Linking flags to KEPs ({len(keps_by_gate)} feature gates)[/bold]")

    total_linked = 0

    for component in components_data.get("components", []):
        for flag in component.get("key_flags", []):
            description = flag.get("description", "")

            # Try to extract feature gate from description
            feature_gate = extract_feature_gate_from_description(description)

            if feature_gate:
                # Always store the feature gate name
                flag["related_feature_gates"] = [feature_gate]

                # Link to KEP if we have one for this feature gate
                if feature_gate in keps_by_gate:
                    kep_info = keps_by_gate[feature_gate]
                    flag["related_keps"] = [kep_info["kep"]]
                    total_linked += 1

                    if not quiet:
                        console.print(
                            f"  [green]✓[/green] {flag['name']} → {kep_info['kep']} "
                            f"[dim](via {feature_gate})[/dim]"
                        )
                else:
                    if not quiet:
                        console.print(
                            f"  [dim]○[/dim] {flag['name']} → {feature_gate} "
                            f"[dim](no KEP found)[/dim]"
                        )

    if not quiet:
        console.print(f"\n[bold]Linked {total_linked} flags to KEPs[/bold]")

    return components_data


def update_curated_components_with_keps(
    version: str,
    output_path: Path | None = None,
    quiet: bool = False,
) -> dict[str, Any]:
    """
    Extract flags and link them to KEPs, then save.
    """
    from ...core.config import CURATED_COMPONENTS_DIR

    if output_path is None:
        output_path = CURATED_COMPONENTS_DIR / "components.json"

    # First extract the flags
    components_data = update_curated_components(version, output_path, quiet=quiet)

    # Then link to KEPs
    components_data = link_flags_to_keps(components_data, quiet=quiet)

    # Save again with KEP links
    save_component_data(output_path, components_data)

    return components_data
