"""
Pass 2: Normalize and consolidate KEP labels.

After extracting labels from all KEPs (Pass 1), this module:
1. Analyzes the label distribution
2. Uses LLM to create a normalization mapping (merge similar labels)
3. Applies the mapping to consolidate labels

Usage:
    uv run k8s-pipeline normalize-kep-labels
    uv run k8s-pipeline normalize-kep-labels --dry-run  # Preview changes

Output:
    Updates data/curated/kep_metadata.json with normalized labels
    Creates data/curated/label_normalization_map.json for reference
"""

import json
from collections import Counter
from typing import Any

from pydantic import BaseModel, Field

from ...core.config import CURATED_KEPS_DIR
from ..llm_utils import (
    ProviderType,
    UsageTracker,
    create_agent,
    get_effective_model_id,
    get_provider_config,
    get_result_usage,
    load_config,
    log,
)

METADATA_PATH = CURATED_KEPS_DIR / "kep_metadata.json"
NORMALIZATION_MAP_PATH = CURATED_KEPS_DIR / "label_normalization_map.json"


class LabelNormalization(BaseModel):
    """Structured output for label normalization."""

    canonical: str = Field(
        description="The canonical/preferred label to use"
    )
    aliases: list[str] = Field(
        description="Labels that should be merged into the canonical label"
    )
    reason: str = Field(
        description="Brief explanation of why these labels should be merged"
    )


class NormalizationBatch(BaseModel):
    """Batch of label normalizations."""

    normalizations: list[LabelNormalization] = Field(
        description="List of label normalizations to apply"
    )


def load_metadata() -> dict[str, Any]:
    """Load the KEP metadata file."""
    if not METADATA_PATH.exists():
        raise FileNotFoundError(f"KEP metadata not found: {METADATA_PATH}")
    with open(METADATA_PATH) as f:
        return json.load(f)


def save_metadata(metadata: dict[str, Any]) -> None:
    """Save the KEP metadata file."""
    with open(METADATA_PATH, "w") as f:
        json.dump(metadata, f, indent=2)


def get_label_distribution(metadata: dict[str, Any]) -> Counter:
    """Get label counts from metadata."""
    labels = Counter()
    for kep_data in metadata.get("keps", {}).values():
        for label in kep_data.get("labels", []):
            labels[label] += 1
    return labels


def create_normalization_prompt(labels_with_counts: list[tuple[str, int]]) -> str:
    """Create prompt for LLM to suggest normalizations."""
    labels_str = "\n".join(f"  {label}: {count}" for label, count in labels_with_counts)

    return f"""Analyze these Kubernetes KEP labels and identify which ones should be merged/normalized.

Labels (with usage counts):
{labels_str}

Rules for normalization:
1. Merge singular/plural forms (prefer singular): pod/pods → pod
2. Merge synonyms: feature-gate/feature-gates → feature-gate
3. Merge related concepts that are too granular: device-plugin/device-plugins → device-plugin
4. Keep distinct concepts separate (don't merge "api" with "apiserver")
5. Prefer more specific labels when they're widely used
6. Prefer hyphenated compound terms: cpu-manager (not cpumanager)

For each normalization, specify:
- canonical: The preferred label to keep
- aliases: Labels to merge into the canonical one
- reason: Brief explanation

Only suggest normalizations where it makes sense to merge. Don't force merges.
Focus on the most impactful normalizations (labels with higher counts)."""


def get_normalizations_from_llm(
    labels: Counter,
    provider: ProviderType | None = None,
    model_id: str | None = None,
    batch_size: int = 100,
) -> list[LabelNormalization]:
    """Use LLM to suggest label normalizations."""
    config = load_config()
    provider_name, provider_config = get_provider_config(config, provider)
    effective_model_id = get_effective_model_id(provider_config, model_id)

    log("\n[NORMALIZE] Getting label normalizations from LLM")
    log(f"  Provider: {provider_name}, Model: {effective_model_id}")
    log(f"  Total unique labels: {len(labels)}")

    # Sort by count descending, process in batches
    sorted_labels = labels.most_common()
    all_normalizations = []
    tracker = UsageTracker(effective_model_id)

    # Process all labels in one batch (or multiple if too many)
    for i in range(0, len(sorted_labels), batch_size):
        batch = sorted_labels[i:i + batch_size]
        log(f"\n  Processing batch {i // batch_size + 1} ({len(batch)} labels)...")

        agent = create_agent(
            provider_name,  # type: ignore
            provider_config,
            "You are a Kubernetes expert helping normalize and consolidate labels for KEP categorization.",
            model_id,
        )

        prompt = create_normalization_prompt(batch)

        try:
            result = agent(prompt, structured_output_model=NormalizationBatch)
            usage = get_result_usage(result)
            tracker.add(*usage)

            if result.structured_output:
                batch_normalizations = result.structured_output.normalizations
                all_normalizations.extend(batch_normalizations)
                log(f"    Found {len(batch_normalizations)} normalizations")
        except Exception as e:
            log(f"    [ERROR] Failed: {e}")

    log(f"\n[USAGE] {tracker.format_total()}")
    return all_normalizations


def build_normalization_map(normalizations: list[LabelNormalization]) -> dict[str, str]:
    """Build a mapping from alias → canonical label."""
    mapping = {}
    for norm in normalizations:
        for alias in norm.aliases:
            if alias != norm.canonical:
                mapping[alias] = norm.canonical
    return mapping


def apply_normalization(
    metadata: dict[str, Any],
    mapping: dict[str, str],
) -> tuple[dict[str, Any], dict[str, int]]:
    """
    Apply normalization mapping to metadata.

    Returns:
        Tuple of (updated_metadata, change_counts)
    """
    changes = Counter()

    for _kep_id, kep_data in metadata.get("keps", {}).items():
        original_labels = kep_data.get("labels", [])
        normalized_labels = []
        seen = set()

        for label in original_labels:
            # Apply mapping
            normalized = mapping.get(label, label)
            if normalized not in seen:
                normalized_labels.append(normalized)
                seen.add(normalized)
                if normalized != label:
                    changes[f"{label} → {normalized}"] += 1

        kep_data["labels"] = normalized_labels

    return metadata, changes


def normalize_labels(
    provider: ProviderType | None = None,
    model_id: str | None = None,
    dry_run: bool = False,
    save_map: bool = True,
) -> dict[str, Any]:
    """
    Main entry point: normalize labels in KEP metadata.

    Args:
        provider: LLM provider override
        model_id: Model ID override
        dry_run: If True, don't save changes
        save_map: If True, save the normalization map

    Returns:
        Updated metadata dict
    """
    log("\n[NORMALIZE] Loading KEP metadata...")
    metadata = load_metadata()
    labels = get_label_distribution(metadata)

    log(f"  Found {len(labels)} unique labels across {len(metadata.get('keps', {}))} KEPs")

    # Get normalizations from LLM
    normalizations = get_normalizations_from_llm(
        labels,
        provider=provider,
        model_id=model_id,
    )

    if not normalizations:
        log("  No normalizations suggested")
        return metadata

    # Build and save mapping
    mapping = build_normalization_map(normalizations)
    log(f"\n[NORMALIZE] Built mapping with {len(mapping)} aliases")

    if save_map:
        map_data = {
            "version": "1.0",
            "normalizations": [
                {
                    "canonical": n.canonical,
                    "aliases": n.aliases,
                    "reason": n.reason,
                }
                for n in normalizations
            ],
            "mapping": mapping,
        }
        with open(NORMALIZATION_MAP_PATH, "w") as f:
            json.dump(map_data, f, indent=2)
        log(f"  Saved normalization map to {NORMALIZATION_MAP_PATH}")

    # Apply normalization
    metadata, changes = apply_normalization(metadata, mapping)

    if changes:
        log(f"\n[NORMALIZE] Applied {sum(changes.values())} label changes:")
        for change, count in changes.most_common(20):
            log(f"    {change}: {count}")
        if len(changes) > 20:
            log(f"    ... and {len(changes) - 20} more")

    # Show new distribution
    new_labels = get_label_distribution(metadata)
    log(f"\n[NORMALIZE] After normalization: {len(new_labels)} unique labels (was {len(labels)})")

    if not dry_run:
        save_metadata(metadata)
        log(f"\n[DONE] Saved normalized metadata to {METADATA_PATH}")
    else:
        log("\n[DRY RUN] No changes saved")

    return metadata


def show_label_stats(metadata: dict[str, Any] | None = None) -> None:
    """Show label statistics."""
    if metadata is None:
        metadata = load_metadata()

    labels = get_label_distribution(metadata)

    log("\nLabel Statistics:")
    log(f"  Total KEPs: {len(metadata.get('keps', {}))}")
    log(f"  Unique labels: {len(labels)}")
    log("\nTop 30 labels:")
    for label, count in labels.most_common(30):
        log(f"    {label}: {count}")
