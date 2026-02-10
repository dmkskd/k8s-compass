"""
One-off KEP metadata extraction using LLM.

This module extracts metadata (summary, labels, affected kinds/fields) from ALL KEPs
in the enhancements repo. Run occasionally to update the central metadata store.

The output is used by:
- Release builds (look up pre-computed metadata instead of re-processing)
- Label taxonomy generation (consistent labels across all KEPs)
- Search/discovery features

Usage:
    uv run k8s-pipeline extract-kep-metadata
    uv run k8s-pipeline extract-kep-metadata --max 10  # Test with 10 KEPs
    uv run k8s-pipeline extract-kep-metadata --model openai.gpt-oss-120b-1:0

Output:
    data/curated/kep_metadata.json
"""

import json
from typing import Any

from pydantic import BaseModel, Field

from ...core.config import CURATED_KEPS_DIR
from .parser import KEPS_DIR, KepMetadata, scan_all_keps
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

OUTPUT_PATH = CURATED_KEPS_DIR / "kep_metadata.json"


class ExtractedKepMetadata(BaseModel):
    """Structured output for KEP metadata extraction."""

    summary: str = Field(
        description="2-3 sentence summary of what this KEP does and why it matters"
    )
    labels: list[str] = Field(
        description="3-6 lowercase topic labels for categorization (e.g., cpu-manager, numa, scheduling, networking, storage)"
    )
    affected_kinds: list[str] = Field(
        default_factory=list,
        description="Kubernetes resource types with NEW or MODIFIED fields (e.g., Pod, Deployment)"
    )
    affected_fields: list[str] = Field(
        default_factory=list,
        description="NEW API fields introduced (e.g., spec.resources.claims)"
    )
    key_concepts: list[str] = Field(
        default_factory=list,
        description="Key technical concepts (e.g., cgroups, NUMA, eBPF, CSI)"
    )


def get_kep_readme(kep_path: str) -> str | None:
    """Read the README.md for a KEP."""
    readme_path = KEPS_DIR / kep_path / "README.md"
    if not readme_path.exists():
        return None

    try:
        content = readme_path.read_text()
        # Truncate very long READMEs
        if len(content) > 15000:
            content = content[:15000] + "\n\n[... truncated ...]"
        return content
    except Exception as e:
        log(f"  [WARN] Failed to read {readme_path}: {e}")
        return None


def create_extraction_prompt(kep: KepMetadata, readme: str) -> str:
    """Create the prompt for extracting KEP metadata."""
    feature_gate = kep.feature_gates[0] if kep.feature_gates else "None"
    return f"""Analyze this Kubernetes Enhancement Proposal (KEP) and extract metadata.

KEP: KEP-{kep.kep_number} - {kep.title}
SIG: {kep.owning_sig}
Feature Gate: {feature_gate}

README.md:
---
{readme}
---

Extract:

1. **summary**: 2-3 sentence summary of what this KEP does and why it matters to Kubernetes users/operators.

2. **labels**: 3-6 lowercase topic labels for categorization and discovery.
   - Be specific: prefer "cpu-manager" over "cpu", "traffic-distribution" over "networking"
   - Include technology terms: numa, cgroups, ebpf, csi, cri, selinux, apparmor
   - Include resource types if central: pod, deployment, service, job, statefulset

   IMPORTANT - Use precise labels for core Kubernetes components:
   - `scheduler` - ONLY for KEPs that directly modify kube-scheduler behavior, scheduling algorithms, or scheduler plugins
   - `pod-placement` - for node selection, affinity, tolerations, topology spread constraints
   - `kubelet` - for kubelet-specific changes (not general node features)
   - `api-server` - ONLY for kube-apiserver specific changes
   - `controller-manager` - ONLY for kube-controller-manager changes

   DO NOT use `scheduler` or `scheduling` for:
   - Kubelet/node resource management (use `node`, `resource-management`, `cgroups` instead)
   - API cleanup or protobuf changes (use `api`, `api-machinery` instead)
   - CLI tools like kubectl (use `cli`, `kubectl` instead)
   - General infrastructure changes that don't directly affect the scheduler

   Other feature areas: autoscaling, storage, networking, security, observability, workloads

3. **affected_kinds**: Kubernetes resource types that have NEW or MODIFIED API fields.
   - Only include Kinds where the API schema changes
   - If this is kubelet/node config only (no API changes), return empty list

4. **affected_fields**: NEW API fields introduced by this KEP.
   - Use exact field paths (e.g., spec.containers[].resources.claims)
   - Only NEW fields, not existing fields that become mutable
   - If no API changes, return empty list

5. **key_concepts**: Key technical concepts/technologies involved.
   - Examples: cgroups, NUMA, eBPF, CSI, CRI, OCI, containerd, runc
   - Include protocols: gRPC, HTTP/2, SPDY
   - Include standards: OCI, CNI, CSI, CRI

Be precise. Only include what is explicitly defined in the README."""


def extract_single_kep(
    kep: KepMetadata,
    readme: str,
    agent,
) -> tuple[ExtractedKepMetadata | None, tuple[int, int]]:
    """Extract metadata from a single KEP."""
    prompt = create_extraction_prompt(kep, readme)

    try:
        result = agent(prompt, structured_output_model=ExtractedKepMetadata)
        usage = get_result_usage(result)
        return result.structured_output, usage
    except Exception as e:
        log(f"  [ERROR] Extraction failed for KEP-{kep.kep_number}: {e}")
        return None, (0, 0)


def load_existing_metadata() -> dict[str, Any]:
    """Load existing metadata file if it exists."""
    if OUTPUT_PATH.exists():
        try:
            with open(OUTPUT_PATH) as f:
                return json.load(f)
        except Exception:
            pass
    return {"version": "1.0", "keps": {}}


def save_metadata(metadata: dict[str, Any]) -> None:
    """Save metadata to JSON file."""
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(metadata, f, indent=2)


def extract_all_keps(
    provider: ProviderType | None = None,
    model_id: str | None = None,
    max_keps: int | None = None,
    skip_existing: bool = True,
    concurrency: int = 5,
) -> dict[str, Any]:
    """
    Extract metadata from all KEPs.

    Args:
        provider: LLM provider override
        model_id: Model ID override
        max_keps: Limit number of KEPs to process (for testing)
        skip_existing: Skip KEPs already in metadata file
        concurrency: Number of concurrent requests (default 5)

    Returns:
        Updated metadata dict
    """
    import concurrent.futures
    import threading

    config = load_config()
    provider_name, provider_config = get_provider_config(config, provider)
    effective_model_id = get_effective_model_id(provider_config, model_id)

    log("\n[EXTRACT] Extracting KEP metadata")
    log(f"  Provider: {provider_name}, Model: {effective_model_id}")
    log(f"  Concurrency: {concurrency}")

    # Load existing metadata
    metadata = load_existing_metadata()
    existing_keps = set(metadata.get("keps", {}).keys())

    # Get all KEPs
    all_keps = scan_all_keps()
    log(f"  Found {len(all_keps)} KEPs in enhancements repo")

    if skip_existing:
        keps_to_process = [k for k in all_keps if f"KEP-{k.kep_number}" not in existing_keps]
        log(f"  Skipping {len(existing_keps)} already processed, {len(keps_to_process)} to process")
    else:
        keps_to_process = all_keps

    if max_keps:
        keps_to_process = keps_to_process[:max_keps]
        log(f"  Limited to {max_keps} KEPs")

    if not keps_to_process:
        log("  Nothing to process!")
        return metadata

    tracker = UsageTracker(effective_model_id)
    success_count = 0
    skip_count = 0
    error_count = 0
    lock = threading.Lock()
    processed_count = 0

    def process_kep(kep: KepMetadata) -> tuple[str, dict | None, tuple[int, int]]:
        """Process a single KEP (thread-safe)."""
        kep_id = f"KEP-{kep.kep_number}"

        readme = get_kep_readme(kep.kep_path)
        if not readme:
            return kep_id, None, (0, 0)

        # Create agent per thread (not thread-safe to share)
        agent = create_agent(
            provider_name,  # type: ignore
            provider_config,
            "You are a Kubernetes expert extracting structured metadata from KEP documents.",
            model_id,
        )

        result, usage = extract_single_kep(kep, readme, agent)

        if result:
            feature_gate = kep.feature_gates[0] if kep.feature_gates else None
            return kep_id, {
                "title": kep.title,
                "sig": kep.owning_sig,
                "kepPath": kep.kep_path,
                "featureGate": feature_gate,
                "summary": result.summary,
                "labels": result.labels,
                "affectedKinds": result.affected_kinds,
                "affectedFields": result.affected_fields,
                "keyConcepts": result.key_concepts,
            }, usage
        return kep_id, None, usage

    # Process with thread pool
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = {executor.submit(process_kep, kep): kep for kep in keps_to_process}

        for future in concurrent.futures.as_completed(futures):
            kep = futures[future]
            kep_id = f"KEP-{kep.kep_number}"

            try:
                result_kep_id, result_data, (in_tokens, out_tokens) = future.result()

                with lock:
                    processed_count += 1
                    tracker.add(in_tokens, out_tokens)

                    if result_data is None and in_tokens == 0:
                        skip_count += 1
                        log(f"  [{processed_count}/{len(keps_to_process)}] {kep_id}: [SKIP] No README")
                    elif result_data:
                        metadata["keps"][result_kep_id] = result_data
                        success_count += 1
                        labels_str = ", ".join(result_data.get("labels", [])[:4])
                        log(f"  [{processed_count}/{len(keps_to_process)}] {kep_id}: {labels_str}")

                        # Save checkpoint every 20 KEPs
                        if success_count % 20 == 0:
                            save_metadata(metadata)
                            log(f"    [CHECKPOINT] Saved {success_count} KEPs")
                    else:
                        error_count += 1
                        log(f"  [{processed_count}/{len(keps_to_process)}] {kep_id}: [FAIL]")

            except Exception as e:
                with lock:
                    processed_count += 1
                    error_count += 1
                    log(f"  [{processed_count}/{len(keps_to_process)}] {kep_id}: [ERROR] {e}")

    # Final save
    metadata["total_keps"] = len(metadata["keps"])
    save_metadata(metadata)

    log(f"\n[DONE] Extracted {success_count}/{len(keps_to_process)} KEPs")
    log(f"       Skipped: {skip_count}, Errors: {error_count}")
    log(f"       Total in metadata: {len(metadata['keps'])} KEPs")

    if tracker.total_input or tracker.total_output:
        log(f"\n[USAGE] {tracker.format_total()}")

    return metadata
