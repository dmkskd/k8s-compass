"""
Enrich release changes with LLM-generated context from PR and Issue data.

Most release notes are dry one-liners from release-notes.json. This module
uses PR bodies and linked GitHub issues to generate richer, more useful
descriptions that answer:

1. What was the problem? (from issue)
2. Who was affected? (from issue labels, description)
3. What's the fix? (from PR)
4. Why does it matter? (LLM synthesis)

Usage:
    uv run k8s-pipeline enrich-changes 1.35
    uv run k8s-pipeline enrich-changes 1.35 --kind bugOrRegression

What Gets Enriched:
- problem: What was broken or missing
- affected: Who was impacted and how
- fix: What the PR does to address it
- impact: Why this matters to users
- category: bug-fix, performance, security, usability, cleanup, etc.
- severity: low, medium, high, critical (for bugs/security)
- affectedComponents: kubelet, scheduler, api-server, etc.
"""

import json

from pydantic import BaseModel, Field

from ...core.config import OUTPUT_DIR
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

RELEASES_DIR = OUTPUT_DIR / "releases"

# Change kinds that benefit most from enrichment
ENRICHABLE_KINDS = ["bugOrRegression", "feature", "apiChange", "deprecation", "other"]


# ============================================================================
# Pydantic model for structured output
# ============================================================================


class EnrichedChange(BaseModel):
    """Structured output for LLM-enriched change data."""

    problem: str = Field(
        description="What was the problem, bug, or missing capability? Be specific about the symptoms."
    )
    affected: str = Field(
        description="Who was affected and how? Mention specific scenarios, workloads, or configurations."
    )
    fix: str = Field(
        description="What does this change do to address the problem? Be concrete about the solution."
    )
    impact: str = Field(
        description="Why does this matter to Kubernetes users? What's the practical benefit?"
    )
    category: str = Field(
        description="Category: bug-fix, performance, security, usability, cleanup, feature, api-change, deprecation"
    )
    severity: str = Field(
        description="Severity for bugs/security: low, medium, high, critical. Use 'n/a' for features/cleanup."
    )
    affected_components: list[str] = Field(
        default_factory=list,
        description="Kubernetes components affected: kubelet, kube-apiserver, kube-scheduler, kube-controller-manager, kubectl, kube-proxy, etc."
    )
    labels: list[str] = Field(
        default_factory=list,
        description="2-5 lowercase topic labels for categorization (e.g., networking, storage, security, autoscaling, pod-lifecycle)"
    )


# ============================================================================
# Prompt creation
# ============================================================================


def create_enrichment_prompt(change: dict) -> str:
    """Create the prompt for enriching a change."""
    context_parts = []

    # Original release note (always present)
    context_parts.append(f"Release Note:\n{change.get('description', 'No description')}")

    # PR info
    if pr_num := change.get('prNumber'):
        context_parts.append(f"\nPR Number: #{pr_num}")

    # User-facing change from PR body (if different/better than description)
    if uf := change.get('userFacingChange'):
        context_parts.append(f"\nUser-Facing Change (from PR):\n{uf}")

    # SIGs involved
    if sigs := change.get('sigs'):
        context_parts.append(f"\nSIGs: {', '.join(sigs)}")

    # KEP links (if any)
    if keps := change.get('kepLinks'):
        context_parts.append(f"\nRelated KEPs: {', '.join(keps)}")

    # Issue context (the gold mine for bugs!)
    if issues := change.get('issueContext'):
        context_parts.append("\n\n--- Linked GitHub Issues ---")
        for issue in issues:
            context_parts.append(f"\nIssue #{issue['number']}: {issue['title']}")
            if labels := issue.get('labels'):
                context_parts.append(f"Labels: {', '.join(labels)}")
            if body := issue.get('body'):
                # Truncate very long bodies
                body_preview = body[:1500] + "..." if len(body) > 1500 else body
                context_parts.append(f"Description:\n{body_preview}")

    context = "\n".join(context_parts)

    return f"""You are analyzing a Kubernetes release change to generate a clear, useful description.

Your goal is to transform a dry, technical release note into something that helps users understand:
1. What was the problem?
2. Who was affected?
3. What's the fix?
4. Why does it matter?

Here's all the context available:

{context}

---

Based on the above, extract structured information. Be concise but informative.
If information isn't available, make reasonable inferences from context or say "Not specified".

For severity:
- critical: Security vulnerabilities, data loss, cluster-wide outages
- high: Significant functionality broken, affects many users
- medium: Partial functionality issues, workarounds exist
- low: Minor issues, edge cases, cosmetic problems
- n/a: Features, cleanups, non-bug changes

For affected_components, only include components that are directly involved.

For labels, provide 2-5 lowercase topic labels for categorization and discovery.
- Be specific: prefer "traffic-distribution" over "networking", "cpu-manager" over "cpu"
- Include technology terms when relevant: numa, cgroups, ebpf, csi, cri, selinux, apparmor
- Include resource types if central: pod, deployment, service, job, statefulset

IMPORTANT - Use precise labels for core Kubernetes components:
- `scheduler` - ONLY for changes that directly modify kube-scheduler behavior, scheduling algorithms, or scheduler plugins
- `pod-placement` - for node selection, affinity, tolerations, topology spread constraints
- `kubelet` - for kubelet-specific changes (not general node features)
- `api-server` - ONLY for kube-apiserver specific changes
- `controller-manager` - ONLY for kube-controller-manager changes

DO NOT use `scheduler` or `scheduling` for:
- Kubelet/node resource management (use `node`, `resource-management`, `cgroups` instead)
- API cleanup or protobuf changes (use `api`, `api-machinery` instead)
- CLI tools like kubectl (use `cli`, `kubectl` instead)
- General infrastructure changes that don't directly affect the scheduler

Other feature areas: autoscaling, storage, networking, security, observability, workloads, windows, testing"""


# ============================================================================
# Single change enrichment
# ============================================================================


def enrich_single_change(
    change: dict,
    provider: ProviderType,
    provider_config: dict,
    model_id: str | None = None,
) -> tuple[EnrichedChange | None, tuple[int, int]]:
    """
    Use LLM to enrich a single change.

    Returns:
        Tuple of (result, (input_tokens, output_tokens))
    """
    agent = create_agent(
        provider,
        provider_config,
        "You are a Kubernetes expert helping users understand release changes.",
        model_id,
    )

    prompt = create_enrichment_prompt(change)

    try:
        # Use new API: pass structured_output_model to agent invocation
        result = agent(prompt, structured_output_model=EnrichedChange)
        usage = get_result_usage(result)
        return result.structured_output, usage
    except Exception as e:
        log(f"  [ERROR] LLM enrichment failed: {e}")
        return None, (0, 0)


# ============================================================================
# File I/O
# ============================================================================


def load_release(version: str) -> dict | None:
    """Load release JSON file."""
    path = RELEASES_DIR / f"{version}.json"
    if not path.exists():
        return None
    with open(path) as f:
        return json.load(f)


def save_release(version: str, data: dict) -> None:
    """Save release JSON file."""
    path = RELEASES_DIR / f"{version}.json"
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    log(f"  Saved to {path}")


# ============================================================================
# Main enrichment functions
# ============================================================================


def enrich_changes(
    version: str,
    kind: str | None = None,
    provider: ProviderType | None = None,
    model_id: str | None = None,
    max_changes: int | None = None,
    only_with_issues: bool = False,
    skip_enriched: bool = True,
    include_patches: bool = True,
    concurrency: int = 1,
) -> dict[str, list[dict]]:
    """
    Enrich changes for a version with LLM-generated context.

    Args:
        version: K8s version (e.g., "1.35")
        kind: Specific change kind to enrich (e.g., "bugOrRegression"), or None for all
        provider: Model provider override (uses config file if not specified)
        model_id: Optional specific model ID override
        max_changes: Optional limit on changes to process (for testing)
        only_with_issues: Only enrich changes that have linked issues
        skip_enriched: Skip changes that already have enrichment data
        include_patches: Enrich patch release changes (default: True)
        concurrency: Number of concurrent requests (default: 1 = sequential)

    Returns:
        Dict of enriched changesByKind
    """
    import concurrent.futures
    import threading

    config = load_config()
    provider_name, provider_config = get_provider_config(config, provider)
    effective_model_id = get_effective_model_id(provider_config, model_id)

    log(f"\n[ENRICH] Enriching changes for Kubernetes {version}")
    log(f"  Provider: {provider_name}, Model: {effective_model_id}")
    if concurrency > 1:
        log(f"  Concurrency: {concurrency}")

    # Load release data
    release = load_release(version)
    if not release:
        log(f"  [ERROR] Release {version} not found")
        return {}

    changes_by_kind = release.get("changesByKind", {})
    if not changes_by_kind:
        log("  [ERROR] No changesByKind in release")
        return {}

    # Filter to specific kind if requested
    kinds_to_process = [kind] if kind else ENRICHABLE_KINDS
    kinds_to_process = [k for k in kinds_to_process if k in changes_by_kind]

    log(f"  Processing kinds: {kinds_to_process}")

    # Collect all changes to process (main release + patches)
    to_process: list[tuple[str, int, dict, str | None]] = []  # (kind, idx, change, patch_version)

    for change_kind in kinds_to_process:
        for idx, change in enumerate(changes_by_kind[change_kind]):
            if skip_enriched and change.get("enrichment"):
                continue
            if only_with_issues and not change.get("issueContext"):
                continue
            to_process.append((change_kind, idx, change, None))

    # Add patch release changes
    if include_patches and release.get("patchReleases"):
        for patch in release["patchReleases"]:
            patch_version = patch.get("version", "unknown")
            patch_changes = patch.get("changesByKind", {})
            for change_kind in kinds_to_process:
                if change_kind not in patch_changes:
                    continue
                for idx, change in enumerate(patch_changes[change_kind]):
                    if skip_enriched and change.get("enrichment"):
                        continue
                    to_process.append((change_kind, idx, change, patch_version))

    if max_changes:
        to_process = to_process[:max_changes]

    log(f"  Total changes to process: {len(to_process)}")

    if not to_process:
        log("  Nothing to process!")
        return changes_by_kind

    # Initialize tracking
    tracker = UsageTracker(effective_model_id)
    lock = threading.Lock()
    processed_count = 0
    enriched_count = 0
    error_count = 0

    def process_change(item: tuple[str, int, dict, str | None]) -> tuple[str, int, dict | None, tuple[int, int], str | None]:
        """Process a single change (thread-safe)."""
        change_kind, idx, change, patch_version = item

        # Create agent per thread (not thread-safe to share)
        enrichment, usage = enrich_single_change(
            change, provider_name, provider_config, model_id  # type: ignore
        )

        if enrichment:
            result = {
                "problem": enrichment.problem,
                "affected": enrichment.affected,
                "fix": enrichment.fix,
                "impact": enrichment.impact,
                "category": enrichment.category,
                "severity": enrichment.severity,
                "affectedComponents": enrichment.affected_components,
                "labels": enrichment.labels,
            }
            return change_kind, idx, result, usage, patch_version
        return change_kind, idx, None, usage, patch_version

    # Process with thread pool
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = {executor.submit(process_change, item): item for item in to_process}

        for future in concurrent.futures.as_completed(futures):
            item = futures[future]
            change_kind, idx, change, patch_version = item

            try:
                result_kind, result_idx, result_data, (in_tokens, out_tokens), result_patch = future.result()

                with lock:
                    processed_count += 1
                    tracker.add(in_tokens, out_tokens)

                    pr_num = change.get("prNumber", "?")

                    if result_data:
                        # Update the change in place
                        if result_patch:
                            # Find the patch and update
                            for patch in release["patchReleases"]:
                                if patch.get("version") == result_patch:
                                    patch["changesByKind"][result_kind][result_idx]["enrichment"] = result_data
                                    break
                        else:
                            changes_by_kind[result_kind][result_idx]["enrichment"] = result_data

                        enriched_count += 1
                        patch_info = f" [{result_patch}]" if result_patch else ""
                        log(f"  [{processed_count}/{len(to_process)}] PR #{pr_num}{patch_info}: {result_data['category']} / {result_data['severity']}{tracker.format_call(in_tokens, out_tokens)}")
                    else:
                        error_count += 1
                        log(f"  [{processed_count}/{len(to_process)}] PR #{pr_num}: [FAIL]")

                    # Save checkpoint every 20 changes
                    if enriched_count > 0 and enriched_count % 20 == 0:
                        save_release(version, release)
                        log(f"    [CHECKPOINT] Saved {enriched_count} enriched changes")

            except Exception as e:
                with lock:
                    processed_count += 1
                    error_count += 1
                    log(f"  [{processed_count}/{len(to_process)}] [ERROR] {e}")

    log(f"\n[DONE] Processed: {processed_count}, Enriched: {enriched_count}, Errors: {error_count}")

    # Final save
    if enriched_count > 0:
        save_release(version, release)

    # Log total usage
    if tracker.total_input or tracker.total_output:
        log(f"\n[USAGE] {tracker.format_total()}")

    return changes_by_kind


def enrich_changes_batch(
    version: str,
    kind: str | None = None,
    provider: ProviderType | None = None,
    model_id: str | None = None,
    batch_size: int = 5,
    only_with_issues: bool = False,
) -> dict[str, list[dict]]:
    """
    Enrich changes in batches, saving after each batch to preserve progress.
    """
    config = load_config()
    provider_name, provider_config = get_provider_config(config, provider)
    effective_model_id = get_effective_model_id(provider_config, model_id)

    log(f"\n[ENRICH BATCH] Enriching changes for Kubernetes {version}")
    log(f"  Provider: {provider_name}, Model: {effective_model_id}, Batch size: {batch_size}")

    release = load_release(version)
    if not release:
        log(f"  [ERROR] Release {version} not found")
        return {}

    changes_by_kind = release.get("changesByKind", {})
    kinds_to_process = [kind] if kind else ENRICHABLE_KINDS
    kinds_to_process = [k for k in kinds_to_process if k in changes_by_kind]

    # Collect all changes to process
    to_process: list[tuple[str, int, dict]] = []
    for change_kind in kinds_to_process:
        for idx, change in enumerate(changes_by_kind[change_kind]):
            if change.get("enrichment"):
                continue
            if only_with_issues and not change.get("issueContext"):
                continue
            to_process.append((change_kind, idx, change))

    log(f"  Found {len(to_process)} changes to enrich")

    if not to_process:
        return changes_by_kind

    tracker = UsageTracker(effective_model_id)
    total_enriched = 0
    batch_num = 0

    for i in range(0, len(to_process), batch_size):
        batch = to_process[i:i + batch_size]
        batch_num += 1
        log(f"\n  [Batch {batch_num}] Processing {len(batch)} changes...")

        for change_kind, idx, change in batch:
            pr_num = change.get("prNumber", "?")
            log(f"    PR #{pr_num}...")

            enrichment, (in_tokens, out_tokens) = enrich_single_change(
                change, provider_name, provider_config, model_id  # type: ignore
            )
            tracker.add(in_tokens, out_tokens)

            if enrichment:
                changes_by_kind[change_kind][idx]["enrichment"] = {
                    "problem": enrichment.problem,
                    "affected": enrichment.affected,
                    "fix": enrichment.fix,
                    "impact": enrichment.impact,
                    "category": enrichment.category,
                    "severity": enrichment.severity,
                    "affectedComponents": enrichment.affected_components,
                    "labels": enrichment.labels,
                }
                total_enriched += 1
                log(f"      [OK]{tracker.format_call(in_tokens, out_tokens)}")
            else:
                log("      [FAIL]")

        save_release(version, release)
        log(f"  [Batch {batch_num}] Saved progress ({total_enriched} total enriched)")

    log(f"\n[DONE] Total enriched: {total_enriched}/{len(to_process)}")

    if tracker.total_input or tracker.total_output:
        log(f"\n[USAGE] {tracker.format_total()}")

    return changes_by_kind
