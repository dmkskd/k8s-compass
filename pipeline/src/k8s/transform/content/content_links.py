"""
Content links for Kubernetes releases, KEPs, and Kinds.

This module manages curated external content (blog posts, documentation, videos, etc.)
that can be linked to:
- Releases (e.g., official release announcement)
- KEPs (e.g., feature deep-dive blog post)
- Kinds (e.g., Pod documentation, tutorials)
- Fields (e.g., spec.resources.limits documentation)

Content is stored in a curated JSON file and exported to Parquet for the UI.

## Data Structure

```json
{
  "content": [
    {
      "url": "https://kubernetes.io/blog/2025/12/17/kubernetes-v1-35-release/",
      "title": "Kubernetes v1.35: Timbernetes",
      "type": "blog",
      "source": "kubernetes.io",
      "isOfficial": true,
      "publishedDate": "2025-12-17",
      "author": "Release Team",

      // Content analysis (can be LLM-extracted or manual)
      "summary": "Official release announcement for Kubernetes 1.35",
      "description": "This release brings 58 enhancements including DRA going GA, in-place pod resize improvements, and new scheduling features. Key highlights include...",
      "labels": ["release", "dra", "scheduling", "security", "1.35"],

      "links": [
        {"targetType": "release", "targetId": "1.35"}
      ]
    },
    {
      "url": "https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/",
      "title": "Resource Management for Pods and Containers",
      "type": "documentation",
      "source": "kubernetes.io",
      "isOfficial": true,
      "summary": "How to specify CPU and memory resources for containers",
      "description": "Covers resource requests, limits, QoS classes, and how the scheduler uses resource information. Explains the difference between requests and limits...",
      "labels": ["resources", "cpu", "memory", "qos", "scheduling", "limits", "requests"],
      "links": [
        {"targetType": "kind", "targetId": "Pod", "targetGroup": "core"},
        {"targetType": "field", "targetId": "spec.containers[].resources", "targetGroup": "Pod@core"}
      ]
    }
  ]
}
```

## Content Fields

### Core Fields
- url: Content URL (required)
- title: Content title (required)
- type: Content type (required) - blog, documentation, video, tutorial, announcement, reference, deep-dive
- source: Domain or platform (required) - kubernetes.io, medium.com, youtube.com
- isOfficial: True if from official K8s sources

### Metadata Fields
- publishedDate: ISO date when published
- author: Author name

### Content Analysis Fields (for LLM extraction or manual curation)
- summary: 1-liner description of what the content covers
- description: 2-3 sentence deeper explanation of key points
- labels: Array of topic labels for cross-referencing (e.g., ["dra", "scheduling", "pod"])

### Link Fields
- links: Array of link targets (release, kep, kind, field)

## Content Types

- blog: Blog posts (kubernetes.io, medium, dev.to, etc.)
- documentation: Official docs (kubernetes.io/docs)
- video: YouTube, conference talks
- tutorial: Step-by-step guides
- announcement: Release announcements, deprecation notices
- reference: API reference, spec documents

## Link Target Types

- release: Links to a K8s version (e.g., "1.35")
- kep: Links to a KEP (e.g., "KEP-4017")
- kind: Links to a Kind (e.g., "Pod" in group "core")
- field: Links to a specific field (e.g., "spec.containers[].resources" on Pod)

## Labels

Labels are lowercase topic identifiers for cross-referencing content. Examples:
- Feature areas: dra, scheduling, networking, storage, security, autoscaling
- Resource types: pod, deployment, service, configmap, secret
- Concepts: qos, limits, requests, affinity, tolerations
- Release versions: 1.35, 1.34

Labels enable queries like "show all content about DRA" or "find tutorials about scheduling".

## Usage

```python
from k8s.transform.content_links import (
    load_content,
    add_content,
    get_content_for_release,
    get_content_for_kep,
    get_content_for_kind,
    get_content_for_field,
    get_content_by_label,
)

# Get content by label
dra_content = get_content_by_label("dra")
scheduling_tutorials = get_content_by_label("scheduling", content_type="tutorial")
```
"""

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from ...core.config import CURATED_CONTENT_DIR

# Content data file location
CONTENT_DIR = CURATED_CONTENT_DIR
CONTENT_FILE = CONTENT_DIR / "content_links.json"

# Content types
ContentType = Literal["blog", "documentation", "video", "tutorial", "announcement", "reference", "scheduled"]

# Link target types
TargetType = Literal["release", "kep", "kind", "field"]


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def get_all_content_files() -> list[Path]:
    """
    Get all content_links*.json files in the curated/content directory.

    Files are loaded in this order:
    1. content_links.json (base file)
    2. content_links_*.json (additional files, sorted alphabetically)

    Returns:
        List of Path objects for content files
    """
    files = []

    # Base file first
    if CONTENT_FILE.exists():
        files.append(CONTENT_FILE)

    # Additional files (content_links_*.json)
    for f in sorted(CONTENT_DIR.glob("content_links_*.json")):
        files.append(f)

    return files

    return files


def load_content(file_path: Path | None = None) -> dict[str, Any]:
    """
    Load content from a specific file or the base content_links.json.

    Args:
        file_path: Specific file to load, or None for base file

    Returns:
        Content data dict
    """
    target = file_path or CONTENT_FILE
    if not target.exists():
        return {"content": []}

    with open(target) as f:
        return json.load(f)


def load_all_content() -> dict[str, Any]:
    """
    Load and merge content from all content_links*.json files.

    Returns:
        Merged content data with all items from all files
    """
    all_content: list[dict[str, Any]] = []
    seen_urls: set[str] = set()

    for file_path in get_all_content_files():
        try:
            data = load_content(file_path)
            for item in data.get("content", []):
                url = item.get("url")
                if url and url not in seen_urls:
                    all_content.append(item)
                    seen_urls.add(url)
        except Exception as e:
            log(f"  [WARN] Failed to load {file_path}: {e}")

    return {"content": all_content}


def save_content(data: dict[str, Any], file_path: Path | None = None) -> None:
    """
    Save content to a specific file or the base content_links.json.

    Args:
        data: Content data to save
        file_path: Specific file to save to, or None for base file
    """
    target = file_path or CONTENT_FILE
    CONTENT_DIR.mkdir(parents=True, exist_ok=True)
    with open(target, "w") as f:
        json.dump(data, f, indent=2)
    log(f"  [OK] Saved content to {target}")


def get_content_file_for_conference(conference_id: str) -> Path:
    """
    Get the content file path for a specific conference.

    Args:
        conference_id: Conference identifier (e.g., "kubecon-na-2024")

    Returns:
        Path to the conference-specific content file
    """
    # Convert conference ID to filename-safe format
    safe_name = conference_id.replace("-", "_")
    return CONTENT_DIR / f"content_links_{safe_name}.json"


def list_content_files() -> None:
    """Print all content files and their item counts."""
    files = get_all_content_files()

    if not files:
        log("No content files found")
        return

    log(f"\n=== Content Files ({len(files)} files) ===\n")

    total = 0
    for f in files:
        data = load_content(f)
        count = len(data.get("content", []))
        total += count
        log(f"  {f.name}: {count} items")

    log(f"\n  Total: {total} items")


def split_content_by_conference() -> dict[str, int]:
    """
    Split the base content_links.json into separate files by conference.

    Moves conference content (items with kubecon-* labels) to separate files,
    keeping non-conference content in the base file.

    Returns:
        Dict mapping conference_id to number of items moved
    """
    data = load_content()

    # Separate content by conference
    base_content: list[dict[str, Any]] = []
    conference_content: dict[str, list[dict[str, Any]]] = {}

    for item in data.get("content", []):
        labels = [lbl.lower() for lbl in item.get("labels", [])]

        # Find conference label
        conf_label = None
        for label in labels:
            if label.startswith("kubecon-"):
                conf_label = label
                break

        if conf_label:
            conference_content.setdefault(conf_label, []).append(item)
        else:
            base_content.append(item)

    # Save base content
    save_content({"content": base_content})

    # Save conference-specific content
    results = {}
    for conf_id, items in conference_content.items():
        file_path = get_content_file_for_conference(conf_id)
        save_content({"content": items}, file_path)
        results[conf_id] = len(items)
        log(f"  [OK] Moved {len(items)} items to {file_path.name}")

    return results


@dataclass
class ContentLink:
    """A link from content to a target (release, KEP, kind, field)."""

    target_type: TargetType
    target_id: str  # version, KEP ID, Kind name, or field path
    target_group: str | None = None  # For kind/field links
    target_version: str | None = None  # K8s version context (for KEP/kind links)


@dataclass
class Content:
    """External content (blog post, documentation, video, etc.)."""

    url: str
    title: str
    content_type: ContentType
    source: str  # Domain or platform (kubernetes.io, medium.com, youtube.com)
    is_official: bool = False  # True if from official K8s sources
    published_date: str | None = None
    author: str | None = None
    # Content analysis fields
    summary: str | None = None  # 1-liner description
    description: str | None = None  # 2-3 sentence deeper explanation
    labels: list[str] = field(default_factory=list)  # Topic labels for cross-referencing
    links: list[ContentLink] = field(default_factory=list)


def add_content(
    url: str,
    title: str,
    content_type: ContentType,
    source: str,
    links: list[dict[str, Any]],
    is_official: bool = False,
    published_date: str | None = None,
    author: str | None = None,
    summary: str | None = None,
    description: str | None = None,
    labels: list[str] | None = None,
) -> None:
    """Add content with links to targets."""
    data = load_content()

    # Check for duplicate URL
    existing_urls = {c["url"] for c in data.get("content", [])}
    if url in existing_urls:
        log(f"  [SKIP] Content already exists: {url}")
        return

    content_entry = {
        "url": url,
        "title": title,
        "type": content_type,
        "source": source,
        "isOfficial": is_official,
        "links": links,
    }

    if published_date:
        content_entry["publishedDate"] = published_date
    if author:
        content_entry["author"] = author
    if summary:
        content_entry["summary"] = summary
    if description:
        content_entry["description"] = description
    if labels:
        content_entry["labels"] = labels

    data.setdefault("content", []).append(content_entry)
    save_content(data)
    log(f"  [OK] Added content: {title}")


def get_content_for_release(version: str) -> list[dict[str, Any]]:
    """Get all content linked to a release."""
    data = load_content()
    results = []

    for content in data.get("content", []):
        for link in content.get("links", []):
            if link.get("targetType") == "release" and link.get("targetId") == version:
                results.append(content)
                break

    return results


def get_content_for_kep(kep: str) -> list[dict[str, Any]]:
    """Get all content linked to a KEP."""
    data = load_content()
    results = []

    for content in data.get("content", []):
        for link in content.get("links", []):
            if link.get("targetType") == "kep" and link.get("targetId") == kep:
                results.append(content)
                break

    return results


def get_content_for_kind(kind: str, group: str | None = None) -> list[dict[str, Any]]:
    """Get all content linked to a Kind."""
    data = load_content()
    results = []

    for content in data.get("content", []):
        for link in content.get("links", []):
            if link.get("targetType") == "kind" and link.get("targetId") == kind:
                if group is None or link.get("targetGroup") == group:
                    results.append(content)
                    break

    return results


def get_content_for_field(field_path: str, kind: str | None = None, group: str | None = None) -> list[dict[str, Any]]:
    """
    Get all content linked to a field path.

    Args:
        field_path: Field path like "spec.resources.limits.cpu" or "spec.containers[].resources"
        kind: Optional Kind name to filter by (e.g., "Pod")
        group: Optional API group to filter by (e.g., "core")

    Returns:
        List of content items linked to this field

    Example:
        # Get content for resources.limits on any Kind
        get_content_for_field("spec.resources.limits")

        # Get content for resources.limits specifically on Pod
        get_content_for_field("spec.resources.limits", kind="Pod", group="core")
    """
    data = load_content()
    results = []

    for content in data.get("content", []):
        for link in content.get("links", []):
            if link.get("targetType") != "field":
                continue

            link_field = link.get("targetId", "")

            # Check if field path matches (exact or prefix match)
            # e.g., "spec.resources" matches "spec.resources.limits.cpu"
            if link_field == field_path or field_path.startswith(link_field + ".") or link_field.startswith(field_path + "."):
                # Filter by kind if specified
                if kind and link.get("targetGroup"):
                    # Link has kind info - check it matches
                    # targetGroup for fields is "Kind@group" format
                    link_kind_info = link.get("targetGroup", "")
                    if "@" in link_kind_info:
                        link_kind, link_group = link_kind_info.split("@", 1)
                    else:
                        link_kind, link_group = link_kind_info, None

                    if link_kind != kind:
                        continue
                    if group and link_group and link_group != group:
                        continue

                results.append(content)
                break

    return results


def get_official_content_for_release(version: str) -> dict[str, Any] | None:
    """Get the official release announcement for a version."""
    content = get_content_for_release(version)
    for c in content:
        if c.get("isOfficial") and c.get("type") in ("blog", "announcement"):
            return c
    return None


def get_content_by_label(label: str, content_type: ContentType | None = None) -> list[dict[str, Any]]:
    """
    Get all content with a specific label.

    Args:
        label: Label to search for (case-insensitive)
        content_type: Optional filter by content type

    Returns:
        List of content items with the label

    Example:
        # Get all DRA-related content
        get_content_by_label("dra")

        # Get only tutorials about scheduling
        get_content_by_label("scheduling", content_type="tutorial")
    """
    data = load_content()
    results = []
    label_lower = label.lower()

    for content in data.get("content", []):
        # Filter by content type if specified
        if content_type and content.get("type") != content_type:
            continue

        # Check labels (case-insensitive)
        content_labels = [lbl.lower() for lbl in content.get("labels", [])]
        if label_lower in content_labels:
            results.append(content)

    return results


def get_all_labels() -> list[str]:
    """Get all unique labels across all content."""
    data = load_content()
    labels = set()

    for content in data.get("content", []):
        for label in content.get("labels", []):
            labels.add(label.lower())

    return sorted(labels)


def list_all_content() -> None:
    """Print all content for debugging."""
    data = load_content()

    log(f"\n=== Content Links ({len(data.get('content', []))} items) ===")

    for content in data.get("content", []):
        official = "✓" if content.get("isOfficial") else " "
        log(f"\n[{official}] {content['title']}")
        log(f"    Type: {content['type']} | Source: {content['source']}")
        log(f"    URL: {content['url']}")

        links = content.get("links", [])
        if links:
            link_strs = []
            for link in links:
                target = f"{link['targetType']}:{link['targetId']}"
                if link.get("targetGroup"):
                    target += f"@{link['targetGroup']}"
                link_strs.append(target)
            log(f"    Links: {', '.join(link_strs)}")


def flatten_content_for_export() -> list[dict[str, Any]]:
    """
    Flatten content for Parquet export.

    Loads and merges all content_links*.json files, then flattens
    each content item with multiple links into multiple rows.

    Filters out content without videos (type != 'video') from conference files,
    since those are just Sched references without recordings.
    """
    import json as json_module

    data = load_all_content()  # Merge all files
    rows = []

    # Fields that go into the attrs JSON blob (source-specific extras)
    ATTRS_FIELDS = {"schedUrl", "slidesUrl", "duration", "viewCount", "channelId"}

    # Map experience levels to label names
    LEVEL_LABELS = {
        "Beginner": "level-beginner",
        "Intermediate": "level-intermediate",
        "Advanced": "level-advanced",
        "Any": "level-any",
    }

    # Content types to exclude (Sched references without videos)
    EXCLUDED_TYPES = {"reference"}

    for content in data.get("content", []):
        # Skip non-video content from conference imports (Sched references)
        content_type = content.get("type", "")
        if content_type in EXCLUDED_TYPES:
            continue

        # Build attrs from any extra fields or use existing attrs object
        attrs = {}
        
        # First, include any existing attrs object from the JSON
        existing_attrs = content.get("attrs")
        if existing_attrs:
            if isinstance(existing_attrs, dict):
                attrs.update(existing_attrs)
            elif isinstance(existing_attrs, str):
                try:
                    attrs.update(json_module.loads(existing_attrs))
                except json_module.JSONDecodeError:
                    pass
        
        # Then add any extra fields
        for key in ATTRS_FIELDS:
            if content.get(key):
                attrs[key] = content[key]

        # Get labels and add experience level as a label
        labels = list(content.get("labels", []))
        experience_level = content.get("experienceLevel")
        if experience_level and experience_level in LEVEL_LABELS:
            level_label = LEVEL_LABELS[experience_level]
            if level_label not in labels:
                labels.append(level_label)

        base = {
            "url": content["url"],
            "title": content["title"],
            "content_type": content_type,
            "source": content["source"],
            "is_official": content.get("isOfficial", False),
            "published_date": content.get("publishedDate"),
            "author": content.get("author"),
            "summary": content.get("summary"),
            "description": content.get("description"),
            "labels": labels,
            "attrs": json_module.dumps(attrs) if attrs else None,
        }

        links = content.get("links", [])
        if not links:
            # Content with no links - still include it
            rows.append({
                **base,
                "target_type": None,
                "target_id": None,
                "target_group": None,
                "target_version": None,
                "link_confidence": None,
                "link_reason": None,
            })
        else:
            for link in links:
                rows.append({
                    **base,
                    "target_type": link.get("targetType"),
                    "target_id": link.get("targetId"),
                    "target_group": link.get("targetGroup"),
                    "target_version": link.get("targetVersion"),
                    "link_confidence": link.get("confidence"),
                    "link_reason": link.get("reason"),
                })

    return rows
