"""Fetch K8s version support data from cloud providers via endoflife.date API.

This module fetches version support information from endoflife.date for:
- Amazon EKS
- Google GKE
- Azure AKS
- Red Hat OpenShift

The data enables comparison queries like:
- Which provider has the longest support period?
- Which provider releases new K8s versions fastest?
- How many versions does each provider currently support?

Data source: https://endoflife.date/api/{product}.json
"""

import json
from datetime import datetime
from pathlib import Path

import httpx
from rich.console import Console

from ...core.config import (
    ENDOFLIFE_API_URL,
    OUTPUT_DIR,
    PROVIDERS,
)

console = Console()

# Output file for provider data
PROVIDERS_OUTPUT_DIR = OUTPUT_DIR / "providers"


def _parse_date(date_str: str | bool | None) -> str | None:
    """Parse date string from endoflife.date API.

    The API returns dates as "YYYY-MM-DD" strings, or False/True for boolean fields.
    """
    if date_str is None or date_str is False or date_str is True:
        return None
    if isinstance(date_str, str):
        return date_str
    return None


def _days_between(date1: str | None, date2: str | None) -> int | None:
    """Calculate days between two ISO date strings."""
    if not date1 or not date2:
        return None
    try:
        d1 = datetime.fromisoformat(date1)
        d2 = datetime.fromisoformat(date2)
        return (d2 - d1).days
    except ValueError:
        return None


def _get_status(eol_date: str | None, eol_extended: str | None) -> str:
    """Determine version status based on EOL dates."""
    today = datetime.now().date().isoformat()

    if eol_date and eol_date <= today:
        return "eol"
    if eol_extended and eol_extended <= today:
        return "eol"
    if eol_date and eol_extended and eol_date <= today < eol_extended:
        return "extended"
    return "supported"


def _fetch_k8s_release_dates() -> dict[str, str]:
    """Fetch upstream K8s release dates from endoflife.date."""
    url = f"{ENDOFLIFE_API_URL}/kubernetes.json"

    try:
        response = httpx.get(url, timeout=30)
        response.raise_for_status()
        data = response.json()

        return {
            str(v.get("cycle", "")): _parse_date(v.get("releaseDate"))
            for v in data
            if v.get("cycle") and v.get("releaseDate")
        }
    except Exception as e:
        console.print(f"  [yellow]Warning: Could not fetch K8s release dates: {e}[/yellow]")
        return {}


def fetch_provider_versions(provider_id: str) -> list[dict]:
    """Fetch version data for a single provider from endoflife.date.

    Args:
        provider_id: Provider key from PROVIDERS config (eks, gke, aks, openshift)

    Returns:
        List of version records with normalized fields
    """
    if provider_id not in PROVIDERS:
        raise ValueError(f"Unknown provider: {provider_id}. Available: {list(PROVIDERS.keys())}")

    provider = PROVIDERS[provider_id]
    product = provider["product"]
    url = f"{ENDOFLIFE_API_URL}/{product}.json"

    console.print(f"  Fetching {provider['display_name']} from {url}")

    response = httpx.get(url, timeout=30)
    response.raise_for_status()

    raw_versions = response.json()
    versions = []

    # Also fetch upstream K8s release dates for comparison
    k8s_releases = _fetch_k8s_release_dates()

    for v in raw_versions:
        # Get the version cycle (e.g., "1.31" or "4.17")
        cycle = str(v.get("cycle", ""))

        # Map to K8s version for OpenShift
        if provider["versioning"] == "custom":
            k8s_version = provider.get("k8s_mapping", {}).get(cycle)
        else:
            k8s_version = cycle

        # Skip if we can't map to a K8s version
        if not k8s_version:
            continue

        # Parse dates
        release_date = _parse_date(v.get("releaseDate"))
        eol_date = _parse_date(v.get("eol"))
        eol_extended = _parse_date(v.get("extendedSupport"))

        # Get upstream K8s release date for this version
        upstream_date = k8s_releases.get(k8s_version)

        # Calculate metrics
        days_to_availability = _days_between(upstream_date, release_date)
        standard_support_days = _days_between(release_date, eol_date)
        extended_support_days = _days_between(eol_date, eol_extended) if eol_extended else 0
        total_support_days = (standard_support_days or 0) + (extended_support_days or 0)

        # Get latest patch info
        latest = v.get("latest", "")
        latest_date = _parse_date(v.get("latestReleaseDate"))

        # Determine if extended support is available for this version
        has_extended_support = eol_extended is not None

        versions.append({
            "provider_id": provider_id,
            "k8s_version": k8s_version,
            "provider_version": cycle,
            "upstream_release_date": upstream_date,
            "provider_release_date": release_date,
            "eol_standard_date": eol_date,
            "eol_extended_date": eol_extended,
            "days_to_availability": days_to_availability,
            "standard_support_days": standard_support_days,
            "extended_support_days": extended_support_days,
            "total_support_days": total_support_days if total_support_days > 0 else None,
            "status": _get_status(eol_date, eol_extended),
            "has_extended_support": has_extended_support,
            "latest_patch": latest,
            "latest_patch_date": latest_date,
        })

    return versions


def fetch_all_providers() -> dict[str, list[dict]]:
    """Fetch version data for all configured providers.

    Returns:
        Dict mapping provider_id to list of version records
    """
    results = {}

    for provider_id in PROVIDERS:
        try:
            versions = fetch_provider_versions(provider_id)
            results[provider_id] = versions
            console.print(f"    [green]✓[/green] {len(versions)} versions")
        except Exception as e:
            console.print(f"    [red]✗[/red] Error: {e}")
            results[provider_id] = []

    return results


def save_provider_data(data: dict[str, list[dict]]) -> Path:
    """Save provider data to JSON file.

    Args:
        data: Dict mapping provider_id to version records

    Returns:
        Path to saved file
    """
    PROVIDERS_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = PROVIDERS_OUTPUT_DIR / "provider_versions.json"

    # Build output structure
    output = {
        "providers": [
            {
                "provider_id": pid,
                "display_name": PROVIDERS[pid]["display_name"],
                "color": PROVIDERS[pid]["color"],
                "docs_url": PROVIDERS[pid]["docs_url"],
                "version_docs_url": PROVIDERS[pid].get("version_docs_url"),
                "versioning_scheme": PROVIDERS[pid]["versioning"],
                "support_model": PROVIDERS[pid].get("support_model"),
                "standard_support_months": PROVIDERS[pid].get("standard_support_months"),
                "extended_support_months": PROVIDERS[pid].get("extended_support_months"),
            }
            for pid in PROVIDERS
        ],
        "versions": [],
    }

    # Flatten all versions
    for _provider_id, versions in data.items():
        output["versions"].extend(versions)

    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)

    return output_path


def load_provider_data() -> dict | None:
    """Load provider data from JSON file if it exists."""
    output_path = PROVIDERS_OUTPUT_DIR / "provider_versions.json"

    if not output_path.exists():
        return None

    with open(output_path) as f:
        return json.load(f)


def get_provider_summary() -> dict:
    """Get summary statistics for all providers.

    Returns dict with:
    - supported_count: Number of currently supported versions per provider
    - avg_support_days: Average total support days per provider
    - avg_days_to_availability: Average days from upstream release to provider availability
    """
    data = load_provider_data()
    if not data:
        return {}

    summary = {}

    for provider_id in PROVIDERS:
        versions = [v for v in data["versions"] if v["provider_id"] == provider_id]
        supported = [v for v in versions if v["status"] == "supported"]

        support_days = [v["total_support_days"] for v in versions if v["total_support_days"]]
        availability_days = [v["days_to_availability"] for v in versions if v["days_to_availability"]]

        summary[provider_id] = {
            "display_name": PROVIDERS[provider_id]["display_name"],
            "total_versions": len(versions),
            "supported_count": len(supported),
            "avg_support_days": sum(support_days) / len(support_days) if support_days else None,
            "avg_days_to_availability": sum(availability_days) / len(availability_days) if availability_days else None,
        }

    return summary
