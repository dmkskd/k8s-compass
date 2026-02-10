"""
Link new fields to their associated KEPs using heuristic matching.

This module attempts to automatically connect fields introduced in a K8s version
to the KEPs (Kubernetes Enhancement Proposals) that introduced them.

## Overview

When a new field appears in the K8s API (detected via version diffs), we try to
find which KEP introduced it by comparing field metadata against KEP metadata
from the release notes.

## Matching Strategies (in priority order)

Each strategy assigns a confidence score (0.0-1.0). The highest-scoring match
above 0.3 threshold wins.

### Strategy 1: Feature Gate Matching (0.95 confidence)
Extract feature gate names from field descriptions (e.g., "requires enabling
the DynamicResourceAllocation feature gate") and match against KEP's featureGate.
This is the strongest signal when available.

### Strategy 2: Affected Fields List (0.99 confidence)
If the field path is explicitly listed in the KEP's affectedFields array
(manually curated in release data), it's a near-certain match.

### Strategy 3: Kind Mention in Description (0.85-0.95 confidence)
If the field's description mentions Kinds from the KEP's affectedKinds list,
it's a strong signal. Extra boost (+0.05) if both mention scheduling-related
terms (helps disambiguate scheduling KEPs).

### Strategy 4: Kind Overlap + Text Similarity (0.3-0.8 confidence)
If the field is on a Kind listed in KEP's affectedKinds, add 0.3 base score
plus up to 0.5 based on Jaccard text similarity between field text and KEP text.

### Strategy 5: Strong Text Match (0.28-0.7 confidence)
Pure text similarity between field name/description and KEP title/description.
Only used if similarity > 0.4 (to avoid noise).

### Strategy 6: Field Name Token Match (0.3-0.8 confidence)
If the field name contains significant tokens from the KEP title (e.g.,
"workloadRef" contains "workload" from "Gang Scheduling via Workload API").
Boosted to 0.8 if field description also mentions KEP's affected kinds.
Reduced to 0.3 if field mentions scheduling but KEP doesn't (likely wrong KEP).

### Strategy 7: Description Key Terms (0.5-0.9 confidence)
Count how many significant terms from KEP title/description appear in field
description. Also checks for key phrase matches like "scheduling"/"scheduler",
"pod group"/"podgroup", etc.

## Canonical vs Inherited Fields

Fields can appear on multiple Kinds due to PodSpec embedding. For example,
`spec.workloadRef` on Pod is canonical, but `spec.template.spec.workloadRef`
on Deployment is inherited (same field, embedded via PodTemplateSpec).

The `is_canonical` flag tracks this:
- Pod fields: always canonical
- Deployment/DaemonSet/StatefulSet/Job/CronJob/ReplicaSet fields under
  `spec.template.spec.*`: NOT canonical (inherited from Pod)
- CronJob fields under `spec.jobTemplate.spec.template.spec.*`: NOT canonical

## Limitations

- Only matches against KEPs in the same release's feature list
- Feature gate extraction from descriptions is regex-based and may miss variants
- Text similarity can produce false positives for generic terms
- No negative signals (e.g., field mentions different feature gate than KEP)

## Usage

```python
from k8s.transform.kep_field_linker import link_all_versions

results = link_all_versions()  # Links fields for all versions with diffs
# Results written to packages/web/public/data/k8s/field-kep-links/{version}.json
```

See also: pipeline.md steering file for pipeline commands.
"""

import json
import re
from dataclasses import dataclass
from dataclasses import field as dataclass_field
from pathlib import Path

from rich.console import Console

from ...core.config import K8S_VERSIONS, OUTPUT_DIR

console = Console()

# Common words to ignore in text matching
STOP_WORDS = {
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "shall", "can", "need", "dare",
    "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
    "into", "through", "during", "before", "after", "above", "below",
    "between", "under", "again", "further", "then", "once", "here",
    "there", "when", "where", "why", "how", "all", "each", "few", "more",
    "most", "other", "some", "such", "no", "nor", "not", "only", "own",
    "same", "so", "than", "too", "very", "just", "and", "but", "if", "or",
    "because", "until", "while", "this", "that", "these", "those", "which",
    "who", "whom", "what", "spec", "status", "metadata", "object", "field",
    "used", "using", "use", "set", "get", "list", "create", "update", "delete",
    "kubernetes", "k8s", "api", "resource", "resources", "pod", "pods",
}


@dataclass
class FieldKepLink:
    """A link between a field and a KEP."""
    field_path: str
    kind: str
    group: str
    kep: str
    kep_title: str
    kep_path: str | None  # Path to KEP in enhancements repo (e.g., "sig-node/1287-in-place-update")
    confidence: float  # 0.0 to 1.0
    match_reason: str
    is_canonical: bool = True  # True if this is the original definition, False if inherited


# Kinds that embed PodSpec (fields in these are inherited from Pod)
PODSPEC_EMBEDDING_KINDS = {
    "Deployment", "DaemonSet", "StatefulSet", "ReplicaSet", "Job", "CronJob",
    "ReplicationController", "PodTemplate",
}


def is_canonical_field(kind: str, group: str, field_path: str) -> bool:
    """
    Determine if a field on a Kind is the canonical (original) definition.

    Fields embedded via PodSpec in Deployment, DaemonSet, etc. are NOT canonical -
    the canonical definition is on Pod itself.

    Returns True if this is the original definition, False if inherited.
    """
    # Pod is always canonical for its own fields
    if kind == "Pod" and group == "core":
        return True

    # PodTemplate is canonical for template-level fields (metadata, spec at template level)
    if kind == "PodTemplate" and group == "core":
        return True

    # Check if this kind embeds PodSpec
    if kind in PODSPEC_EMBEDDING_KINDS:
        # Fields under spec.template.spec are inherited from Pod
        # But spec.template.metadata is part of PodTemplateSpec, not PodSpec
        if field_path.startswith("spec.template.spec."):
            return False
        # Fields under spec.jobTemplate.spec.template.spec (CronJob) are inherited
        if field_path.startswith("spec.jobTemplate.spec.template.spec."):
            return False

    # Default: field is canonical on this kind
    return True


@dataclass
class LinkingResult:
    """Result of linking fields to KEPs for a version."""
    version: str
    links: list[FieldKepLink] = dataclass_field(default_factory=list)
    unlinked_fields: list[dict] = dataclass_field(default_factory=list)


def load_diff(from_version: str, to_version: str) -> dict | None:
    """Load a diff file between two versions."""
    diff_path = OUTPUT_DIR / "diffs" / f"{from_version}-{to_version}.json"
    if not diff_path.exists():
        return None
    return json.loads(diff_path.read_text())


def load_release(version: str) -> dict | None:
    """Load release data for a version."""
    release_path = OUTPUT_DIR / "releases" / f"{version}.json"
    if not release_path.exists():
        return None
    return json.loads(release_path.read_text())


def load_schemas(version: str) -> dict:
    """Load schemas for a version."""
    schema_path = OUTPUT_DIR / "schemas" / f"{version}.json"
    if not schema_path.exists():
        return {}
    data = json.loads(schema_path.read_text())
    return data.get("schemas", {})


def extract_feature_gate(text: str) -> str | None:
    """Extract feature gate name from text (e.g., description)."""
    # Common patterns for feature gates in descriptions
    patterns = [
        r"requires enabling the (\w+) feature gate",
        r"feature gate[:\s]+(\w+)",
        r"(\w+) feature gate",
        r"--feature-gates=(\w+)=true",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(1)
    return None


def tokenize(text: str) -> set[str]:
    """Tokenize text into meaningful words."""
    # Convert camelCase and PascalCase to separate words
    text = re.sub(r'([a-z])([A-Z])', r'\1 \2', text)
    # Split on non-alphanumeric
    words = re.findall(r'[a-zA-Z]+', text.lower())
    # Filter stop words and short words
    return {w for w in words if w not in STOP_WORDS and len(w) > 2}


def compute_text_similarity(text1: str, text2: str) -> float:
    """Compute Jaccard similarity between two texts."""
    tokens1 = tokenize(text1)
    tokens2 = tokenize(text2)
    if not tokens1 or not tokens2:
        return 0.0
    intersection = tokens1 & tokens2
    union = tokens1 | tokens2
    return len(intersection) / len(union)


def get_field_description(schemas: dict, kind: str, group: str, field_path: str) -> str:
    """Get the description for a specific field from schemas."""
    schema_key = f"{group}/{kind}"
    schema = schemas.get(schema_key)
    if not schema:
        return ""

    def find_field(properties: list, path_parts: list[str]) -> str:
        if not path_parts or not properties:
            return ""

        current = path_parts[0]
        # Handle array notation
        current_clean = current.rstrip("[]")

        for prop in properties:
            if prop.get("name") == current_clean:
                if len(path_parts) == 1:
                    return prop.get("description", "")
                # Recurse into nested properties
                nested = prop.get("properties", [])
                if prop.get("items") and prop["items"].get("properties"):
                    nested = prop["items"]["properties"]
                return find_field(nested, path_parts[1:])
        return ""

    path_parts = field_path.split(".")
    return find_field(schema.get("properties", []), path_parts)


def match_field_to_keps(
    field: dict,
    features: list[dict],
    schemas: dict,
) -> FieldKepLink | None:
    """Try to match a field to a KEP using multiple strategies."""
    field_path = field["path"]
    kind = field["kind"]
    group = field["group"]

    # Get field description from schema
    field_desc = get_field_description(schemas, kind, group, field_path)

    best_match: FieldKepLink | None = None
    best_confidence = 0.0

    for feature in features:
        kep = feature.get("kep", "")
        kep_title = feature.get("title", "")
        kep_path = feature.get("kepPath", "")
        kep_desc = feature.get("description", "")
        kep_feature_gate = feature.get("featureGate", "")
        affected_kinds = feature.get("affectedKinds", [])
        affected_fields = feature.get("affectedFields", [])

        confidence = 0.0
        reasons = []

        # Strategy 1: Feature gate matching (highest confidence)
        if field_desc and kep_feature_gate:
            field_gate = extract_feature_gate(field_desc)
            if field_gate and field_gate.lower() == kep_feature_gate.lower():
                confidence = 0.95
                reasons.append(f"feature gate match: {field_gate}")

        # Strategy 2: Already listed in affectedFields (manual curation)
        if field_path in affected_fields:
            confidence = max(confidence, 0.99)
            reasons.append("listed in affectedFields")

        # Strategy 3: Field description mentions KEP's affectedKinds (strong signal)
        # e.g., workloadRef description mentions "Workload" and "PodGroup" -> KEP-4671
        if field_desc and affected_kinds:
            field_desc_lower = field_desc.lower()
            mentioned_kinds = [k for k in affected_kinds if k.lower() in field_desc_lower]
            if mentioned_kinds:
                # Strong signal: field description explicitly mentions the KEP's target kinds
                kind_mention_confidence = 0.85 + (0.05 * min(len(mentioned_kinds), 2))

                # Extra boost if description also mentions scheduling-related terms
                # and KEP is about scheduling (e.g., Gang Scheduling)
                if "schedul" in field_desc_lower and "schedul" in (kep_title.lower() + kep_desc.lower()):
                    kind_mention_confidence = min(0.95, kind_mention_confidence + 0.05)

                if kind_mention_confidence > confidence:
                    confidence = kind_mention_confidence
                    reasons.append(f"field description mentions KEP kinds: {', '.join(mentioned_kinds)}")

        # Strategy 4: Kind overlap + text similarity
        if kind in affected_kinds:
            # Field is on a Kind that this KEP affects
            kind_bonus = 0.3

            # Check text similarity between field name/desc and KEP title/desc
            field_text = f"{field_path} {field_desc}"
            kep_text = f"{kep_title} {kep_desc}"
            text_sim = compute_text_similarity(field_text, kep_text)

            combined = kind_bonus + (text_sim * 0.5)
            if combined > confidence:
                confidence = combined
                reasons.append(f"kind overlap ({kind}) + text similarity ({text_sim:.2f})")

        # Strategy 5: Strong text match even without kind overlap
        field_text = f"{field_path} {field_desc}"
        kep_text = f"{kep_title} {kep_desc}"
        text_sim = compute_text_similarity(field_text, kep_text)

        if text_sim > 0.4 and text_sim * 0.7 > confidence:
            confidence = text_sim * 0.7
            reasons.append(f"strong text match ({text_sim:.2f})")

        # Strategy 6: Field name contains key KEP terms
        # But only if field description doesn't contradict by mentioning other KEP's kinds
        field_name = field_path.split(".")[-1].lower()
        kep_tokens = tokenize(kep_title)

        for token in kep_tokens:
            if len(token) > 4 and token in field_name:
                # Check if field description mentions this KEP's concepts
                # to avoid false positives like "workloadRef" -> "Workload Identity"
                # when description actually talks about "PodGroup" and "scheduling"

                # Default confidence for token match
                token_confidence = 0.5

                # Boost if KEP's affected kinds are mentioned in field description
                if field_desc and affected_kinds:
                    field_desc_lower = field_desc.lower()
                    if any(k.lower() in field_desc_lower for k in affected_kinds):
                        token_confidence = 0.8
                    # Reduce confidence if field description mentions scheduling/scheduler
                    # but KEP is not about scheduling
                    elif "schedul" in field_desc_lower and "schedul" not in kep_title.lower() + kep_desc.lower():
                        token_confidence = 0.3  # Likely wrong KEP

                if token_confidence > confidence:
                    confidence = token_confidence
                    reasons.append(f"field name contains '{token}' from KEP title")

        # Strategy 7: Check if field description mentions KEP-related terms
        if field_desc:
            field_desc_lower = field_desc.lower()
            kep_title_lower = kep_title.lower()
            kep_desc_lower = kep_desc.lower()

            # Look for strong semantic connections
            kep_key_terms = [t for t in tokenize(f"{kep_title} {kep_desc}") if len(t) > 4]
            matches = sum(1 for t in kep_key_terms if t in field_desc_lower)

            if kep_key_terms and matches >= 2:
                match_ratio = matches / len(kep_key_terms)
                if match_ratio > 0.3:
                    desc_confidence = 0.5 + (match_ratio * 0.4)  # 0.5 to 0.9
                    if desc_confidence > confidence:
                        confidence = desc_confidence
                        reasons.append(f"field description matches KEP terms ({matches}/{len(kep_key_terms)})")

            # Check for key phrase matches
            # e.g., "group scheduling" in field desc -> "Gang Scheduling" KEP
            # e.g., "pod groups" in field desc -> "pod groups" in KEP desc
            key_phrases = [
                ("scheduling", "schedul"),  # scheduling, scheduler
                ("pod group", "podgroup"),
                ("workload api", "workload"),
                ("certificate", "cert"),
                ("identity", "ident"),
            ]

            for kep_phrase, field_phrase in key_phrases:
                if kep_phrase in kep_desc_lower or kep_phrase in kep_title_lower:
                    if field_phrase in field_desc_lower:
                        phrase_confidence = 0.82
                        if phrase_confidence > confidence:
                            confidence = phrase_confidence
                            reasons.append(f"field mentions '{field_phrase}', KEP about '{kep_phrase}'")

        # Update best match if this is better
        if confidence > best_confidence and confidence >= 0.3:
            best_confidence = confidence
            best_match = FieldKepLink(
                field_path=field_path,
                kind=kind,
                group=group,
                kep=kep,
                kep_title=kep_title,
                kep_path=kep_path or None,
                confidence=confidence,
                match_reason="; ".join(reasons),
                is_canonical=is_canonical_field(kind, group, field_path),
            )

    return best_match


def link_fields_to_keps(version: str) -> LinkingResult:
    """Link all new fields in a version to their KEPs."""
    result = LinkingResult(version=version)

    # Find the previous version
    sorted_versions = sorted(K8S_VERSIONS, key=lambda v: [int(x) for x in v.split(".")])
    version_idx = sorted_versions.index(version) if version in sorted_versions else -1

    if version_idx <= 0:
        console.print(f"[yellow]Cannot link fields for {version} - no previous version[/yellow]")
        return result

    prev_version = sorted_versions[version_idx - 1]

    # Load data
    diff = load_diff(prev_version, version)
    release = load_release(version)
    schemas = load_schemas(version)

    if not diff:
        console.print(f"[yellow]No diff found for {prev_version} → {version}[/yellow]")
        return result

    if not release:
        console.print(f"[yellow]No release data found for {version}[/yellow]")
        return result

    features = release.get("features", [])
    fields_added = diff.get("fieldsAdded", [])

    console.print(f"\n[bold]Linking {len(fields_added)} new fields to {len(features)} KEPs in {version}[/bold]")

    for field in fields_added:
        link = match_field_to_keps(field, features, schemas)
        if link:
            result.links.append(link)
        else:
            result.unlinked_fields.append(field)

    return result


def write_field_kep_links(result: LinkingResult) -> Path:
    """Write field-KEP links to JSON."""
    output_dir = OUTPUT_DIR / "field-kep-links"
    output_dir.mkdir(parents=True, exist_ok=True)

    output_path = output_dir / f"{result.version}.json"

    data = {
        "version": result.version,
        "summary": {
            "totalFieldsAdded": len(result.links) + len(result.unlinked_fields),
            "linkedFields": len(result.links),
            "unlinkedFields": len(result.unlinked_fields),
            "canonicalFields": sum(1 for link in result.links if link.is_canonical),
        },
        "links": [
            {
                "fieldPath": link.field_path,
                "kind": link.kind,
                "group": link.group,
                "kep": link.kep,
                "kepTitle": link.kep_title,
                "kepPath": link.kep_path,
                "confidence": round(link.confidence, 2),
                "matchReason": link.match_reason,
                "isCanonical": link.is_canonical,
            }
            for link in sorted(result.links, key=lambda x: (-x.confidence, x.field_path))
        ],
        "unlinkedFields": [
            {
                "fieldPath": f["path"],
                "kind": f["kind"],
                "group": f["group"],
            }
            for f in result.unlinked_fields
        ],
    }

    output_path.write_text(json.dumps(data, indent=2))
    return output_path


def link_all_versions() -> dict[str, LinkingResult]:
    """Link fields to KEPs for all versions."""
    results = {}
    sorted_versions = sorted(K8S_VERSIONS, key=lambda v: [int(x) for x in v.split(".")])

    for version in sorted_versions[1:]:  # Skip first version (no diff)
        result = link_fields_to_keps(version)
        results[version] = result

        if result.links:
            write_field_kep_links(result)
            linked_pct = len(result.links) / (len(result.links) + len(result.unlinked_fields)) * 100
            console.print(
                f"  [green]✓[/green] {version}: {len(result.links)} linked, "
                f"{len(result.unlinked_fields)} unlinked ({linked_pct:.0f}% coverage)"
            )

    return results


def enrich_features_with_fields(version: str, result: LinkingResult) -> dict | None:
    """Enrich release features with linked fields (updates affectedFields)."""
    release = load_release(version)
    if not release:
        return None

    features = release.get("features", [])

    # Group links by KEP
    links_by_kep: dict[str, list[FieldKepLink]] = {}
    for link in result.links:
        if link.kep not in links_by_kep:
            links_by_kep[link.kep] = []
        links_by_kep[link.kep].append(link)

    # Update features with linked fields
    for feature in features:
        kep = feature.get("kep", "")
        if kep in links_by_kep:
            existing_fields = set(feature.get("affectedFields", []))
            new_fields = {link.field_path for link in links_by_kep[kep]}

            # Merge, keeping existing and adding new
            all_fields = sorted(existing_fields | new_fields)
            feature["affectedFields"] = all_fields

            # Also update affectedKinds
            existing_kinds = set(feature.get("affectedKinds", []))
            new_kinds = {link.kind for link in links_by_kep[kep]}
            feature["affectedKinds"] = sorted(existing_kinds | new_kinds)

    return release
