"""
Conference content ingestion for KubeCon and other CNCF events.

This module provides tools to ingest conference talks (videos, presentations)
into the content_links system, enabling discovery of relevant talks by topic.

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CONFERENCE CONTENT PIPELINE                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. DEFINE CONFERENCE                                                        │
│     ├── Conference ID (kubecon-eu-2025, kubecon-na-2024)                    │
│     ├── Dates, location                                                      │
│     └── YouTube playlist ID (for video matching)                            │
│                                                                              │
│  2. ADD TALKS (manual or automated)                                         │
│     ├── Title, speakers, description                                        │
│     ├── Video URL (YouTube)                                                 │
│     ├── Slides URL (optional)                                               │
│     └── Session type (keynote, deep-dive, tutorial, lightning)              │
│                                                                              │
│  3. ENRICH WITH LLM (optional)                                              │
│     ├── Generate summary from description                                   │
│     ├── Extract topic labels                                                │
│     └── Link to KEPs/Kinds mentioned                                        │
│                                                                              │
│  4. OUTPUT → content_links.json                                             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Usage

```python
from k8s.transform.conference_ingest import (
    add_conference_talk,
    CONFERENCES,
)

# Add a talk manually
add_conference_talk(
    conference="kubecon-na-2024",
    title="DRA is GA! Kubernetes WG Device Management",
    speakers=["Kevin Klues", "Patrick Ohly"],
    video_url="https://www.youtube.com/watch?v=...",
    description="Explore the latest advancements in Kubernetes device management...",
    labels=["dra", "gpu", "device-management", "scheduling"],
    kep_links=["KEP-4381"],
)
```

## Conference Labels

Standard labels for conference content:
- Conference: kubecon-eu-2025, kubecon-na-2024, kubecon-eu-2024
- Session type: keynote, deep-dive, tutorial, lightning-talk, bof, workshop
- Topics: dra, scheduling, networking, storage, security, observability, etc.
"""

import json
import re
import sys
from dataclasses import dataclass, field
from typing import Any, Literal

from .content_links import load_content, save_content

# Conference definitions
CONFERENCES: dict[str, dict[str, Any]] = {
    "kubecon-eu-2025": {
        "name": "KubeCon + CloudNativeCon Europe 2025",
        "location": "London, UK",
        "dates": ("2025-04-01", "2025-04-04"),
        "sched_url": "https://kccnceu2025.sched.com",
        "youtube_playlist": None,  # TBD after event
    },
    "kubecon-na-2024": {
        "name": "KubeCon + CloudNativeCon North America 2024",
        "location": "Salt Lake City, Utah",
        "dates": ("2024-11-12", "2024-11-15"),
        "sched_url": "https://kccncna2024.sched.com",
        "youtube_playlist": None,  # CNCF YouTube
    },
    "kubecon-eu-2024": {
        "name": "KubeCon + CloudNativeCon Europe 2024",
        "location": "Paris, France",
        "dates": ("2024-03-19", "2024-03-22"),
        "sched_url": "https://kccnceu2024.sched.com",
        "youtube_playlist": None,
    },
}

# Session types
SessionType = Literal["keynote", "deep-dive", "tutorial", "lightning-talk", "bof", "workshop", "maintainer-track"]


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


@dataclass
class ConferenceTalk:
    """A conference talk/session."""

    conference: str  # Conference ID (kubecon-na-2024)
    title: str
    speakers: list[str]
    video_url: str | None = None
    slides_url: str | None = None
    description: str | None = None
    session_type: SessionType | None = None
    # Content analysis
    summary: str | None = None
    labels: list[str] = field(default_factory=list)
    # Links to K8s concepts
    kep_links: list[str] = field(default_factory=list)  # ["KEP-4381", "KEP-1287"]
    kind_links: list[tuple[str, str]] = field(default_factory=list)  # [("Pod", "core")]
    field_links: list[tuple[str, str, str]] = field(default_factory=list)  # [("spec.resources", "Pod", "core")]


def add_conference_talk(
    conference: str,
    title: str,
    speakers: list[str],
    video_url: str | None = None,
    slides_url: str | None = None,
    description: str | None = None,
    session_type: SessionType | None = None,
    summary: str | None = None,
    labels: list[str] | None = None,
    kep_links: list[str] | None = None,
    kind_links: list[tuple[str, str]] | None = None,
) -> None:
    """
    Add a conference talk to content_links.json.

    Args:
        conference: Conference ID (e.g., "kubecon-na-2024")
        title: Talk title
        speakers: List of speaker names
        video_url: YouTube video URL
        slides_url: Slides URL (optional)
        description: Talk description (from schedule)
        session_type: Type of session (keynote, deep-dive, etc.)
        summary: 1-liner summary (can be LLM-generated)
        labels: Topic labels (e.g., ["dra", "gpu", "scheduling"])
        kep_links: Related KEPs (e.g., ["KEP-4381"])
        kind_links: Related Kinds as (name, group) tuples
    """
    if conference not in CONFERENCES:
        log(f"  [WARN] Unknown conference: {conference}")

    data = load_content()

    # Check for duplicate
    url = video_url or slides_url
    if url:
        existing_urls = {c["url"] for c in data.get("content", [])}
        if url in existing_urls:
            log(f"  [SKIP] Content already exists: {url}")
            return

    # Build labels list
    all_labels = list(labels or [])

    # Add conference label
    if conference not in all_labels:
        all_labels.append(conference)

    # Add session type label
    if session_type and session_type not in all_labels:
        all_labels.append(session_type)

    # Build links
    links: list[dict[str, Any]] = []

    # KEP links
    for kep in (kep_links or []):
        links.append({"targetType": "kep", "targetId": kep})

    # Kind links
    for kind_name, group in (kind_links or []):
        links.append({"targetType": "kind", "targetId": kind_name, "targetGroup": group})

    # Build content entry
    content_entry: dict[str, Any] = {
        "url": url or f"conference://{conference}/{_slugify(title)}",
        "title": title,
        "type": "video" if video_url else "reference",
        "source": "youtube.com" if video_url and "youtube" in video_url else "cncf.io",
        "isOfficial": True,  # CNCF content is official
        "author": ", ".join(speakers),
        "labels": all_labels,
        "links": links,
    }

    if summary:
        content_entry["summary"] = summary
    if description:
        content_entry["description"] = description[:500]  # Truncate long descriptions

    # Add conference metadata
    conf_info = CONFERENCES.get(conference, {})
    if conf_info.get("dates"):
        # Use conference start date as published date
        content_entry["publishedDate"] = conf_info["dates"][0]

    data.setdefault("content", []).append(content_entry)
    save_content(data)
    log(f"  [OK] Added talk: {title}")


def _slugify(text: str) -> str:
    """Convert text to URL-safe slug."""
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")[:50]


def list_conference_content(conference: str | None = None) -> list[dict[str, Any]]:
    """
    List all conference content, optionally filtered by conference.

    Args:
        conference: Conference ID to filter by (optional)

    Returns:
        List of content entries
    """
    data = load_content()
    results = []

    for content in data.get("content", []):
        labels = [lbl.lower() for lbl in content.get("labels", [])]

        # Check if this is conference content
        is_conference = any(lbl.startswith("kubecon") for lbl in labels)
        if not is_conference:
            continue

        # Filter by specific conference
        if conference and conference.lower() not in labels:
            continue

        results.append(content)

    return results


def get_talks_by_topic(topic: str) -> list[dict[str, Any]]:
    """
    Get conference talks by topic label.

    Args:
        topic: Topic label (e.g., "dra", "scheduling", "gpu")

    Returns:
        List of matching talks
    """
    data = load_content()
    results = []
    topic_lower = topic.lower()

    for content in data.get("content", []):
        labels = [lbl.lower() for lbl in content.get("labels", [])]

        # Must be conference content
        is_conference = any(lbl.startswith("kubecon") for lbl in labels)
        if not is_conference:
            continue

        # Check topic match
        if topic_lower in labels:
            results.append(content)

    return results


# ============================================================================
# LLM Enrichment
# ============================================================================


def enrich_talk_with_llm(
    talk: dict[str, Any],
    provider: str | None = None,
    model_id: str | None = None,
) -> dict[str, Any] | None:
    """
    Enrich a conference talk with LLM-generated content.

    Generates:
    - summary: 1-liner description
    - labels: Topic labels extracted from description
    - kep_links: KEPs mentioned or related

    Args:
        talk: Talk content entry
        provider: LLM provider (uses config if not specified)
        model_id: Model ID override

    Returns:
        Enriched talk dict or None if failed
    """
    from ..llm_utils import (
        UsageTracker,
        create_agent,
        get_effective_model_id,
        get_provider_config,
        get_result_usage,
        load_config,
    )

    config = load_config()
    provider_name, provider_config = get_provider_config(config, provider)
    effective_model_id = get_effective_model_id(provider_config, model_id)

    tracker = UsageTracker(effective_model_id)

    system_prompt = """You are a Kubernetes expert analyzing conference talk descriptions.

Given a talk title and description, extract:
1. summary: A 1-sentence summary of what the talk covers (max 100 chars)
2. labels: Topic labels for the talk (lowercase, e.g., "dra", "scheduling", "gpu", "networking")
3. kep_links: Any KEP numbers mentioned or clearly related (e.g., "KEP-4381")

Focus on Kubernetes-specific topics. Common labels include:
- Features: dra, scheduling, networking, storage, security, observability, autoscaling
- Resources: pod, deployment, service, configmap, job, statefulset
- Components: kubelet, kube-apiserver, kube-scheduler, kube-proxy, etcd
- Concepts: sidecar, in-place-resize, user-namespaces, feature-gates

Respond in JSON format:
{
  "summary": "...",
  "labels": ["label1", "label2"],
  "kep_links": ["KEP-1234"]
}"""

    agent = create_agent(provider_name, provider_config, system_prompt, model_id)  # type: ignore

    title = talk.get("title", "")
    description = talk.get("description", "")

    prompt = f"""Analyze this KubeCon talk:

Title: {title}

Description:
{description[:2000]}

Extract summary, labels, and KEP links."""

    try:
        result = agent(prompt)
        in_tokens, out_tokens = get_result_usage(result)
        tracker.add(in_tokens, out_tokens)

        # Parse JSON response
        response_text = str(result)

        # Extract JSON from response
        json_match = re.search(r"\{[^{}]*\}", response_text, re.DOTALL)
        if json_match:
            enrichment = json.loads(json_match.group())
            return enrichment

    except Exception as e:
        log(f"  [ERROR] Failed to enrich talk: {e}")

    return None


# ============================================================================
# Batch Operations
# ============================================================================


def add_talks_batch(talks: list[ConferenceTalk]) -> int:
    """
    Add multiple talks in a batch.

    Args:
        talks: List of ConferenceTalk objects

    Returns:
        Number of talks added
    """
    added = 0
    for talk in talks:
        try:
            add_conference_talk(
                conference=talk.conference,
                title=talk.title,
                speakers=talk.speakers,
                video_url=talk.video_url,
                slides_url=talk.slides_url,
                description=talk.description,
                session_type=talk.session_type,
                summary=talk.summary,
                labels=talk.labels,
                kep_links=talk.kep_links,
                kind_links=talk.kind_links,
            )
            added += 1
        except Exception as e:
            log(f"  [ERROR] Failed to add talk '{talk.title}': {e}")

    return added


def import_from_json(json_path: str) -> int:
    """
    Import talks from a JSON file.

    Expected format:
    {
      "talks": [
        {
          "conference": "kubecon-na-2024",
          "title": "...",
          "speakers": ["..."],
          "video_url": "...",
          "labels": ["..."],
          ...
        }
      ]
    }

    Args:
        json_path: Path to JSON file

    Returns:
        Number of talks imported
    """
    import json
    from pathlib import Path

    path = Path(json_path)
    if not path.exists():
        raise FileNotFoundError(f"File not found: {json_path}")

    with open(path) as f:
        data = json.load(f)

    talks = []
    for entry in data.get("talks", []):
        talk = ConferenceTalk(
            conference=entry["conference"],
            title=entry["title"],
            speakers=entry.get("speakers", []),
            video_url=entry.get("video_url"),
            slides_url=entry.get("slides_url"),
            description=entry.get("description"),
            session_type=entry.get("session_type"),
            summary=entry.get("summary"),
            labels=entry.get("labels", []),
            kep_links=entry.get("kep_links", []),
            kind_links=[tuple(k) for k in entry.get("kind_links", [])],
        )
        talks.append(talk)

    return add_talks_batch(talks)
