"""
YouTube playlist fetcher for KubeCon and CNCF videos.

Fetches video metadata from YouTube playlists and converts them to content_links format.

## Usage

```bash
# Set YouTube API key
export YOUTUBE_API_KEY=your_api_key

# Fetch videos from a playlist
uv run k8s-pipeline fetch-youtube-playlist PLj6h78yzYM2N8GdbjmhVU65KYm_68qBmo

# Or use the Python API
from k8s.transform.youtube_fetcher import fetch_playlist_videos
videos = fetch_playlist_videos("PLj6h78yzYM2N8GdbjmhVU65KYm_68qBmo")
```

## Known CNCF Playlists

KubeCon NA 2024: PLj6h78yzYM2N8GdbjmhVU65KYm_68qBmo
KubeCon EU 2024: PLj6h78yzYM2PjJnJqMKBTrvKPzL_Mavs0
KubeCon NA 2023: PLj6h78yzYM2PyrvCoOii4rAopBswfz1p7
"""

import os
import re
import sys
from dataclasses import dataclass
from typing import Any

import httpx

from .content_links import load_content, save_content


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


# Known CNCF YouTube playlists
YOUTUBE_PLAYLISTS = {
    "kubecon-na-2024": {
        "playlist_id": "PLj6h78yzYM2N8GdbjmhVU65KYm_68qBmo",
        "name": "KubeCon + CloudNativeCon North America 2024",
        "conference_date": "2024-11-12",
    },
    "kubecon-eu-2024": {
        "playlist_id": "PLj6h78yzYM2PjJnJqMKBTrvKPzL_Mavs0",
        "name": "KubeCon + CloudNativeCon Europe 2024",
        "conference_date": "2024-03-19",
    },
    "kubecon-na-2023": {
        "playlist_id": "PLj6h78yzYM2PyrvCoOii4rAopBswfz1p7",
        "name": "KubeCon + CloudNativeCon North America 2023",
        "conference_date": "2023-11-06",
    },
    "kubecon-eu-2023": {
        "playlist_id": "PLj6h78yzYM2PyrvCoOii4rAopBswfz1p7",
        "name": "KubeCon + CloudNativeCon Europe 2023",
        "conference_date": "2023-04-18",
    },
    "kubecon-na-2021": {
        "playlist_id": "PLj6h78yzYM2Nd1U4RMhv7v88fdiFqeYAP",
        "name": "KubeCon + CloudNativeCon North America 2021",
        "conference_date": "2021-10-11",
    },
    "kubecon-eu-2021": {
        "playlist_id": "PLj6h78yzYM2MqBm19mRz9SYLsw4kfQBrC",
        "name": "KubeCon + CloudNativeCon Europe 2021",
        "conference_date": "2021-05-04",
    },
}


@dataclass
class YouTubeVideo:
    """A YouTube video from a playlist."""
    video_id: str
    title: str
    description: str
    channel_title: str
    published_at: str
    thumbnail_url: str | None = None


def get_api_key() -> str:
    """Get YouTube API key from environment."""
    key = os.environ.get("YOUTUBE_API_KEY")
    if not key:
        raise ValueError(
            "YOUTUBE_API_KEY environment variable not set. "
            "Get an API key from https://console.cloud.google.com/apis/credentials"
        )
    return key


def fetch_playlist_videos(
    playlist_id: str,
    max_results: int = 500,
    api_key: str | None = None,
) -> list[YouTubeVideo]:
    """
    Fetch all videos from a YouTube playlist.

    Args:
        playlist_id: YouTube playlist ID
        max_results: Maximum number of videos to fetch
        api_key: YouTube API key (uses env var if not provided)

    Returns:
        List of YouTubeVideo objects
    """
    if api_key is None:
        api_key = get_api_key()

    videos: list[YouTubeVideo] = []
    next_page_token: str | None = None

    while len(videos) < max_results:
        # Fetch playlist items
        params: dict[str, Any] = {
            "part": "snippet",
            "playlistId": playlist_id,
            "maxResults": min(50, max_results - len(videos)),
            "key": api_key,
        }
        if next_page_token:
            params["pageToken"] = next_page_token

        response = httpx.get(
            "https://www.googleapis.com/youtube/v3/playlistItems",
            params=params,
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()

        for item in data.get("items", []):
            snippet = item.get("snippet", {})
            resource = snippet.get("resourceId", {})

            if resource.get("kind") != "youtube#video":
                continue

            video = YouTubeVideo(
                video_id=resource.get("videoId", ""),
                title=snippet.get("title", ""),
                description=snippet.get("description", ""),
                channel_title=snippet.get("channelTitle", ""),
                published_at=snippet.get("publishedAt", ""),
                thumbnail_url=snippet.get("thumbnails", {}).get("high", {}).get("url"),
            )
            videos.append(video)

        next_page_token = data.get("nextPageToken")
        if not next_page_token:
            break

    log(f"  Fetched {len(videos)} videos from playlist {playlist_id}")
    return videos


def extract_speakers_from_title(title: str) -> tuple[str, list[str]]:
    """
    Extract speaker names from video title.

    Common patterns:
    - "Talk Title - Speaker Name, Company"
    - "Talk Title | Speaker Name"
    - "Speaker Name: Talk Title"

    Returns:
        Tuple of (clean_title, speakers_list)
    """
    speakers: list[str] = []
    clean_title = title

    # Pattern: "Title - Speaker Name, Company; Speaker2, Company2"
    if " - " in title:
        parts = title.rsplit(" - ", 1)
        if len(parts) == 2:
            potential_speakers = parts[1]
            # Check if it looks like speaker names (contains comma or semicolon)
            if "," in potential_speakers or ";" in potential_speakers:
                clean_title = parts[0].strip()
                # Split by semicolon first (multiple speakers)
                for speaker_part in potential_speakers.split(";"):
                    # Take name before company (first comma)
                    name = speaker_part.split(",")[0].strip()
                    if name and len(name) > 2:
                        speakers.append(name)

    # Pattern: "Title | Speaker Name"
    elif " | " in title:
        parts = title.split(" | ")
        if len(parts) >= 2:
            clean_title = parts[0].strip()
            speakers = [p.strip() for p in parts[1:] if p.strip()]

    return clean_title, speakers


def extract_labels_from_description(description: str, title: str) -> list[str]:
    """
    Extract topic labels from video description and title.

    Looks for Kubernetes-related keywords.
    """
    labels: list[str] = []
    text = f"{title} {description}".lower()

    # Kubernetes features/concepts
    keyword_map = {
        "dra": ["dynamic resource allocation", "dra ", "resourceclaim"],
        "scheduling": ["scheduler", "scheduling", "kube-scheduler"],
        "networking": ["network", "cni", "service mesh", "ingress", "gateway api"],
        "storage": ["storage", "csi", "persistent volume", "pvc", "pv "],
        "security": ["security", "rbac", "pod security", "seccomp", "apparmor"],
        "observability": ["observability", "monitoring", "tracing", "logging", "metrics"],
        "autoscaling": ["autoscal", "hpa", "vpa", "keda", "cluster autoscaler"],
        "gpu": ["gpu", "nvidia", "cuda", "accelerator"],
        "ai": [" ai ", "machine learning", " ml ", "llm", "genai"],
        "sidecar": ["sidecar", "init container"],
        "jobs": [" job ", "cronjob", "batch"],
        "statefulset": ["statefulset", "stateful"],
        "operator": ["operator", "controller"],
        "helm": ["helm", "chart"],
        "gitops": ["gitops", "argocd", "flux"],
        "service-mesh": ["istio", "linkerd", "service mesh", "envoy"],
        "etcd": ["etcd"],
        "api-server": ["api-server", "apiserver", "kube-apiserver"],
        "kubelet": ["kubelet"],
        "containerd": ["containerd", "container runtime", "cri-o"],
        "windows": ["windows"],
        "edge": ["edge", "k3s", "microk8s"],
        "multi-cluster": ["multi-cluster", "federation", "multicluster"],
        "cost": ["cost", "finops"],
        "platform-engineering": ["platform engineering", "idp", "internal developer"],
    }

    for label, keywords in keyword_map.items():
        if any(kw in text for kw in keywords):
            labels.append(label)

    return labels


def extract_keps_from_description(description: str) -> list[str]:
    """Extract KEP references from description."""
    keps: list[str] = []

    # Pattern: KEP-1234 or KEP 1234
    kep_pattern = r"KEP[- ]?(\d+)"
    matches = re.findall(kep_pattern, description, re.IGNORECASE)
    for match in matches:
        keps.append(f"KEP-{match}")

    return list(set(keps))


def video_to_content_entry(
    video: YouTubeVideo,
    conference_id: str,
    conference_date: str,
) -> dict[str, Any]:
    """
    Convert a YouTube video to a content_links entry.

    Args:
        video: YouTubeVideo object
        conference_id: Conference identifier (e.g., "kubecon-na-2024")
        conference_date: Conference start date

    Returns:
        Content entry dict
    """
    clean_title, speakers = extract_speakers_from_title(video.title)
    labels = extract_labels_from_description(video.description, video.title)
    keps = extract_keps_from_description(video.description)

    # Add conference label
    labels.append(conference_id)

    # Detect session type from title
    title_lower = video.title.lower()
    if "keynote" in title_lower:
        labels.append("keynote")
    elif "lightning" in title_lower:
        labels.append("lightning-talk")
    elif "tutorial" in title_lower:
        labels.append("tutorial")
    elif "deep dive" in title_lower or "deep-dive" in title_lower:
        labels.append("deep-dive")
    elif "maintainer" in title_lower:
        labels.append("maintainer-track")

    # Build links
    links: list[dict[str, Any]] = []
    for kep in keps:
        links.append({"targetType": "kep", "targetId": kep})

    # Create summary from first line of description
    summary = video.description.split("\n")[0][:200] if video.description else None

    entry: dict[str, Any] = {
        "url": f"https://www.youtube.com/watch?v={video.video_id}",
        "title": clean_title or video.title,
        "type": "video",
        "source": "youtube.com",
        "isOfficial": True,
        "publishedDate": conference_date,
        "labels": list(set(labels)),
        "links": links,
    }

    if speakers:
        entry["author"] = ", ".join(speakers)
    if summary:
        entry["summary"] = summary

    return entry


def import_playlist_to_content(
    playlist_id: str,
    conference_id: str,
    conference_date: str,
    max_videos: int = 500,
    dry_run: bool = False,
) -> int:
    """
    Import videos from a YouTube playlist into content_links.json.

    Args:
        playlist_id: YouTube playlist ID
        conference_id: Conference identifier
        conference_date: Conference start date
        max_videos: Maximum videos to import
        dry_run: If True, don't save changes

    Returns:
        Number of videos imported
    """
    log(f"Fetching videos from playlist {playlist_id}...")
    videos = fetch_playlist_videos(playlist_id, max_results=max_videos)

    if not videos:
        log("  No videos found")
        return 0

    data = load_content()
    existing_urls = {c["url"] for c in data.get("content", [])}

    added = 0
    for video in videos:
        entry = video_to_content_entry(video, conference_id, conference_date)

        if entry["url"] in existing_urls:
            continue

        if not dry_run:
            data.setdefault("content", []).append(entry)

        added += 1
        log(f"  + {entry['title'][:60]}...")

    if not dry_run and added > 0:
        save_content(data)

    log(f"Imported {added} new videos (skipped {len(videos) - added} existing)")
    return added


def import_youtube_videos(
    conference: str,
    max_videos: int = 500,
    dry_run: bool = False,
) -> int:
    """
    Import videos from a known KubeCon playlist.

    Args:
        conference: Conference ID (e.g., "kubecon-na-2024")
        max_videos: Maximum videos to import
        dry_run: If True, don't save changes

    Returns:
        Number of videos imported
    """
    if conference not in YOUTUBE_PLAYLISTS:
        available = ", ".join(YOUTUBE_PLAYLISTS.keys())
        raise ValueError(f"Unknown conference: {conference}. Available: {available}")

    info = YOUTUBE_PLAYLISTS[conference]
    return import_playlist_to_content(
        playlist_id=info["playlist_id"],
        conference_id=conference,
        conference_date=info["conference_date"],
        max_videos=max_videos,
        dry_run=dry_run,
    )


def list_available_playlists() -> None:
    """Print available KubeCon playlists."""
    log("Available KubeCon playlists:")
    for conf_id, info in YOUTUBE_PLAYLISTS.items():
        log(f"  {conf_id}: {info['name']} ({info['playlist_id']})")
