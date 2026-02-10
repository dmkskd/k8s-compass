"""
Enrich release notes with LLM-generated structured content.

Enriches:
- Urgent upgrade notes: Extract title, summary, action required, severity, affected components
- Deprecations: Add impact, migration guidance, timeline clarity

Usage:
    uv run k8s-pipeline enrich-release-notes 1.35
    uv run k8s-pipeline enrich-release-notes 1.35 --category urgent
    uv run k8s-pipeline enrich-release-notes 1.35 --category deprecations
"""

import json
from typing import Any

from pydantic import BaseModel, Field

from ...core.config import OUTPUT_DIR
from ..llm_utils import (
    ProviderType,
    UsageTracker,
    create_agent,
    get_effective_model_id,
    get_provider_config,
    load_config,
    log,
)

RELEASES_DIR = OUTPUT_DIR / "releases"


# ============================================================================
# Pydantic models for structured output
# ============================================================================


class UrgentNoteEnrichment(BaseModel):
    """Structured output for urgent upgrade note enrichment."""

    title: str = Field(description="A short title (max 10 words) summarizing the change")
    summary: str = Field(description="1-2 sentence summary of what changed")
    action: str = Field(description="Specific action users must take (be concrete)")
    severity: str = Field(description="Severity: critical, high, medium, or low")
    affected_components: list[str] = Field(
        default_factory=list,
        description="Affected K8s components: kubelet, kube-apiserver, kube-proxy, etc."
    )
    affected_workloads: list[str] = Field(
        default_factory=list,
        description="Workload types affected: pods, deployments, statefulsets, etc."
    )
    breaking_change: bool = Field(description="True if this is a breaking change")


class DeprecationEnrichment(BaseModel):
    """Structured output for deprecation enrichment."""

    summary: str = Field(description="1-2 sentence explanation of what's being deprecated and why")
    impact: str = Field(description="Who is affected and how (users, operators, specific workloads)")
    migration_steps: list[str] = Field(
        default_factory=list,
        description="Concrete steps to migrate away from this"
    )
    urgency: str = Field(description="Urgency: immediate, plan-now, or future based on removal timeline")
    affected_apis: list[str] = Field(
        default_factory=list,
        description="Affected API resources/fields if applicable"
    )


# ============================================================================
# Enrichment functions
# ============================================================================


def enrich_urgent_note(note: dict, agent: Any) -> tuple[dict | None, tuple[int, int]]:
    """Enrich a single urgent upgrade note with structured fields.

    Returns:
        Tuple of (enrichment dict, (input_tokens, output_tokens))
    """
    from ..llm_utils import get_result_usage

    description = note.get("description", "")
    if not description:
        return None, (0, 0)

    prompt = f"""Analyze this Kubernetes urgent upgrade note and extract structured information.

URGENT UPGRADE NOTE:
{description}

Extract the key information about this upgrade note. Be concise but informative."""

    try:
        # Use new API: pass structured_output_model to agent invocation
        result = agent(prompt, structured_output_model=UrgentNoteEnrichment)
        usage = get_result_usage(result)
        enrichment = result.structured_output
        return {
            "title": enrichment.title,
            "summary": enrichment.summary,
            "action": enrichment.action,
            "severity": enrichment.severity,
            "affectedComponents": enrichment.affected_components,
            "affectedWorkloads": enrichment.affected_workloads,
            "breakingChange": enrichment.breaking_change,
        }, usage
    except Exception as e:
        log(f"    [ERROR] Failed to enrich: {e}")
        return None, (0, 0)


def enrich_deprecation(dep: dict, agent: Any) -> tuple[dict | None, tuple[int, int]]:
    """Enrich a deprecation notice with additional context.

    Returns:
        Tuple of (enrichment dict, (input_tokens, output_tokens))
    """
    from ..llm_utils import get_result_usage

    item = dep.get("item", "")
    reason = dep.get("reason", "")
    replacement = dep.get("replacement", "")

    prompt = f"""Analyze this Kubernetes deprecation notice and provide enriched information.

DEPRECATION:
- Item: {item}
- Reason: {reason}
- Replacement: {replacement}

Extract the key information about this deprecation. Be concise but informative."""

    try:
        # Use new API: pass structured_output_model to agent invocation
        result = agent(prompt, structured_output_model=DeprecationEnrichment)
        usage = get_result_usage(result)
        enrichment = result.structured_output
        return {
            "summary": enrichment.summary,
            "impact": enrichment.impact,
            "migrationSteps": enrichment.migration_steps,
            "urgency": enrichment.urgency,
            "affectedAPIs": enrichment.affected_apis,
        }, usage
    except Exception as e:
        log(f"    [ERROR] Failed to enrich: {e}")
        return None, (0, 0)


# ============================================================================
# Main enrichment function
# ============================================================================


def enrich_release_notes(
    version: str,
    categories: list[str] | None = None,
    provider: ProviderType | None = None,
    model_id: str | None = None,
    max_items: int | None = None,
    skip_enriched: bool = True,
    concurrency: int = 1,
) -> dict[str, int]:
    """
    Enrich release notes for a version.

    Args:
        version: K8s version (e.g., "1.35")
        categories: List of categories to enrich. Default: all
                   Options: "urgent", "deprecations"
        provider: LLM provider override (uses config file if not specified)
        model_id: Optional specific model ID override
        max_items: Max items to enrich per category (for testing)
        skip_enriched: Skip items that already have enrichment
        concurrency: Number of concurrent LLM requests (default: 1 = sequential)

    Returns:
        Dict with counts of enriched items per category
    """
    import concurrent.futures
    import threading

    # Load LLM config
    config = load_config()
    provider_name, provider_config = get_provider_config(config, provider)
    effective_model_id = get_effective_model_id(provider_config, model_id)

    log(f"\n{'=' * 60}")
    log(f"Enriching release notes for Kubernetes {version}")
    log(f"Provider: {provider_name}, Model: {effective_model_id}")
    if concurrency > 1:
        log(f"Concurrency: {concurrency}")
    log(f"{'=' * 60}")

    # Load release
    release_path = RELEASES_DIR / f"{version}.json"
    if not release_path.exists():
        log(f"[ERROR] Release file not found: {release_path}")
        return {}

    with open(release_path) as f:
        release = json.load(f)

    tracker = UsageTracker(effective_model_id)
    lock = threading.Lock()

    # Default to all categories
    if not categories:
        categories = ["urgent", "deprecations"]

    results = {}

    # Enrich urgent upgrade notes
    if "urgent" in categories:
        log("\n[URGENT] Enriching action required notes...")
        notes = release.get("actionRequired", [])

        # Collect items to process
        to_process: list[tuple[int, dict]] = []
        for i, note in enumerate(notes):
            if skip_enriched and note.get("enrichment"):
                continue
            to_process.append((i, note))
            if max_items and len(to_process) >= max_items:
                break

        enriched = 0
        processed = 0

        def process_urgent(item: tuple[int, dict]) -> tuple[int, dict | None, tuple[int, int]]:
            idx, note = item
            # Create agent per thread
            agent = create_agent(
                provider_name,  # type: ignore
                provider_config,
                "You are a Kubernetes expert helping users understand release notes and upgrade requirements.",
                model_id,
            )
            enrichment, usage = enrich_urgent_note(note, agent)
            return idx, enrichment, usage

        if to_process:
            with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
                futures = {executor.submit(process_urgent, item): item for item in to_process}

                for future in concurrent.futures.as_completed(futures):
                    item = futures[future]
                    idx, note = item

                    try:
                        result_idx, enrichment, (in_tokens, out_tokens) = future.result()

                        with lock:
                            processed += 1
                            tracker.add(in_tokens, out_tokens)
                            desc_preview = note.get("description", "")[:50]

                            if enrichment:
                                notes[result_idx]["enrichment"] = enrichment
                                enriched += 1
                                log(f"  [{processed}/{len(to_process)}] {desc_preview}... [OK] {enrichment.get('title', 'enriched')}{tracker.format_call(in_tokens, out_tokens)}")
                            else:
                                log(f"  [{processed}/{len(to_process)}] {desc_preview}... [FAIL]")

                    except Exception as e:
                        with lock:
                            processed += 1
                            log(f"  [{processed}/{len(to_process)}] [ERROR] {e}")

        results["urgent"] = enriched
        log(f"  [DONE] Enriched {enriched}/{len(notes)} urgent notes")

    # Enrich deprecations
    if "deprecations" in categories:
        log("\n[DEPRECATIONS] Enriching deprecation notices...")
        deps = release.get("deprecations", [])

        # Collect items to process
        to_process_deps: list[tuple[int, dict]] = []
        for i, dep in enumerate(deps):
            if skip_enriched and dep.get("enrichment"):
                continue
            to_process_deps.append((i, dep))
            if max_items and len(to_process_deps) >= max_items:
                break

        enriched = 0
        processed = 0

        def process_deprecation(item: tuple[int, dict]) -> tuple[int, dict | None, tuple[int, int]]:
            idx, dep = item
            # Create agent per thread
            agent = create_agent(
                provider_name,  # type: ignore
                provider_config,
                "You are a Kubernetes expert helping users understand release notes and upgrade requirements.",
                model_id,
            )
            enrichment, usage = enrich_deprecation(dep, agent)
            return idx, enrichment, usage

        if to_process_deps:
            with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
                futures = {executor.submit(process_deprecation, item): item for item in to_process_deps}

                for future in concurrent.futures.as_completed(futures):
                    item = futures[future]
                    idx, dep = item

                    try:
                        result_idx, enrichment, (in_tokens, out_tokens) = future.result()

                        with lock:
                            processed += 1
                            tracker.add(in_tokens, out_tokens)
                            item_preview = dep.get("item", "")[:50]

                            if enrichment:
                                deps[result_idx]["enrichment"] = enrichment
                                enriched += 1
                                log(f"  [{processed}/{len(to_process_deps)}] {item_preview}... [OK] urgency={enrichment.get('urgency', '?')}{tracker.format_call(in_tokens, out_tokens)}")
                            else:
                                log(f"  [{processed}/{len(to_process_deps)}] {item_preview}... [FAIL]")

                    except Exception as e:
                        with lock:
                            processed += 1
                            log(f"  [{processed}/{len(to_process_deps)}] [ERROR] {e}")

        results["deprecations"] = enriched
        log(f"  [DONE] Enriched {enriched}/{len(deps)} deprecations")

    # Save updated release
    with open(release_path, "w") as f:
        json.dump(release, f, indent=2)

    log(f"\n[SAVED] Updated {release_path.name}")

    # Get total usage stats
    if tracker.total_input or tracker.total_output:
        results["usage"] = {
            "input_tokens": tracker.total_input,
            "output_tokens": tracker.total_output,
            "total_tokens": tracker.total_input + tracker.total_output,
            "cost_usd": tracker.get_total_cost(),
        }
        log(f"\n[USAGE] {tracker.format_total()}")

    return results
