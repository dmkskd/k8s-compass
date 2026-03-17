"""
Sched.com scraper for KubeCon and CNCF conference sessions.

Fetches session data from Sched.com conference schedules via iCal export to extract:
- Session titles and descriptions
- Speaker names (from title parsing)
- Session types (keynote, deep-dive, tutorial, etc.)
- Categories/tracks
- Session URLs

Optionally enriches sessions with LLM to generate:
- Better summaries
- Accurate topic labels
- KEP references
- Session type classification

## Usage

```bash
# List available conferences
uv run k8s-pipeline fetch-sched --list

# Scrape KubeCon NA 2024 sessions (with LLM enrichment by default)
uv run k8s-pipeline fetch-sched kubecon-na-2024

# Skip LLM enrichment (faster, no API costs)
uv run k8s-pipeline fetch-sched kubecon-na-2024 --no-enrich

# Preview without saving
uv run k8s-pipeline fetch-sched kubecon-na-2024 --dry-run

# Limit number of sessions
uv run k8s-pipeline fetch-sched kubecon-na-2024 --max 50
```

## Known Conferences

- kubecon-na-2024: KubeCon + CloudNativeCon North America 2024 (Salt Lake City)
- kubecon-eu-2024: KubeCon + CloudNativeCon Europe 2024 (Paris)
- kubecon-eu-2025: KubeCon + CloudNativeCon Europe 2025 (London)
"""

import json
import re
import sys
from dataclasses import dataclass, field
from typing import Any

import httpx
from pydantic import BaseModel, Field

from ...core.config import CACHE_DIR, CURATED_CONTENT_DIR, CURATED_KEPS_DIR
from .content_links import (
    get_content_file_for_conference,
    load_all_content,
    load_content,
    save_content,
)
from ..llm_utils import (
    ProviderType,
    UsageTracker,
    create_agent,
    get_effective_model_id,
    get_provider_config,
    get_result_usage,
    load_config,
)

# Cache for valid KEP IDs
_valid_keps: set[str] | None = None


def get_valid_keps() -> set[str]:
    """Load valid KEP IDs from kep_metadata.json."""
    global _valid_keps
    if _valid_keps is None:
        kep_metadata_file = CURATED_KEPS_DIR / "kep_metadata.json"
        if kep_metadata_file.exists():
            data = json.loads(kep_metadata_file.read_text())
            _valid_keps = set(data.get("keps", {}).keys())
        else:
            _valid_keps = set()
    return _valid_keps
    return _valid_keps


def validate_kep_references(keps: list[str]) -> list[str]:
    """Filter KEP references to only include valid KEPs from our metadata."""
    valid = get_valid_keps()
    validated = []
    for kep in keps:
        if kep in valid:
            validated.append(kep)
        else:
            log(f"    [SKIP] Invalid KEP reference: {kep}")
    return validated


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


# Conference definitions with Sched URLs
SCHED_CONFERENCES = {
    "kubecon-na-2024": {
        "name": "KubeCon + CloudNativeCon North America 2024",
        "sched_url": "https://kccncna2024.sched.com",
        "conference_date": "2024-11-12",
        "location": "Salt Lake City, Utah",
        "future": False,
    },
    "kubecon-eu-2024": {
        "name": "KubeCon + CloudNativeCon Europe 2024",
        "sched_url": "https://kccnceu2024.sched.com",
        "conference_date": "2024-03-19",
        "location": "Paris, France",
        "future": False,
    },
    "kubecon-eu-2025": {
        "name": "KubeCon + CloudNativeCon Europe 2025",
        "sched_url": "https://kccnceu2025.sched.com",
        "conference_date": "2025-04-01",
        "location": "London, UK",
        "future": False,
    },
    "kubecon-na-2025": {
        "name": "KubeCon + CloudNativeCon North America 2025",
        "sched_url": "https://kccncna2025.sched.com",
        "conference_date": "2025-11-10",
        "location": "Atlanta, Georgia",
        "future": False,
    },
    "kubecon-na-2023": {
        "name": "KubeCon + CloudNativeCon North America 2023",
        "sched_url": "https://kccncna2023.sched.com",
        "conference_date": "2023-11-06",
        "location": "Chicago, Illinois",
        "future": False,
    },
    "kubecon-eu-2023": {
        "name": "KubeCon + CloudNativeCon Europe 2023",
        "sched_url": "https://kccnceu2023.sched.com",
        "conference_date": "2023-04-18",
        "location": "Amsterdam, Netherlands",
        "future": False,
    },
    "kubecon-na-2022": {
        "name": "KubeCon + CloudNativeCon North America 2022",
        "sched_url": "https://kccncna2022.sched.com",
        "conference_date": "2022-10-24",
        "location": "Detroit, Michigan",
        "future": False,
    },
    "kubecon-eu-2022": {
        "name": "KubeCon + CloudNativeCon Europe 2022",
        "sched_url": "https://kccnceu2022.sched.com",
        "conference_date": "2022-05-16",
        "location": "Valencia, Spain",
        "future": False,
    },
    "kubecon-na-2021": {
        "name": "KubeCon + CloudNativeCon North America 2021",
        "sched_url": "https://kccncna2021.sched.com",
        "conference_date": "2021-10-11",
        "location": "Los Angeles, California",
        "future": False,
    },
    "kubecon-eu-2021": {
        "name": "KubeCon + CloudNativeCon Europe 2021",
        "sched_url": "https://kccnceu2021.sched.com",
        "conference_date": "2021-05-04",
        "location": "Virtual",
        "future": False,
    },
    "kubecon-na-2019": {
        "name": "KubeCon + CloudNativeCon North America 2019",
        "sched_url": "https://kccncna19.sched.com",
        "conference_date": "2019-11-18",
        "location": "San Diego, California",
        "future": False,
    },
    "kubecon-eu-2019": {
        "name": "KubeCon + CloudNativeCon Europe 2019",
        "sched_url": "https://kccnceu19.sched.com",
        "conference_date": "2019-05-20",
        "location": "Barcelona, Spain",
        "future": False,
    },
    "kubecon-na-2018": {
        "name": "KubeCon + CloudNativeCon North America 2018",
        "sched_url": "https://kccna18.sched.com",
        "conference_date": "2018-12-10",
        "location": "Seattle, Washington",
        "future": False,
    },
    "kubecon-eu-2018": {
        "name": "KubeCon + CloudNativeCon Europe 2018",
        "sched_url": "https://kccnceu18.sched.com",
        "conference_date": "2018-05-02",
        "location": "Copenhagen, Denmark",
        "future": False,
    },
    "kubecon-china-2018": {
        "name": "KubeCon + CloudNativeCon China 2018",
        "sched_url": "https://kccncchina2018.sched.com",
        "conference_date": "2018-11-14",
        "location": "Shanghai, China",
        "future": False,
    },
    "kubecon-china-2025": {
        "name": "KubeCon + CloudNativeCon China 2025",
        "sched_url": "https://kccncchn2025.sched.com",
        "conference_date": "2025-06-10",
        "location": "Hong Kong",
        "future": False,
    },
    # Future conferences (no videos yet, for planning)
    "kubecon-eu-2026": {
        "name": "KubeCon + CloudNativeCon Europe 2026",
        "sched_url": "https://kccnceu2026.sched.com",
        "conference_date": "2026-03-23",
        "location": "Amsterdam, Netherlands",
        "future": True,
    },
}

# Session categories to include (filter out registration, breaks, etc.)
# We want technical sessions from the main KubeCon track only
INCLUDE_CATEGORIES = {
    "breakout session",
    "breakout sessions",
    "deep dive",
    "maintainer track",
    "maintainer session",
    "project meeting",
    "sig meeting",
    "case study",
    "end user",
    "contribfest",
}

# Categories to exclude
EXCLUDE_CATEGORIES = {
    # Logistics
    "registration",
    "break",
    "lunch",
    "breakfast",
    "networking",
    "reception",
    "party",
    "social",
    "badge pick-up",
    "coat + bag check",
    "experiences",
    "all access",
    # Co-located events (separate conferences)
    "wasmcon",
    "argocon",
    "backstagecon",
    "cilium",
    "ebpf day",
    "istio day",
    "envoycon",
    "openfeature",
    "observability day",
    "platform engineering day",
    "data on kubernetes",
    "kubernetes on edge",
    "multi-tenancy",
    "thanoscon",
    "opentofu",
    "cloud native ai day",
    "cloud native university",
    "appdevcon",
    "appdevelopercon",
    "sigstorecon",
    "operatorday",
    "operator day",
    "calicocon",
    "rancher day",
    "openshift commons",
    "azure day",
    "aws immersion",
    # Sponsored/marketing
    "sponsored",
    "sponsor",
    "booth",
    "demo theater",
    "solutions showcase",
    # Keynotes (usually not technical deep-dives)
    "keynote",
    # Lightning/flash talks (too short for depth)
    "lightning",
    "flash",
    # Beginner content
    "101",
    "intro to",
    "introduction to",
    "getting started",
    "beginner",
    # Other
    "fireside",
    "office hours",
    "birds of a feather",
    "bof",
    "workshop",  # Usually co-located day workshops
    "tutorial",  # Usually co-located day tutorials
}


@dataclass
class SchedSession:
    """A conference session from Sched.com."""

    session_id: str
    title: str
    speakers: list[str] = field(default_factory=list)
    description: str | None = None
    session_type: str | None = None  # keynote, deep-dive, tutorial, etc.
    categories: list[str] = field(default_factory=list)
    location: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    session_url: str | None = None
    # Scraped from HTML page
    youtube_url: str | None = None
    slides_url: str | None = None
    experience_level: str | None = None  # Beginner, Intermediate, Advanced


def scrape_session_media(
    session_url: str,
    client: httpx.Client,
    max_retries: int = 3,
) -> tuple[str | None, str | None, str | None]:
    """
    Scrape YouTube video, slides URLs, and experience level from a Sched session page.

    Handles multiple YouTube link patterns across different conference years:
    - Pattern 1 (2024+): youtube.com/embed/VIDEO_ID (iframe embed)
    - Pattern 2 (2018): Custom field with youtu.be link in <li> element
    - Pattern 3 (2021 EU): sched-button div with youtube.com/watch link
    - Pattern 4: Direct youtu.be/VIDEO_ID links anywhere
    - Pattern 5: Direct youtube.com/watch?v=VIDEO_ID links anywhere

    Args:
        session_url: URL to the Sched session page
        client: httpx Client for making requests
        max_retries: Maximum number of retries for rate limit errors

    Returns:
        Tuple of (youtube_url, slides_url, experience_level)
    """
    import time

    youtube_url = None
    slides_url = None
    experience_level = None

    # Ensure HTTPS
    if session_url.startswith("http://"):
        session_url = session_url.replace("http://", "https://")

    for attempt in range(max_retries):
        try:
            response = client.get(session_url, timeout=30)

            # Handle rate limiting with exponential backoff
            if response.status_code == 429:
                wait_time = (2 ** attempt) * 2  # 2, 4, 8 seconds
                log(f"    [RATE] 429 - waiting {wait_time}s before retry...")
                time.sleep(wait_time)
                continue

            response.raise_for_status()
            html = response.text

            # Extract YouTube video ID - try multiple patterns in order of specificity
            video_id = None

            # Pattern 1: src="https://www.youtube.com/embed/VIDEO_ID" (iframe embed, 2024+)
            youtube_match = re.search(r'youtube\.com/embed/([a-zA-Z0-9_-]+)', html)
            if youtube_match:
                video_id = youtube_match.group(1)

            # Pattern 2: 2018 custom field - <li>...<a href="https://youtu.be/VIDEO_ID">
            # e.g., <li><strong><b>Link to Session Recording</b></strong> <a target="_blank" href="https://youtu.be/05zN-YQxEAM">
            if not video_id:
                custom_field_match = re.search(
                    r'Link to Session Recording</b></strong>\s*<a[^>]*href="https?://youtu\.be/([a-zA-Z0-9_-]+)"',
                    html
                )
                if custom_field_match:
                    video_id = custom_field_match.group(1)

            # Pattern 3: 2021 EU sched-button - <div class="sched-button"><a href="https://www.youtube.com/watch?v=VIDEO_ID">
            if not video_id:
                sched_button_match = re.search(
                    r'class="sched-button"[^>]*>\s*<a[^>]*href="https?://(?:www\.)?youtube\.com/watch\?v=([a-zA-Z0-9_-]+)"',
                    html
                )
                if sched_button_match:
                    video_id = sched_button_match.group(1)

            # Pattern 4: Any href="https://youtu.be/VIDEO_ID" link
            if not video_id:
                youtu_be_match = re.search(r'href="https?://youtu\.be/([a-zA-Z0-9_-]+)"', html)
                if youtu_be_match:
                    video_id = youtu_be_match.group(1)

            # Pattern 5: Any href="https://www.youtube.com/watch?v=VIDEO_ID" link
            if not video_id:
                youtube_watch_match = re.search(
                    r'href="https?://(?:www\.)?youtube\.com/watch\?v=([a-zA-Z0-9_-]+)"',
                    html
                )
                if youtube_watch_match:
                    video_id = youtube_watch_match.group(1)

            if video_id:
                youtube_url = f"https://www.youtube.com/watch?v={video_id}"

            # Extract experience level
            # Pattern: <strong>Content Experience Level</strong> <a href="/company/Beginner">Beginner</a>
            level_match = re.search(r'Content Experience Level</strong>\s*<a[^>]*>([^<]+)</a>', html)
            if level_match:
                experience_level = level_match.group(1).strip()

            # Extract slides PDF URL
            # Pattern: href="https://static.sched.com/hosted_files/...pdf"
            slides_match = re.search(r'href="(https://static\.sched\.com/hosted_files/[^"]+\.pdf)"', html)
            if slides_match:
                slides_url = slides_match.group(1)

            return youtube_url, slides_url, experience_level

        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429 and attempt < max_retries - 1:
                wait_time = (2 ** attempt) * 2
                log(f"    [RATE] 429 - waiting {wait_time}s before retry...")
                time.sleep(wait_time)
                continue
            log(f"    [WARN] Failed to scrape {session_url}: {e}")
            return None, None, None
        except Exception as e:
            log(f"    [WARN] Failed to scrape {session_url}: {e}")
            return None, None, None

    return youtube_url, slides_url, experience_level


def scrape_sessions_media_batch(
    sessions: list[SchedSession],
    delay: float = 1.0,
) -> dict[str, tuple[str | None, str | None, str | None]]:
    """
    Scrape media URLs and experience level for sessions SEQUENTIALLY with delays.

    Args:
        sessions: List of sessions to scrape
        delay: Delay between requests in seconds (default: 1.0)

    Returns:
        Dict mapping session_id to (youtube_url, slides_url, experience_level)
    """
    import time

    results: dict[str, tuple[str | None, str | None, str | None]] = {}

    # Create a client
    client = httpx.Client(
        timeout=30,
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
        },
    )

    log(f"\n[SCRAPE] Fetching video/slides/level for {len(sessions)} sessions...")
    log(f"  (Sequential with {delay}s delay between requests)")

    for i, session in enumerate(sessions):
        if not session.session_url:
            results[session.session_id] = (None, None, None)
            continue

        # Add delay between requests (skip first one)
        if i > 0:
            time.sleep(delay)

        youtube, slides, level = scrape_session_media(session.session_url, client)
        results[session.session_id] = (youtube, slides, level)

        # Progress indicator
        if (i + 1) % 10 == 0:
            log(f"  Scraped {i + 1}/{len(sessions)} sessions...")

    client.close()

    # Count results
    with_video = sum(1 for y, _s, _lvl in results.values() if y)
    with_slides = sum(1 for _y, s, _lvl in results.values() if s)
    with_level = sum(1 for _y, _s, lvl in results.values() if lvl)
    log(f"  Found {with_video} videos, {with_slides} slides PDFs, {with_level} experience levels")

    return results

def parse_ical(ical_text: str) -> list[dict[str, Any]]:
    """
    Parse iCal format into a list of events.

    Args:
        ical_text: Raw iCal text

    Returns:
        List of event dictionaries
    """
    events = []
    current_event: dict[str, Any] | None = None
    current_key: str | None = None
    current_value: str = ""

    for line in ical_text.split("\n"):
        line = line.rstrip("\r")

        # Handle line continuation (lines starting with space or tab)
        if line.startswith(" ") or line.startswith("\t"):
            if current_key and current_event is not None:
                current_value += line[1:]  # Remove leading whitespace
                current_event[current_key] = current_value
            continue

        # Save previous key-value pair
        if current_key and current_event is not None:
            current_event[current_key] = current_value

        # Parse new line
        if line == "BEGIN:VEVENT":
            current_event = {}
            current_key = None
            current_value = ""
        elif line == "END:VEVENT":
            if current_event:
                events.append(current_event)
            current_event = None
            current_key = None
            current_value = ""
        elif ":" in line and current_event is not None:
            # Handle properties with parameters (e.g., DTSTART;VALUE=DATE:20241112)
            key_part, value = line.split(":", 1)
            # Remove parameters from key
            current_key = key_part.split(";")[0]
            current_value = value

    return events


def unescape_ical(text: str) -> str:
    """Unescape iCal special characters."""
    if not text:
        return ""
    text = text.replace("\\n", "\n")
    text = text.replace("\\,", ",")
    text = text.replace("\\;", ";")
    text = text.replace("\\\\", "\\")
    # Remove HTML entities
    text = text.replace("&nbsp;", " ")
    text = text.replace("&amp;", "&")
    text = text.replace("&lt;", "<")
    text = text.replace("&gt;", ">")
    return text.strip()


def extract_speakers_from_title(title: str) -> tuple[str, list[str]]:
    """
    Extract speaker names from session title.

    Common patterns:
    - "Talk Title - Speaker Name, Company"
    - "Talk Title - Speaker1, Company1; Speaker2, Company2"

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
            # Check if it looks like speaker names (contains comma)
            if "," in potential_speakers:
                clean_title = parts[0].strip()
                # Split by semicolon first (multiple speakers)
                for speaker_part in potential_speakers.split(";"):
                    # Take name before company (first comma)
                    name = speaker_part.split(",")[0].strip()
                    if name and len(name) > 2 and not name.isupper():
                        speakers.append(name)

    return clean_title, speakers


def detect_session_type(title: str, categories: list[str], description: str) -> str | None:
    """Detect session type from title, categories, and description."""
    text = f"{title} {' '.join(categories)} {description}".lower()

    if "keynote" in text:
        return "keynote"
    elif "lightning" in text:
        return "lightning-talk"
    elif "tutorial" in text:
        return "tutorial"
    elif "deep dive" in text or "deep-dive" in text:
        return "deep-dive"
    elif "workshop" in text:
        return "workshop"
    elif "maintainer" in text:
        return "maintainer-track"
    elif "panel" in text:
        return "panel"
    elif "case study" in text:
        return "case-study"
    elif "sig " in text or "sig-" in text:
        return "sig-meeting"

    return None


def should_include_session(categories: list[str], title: str, description: str = "") -> bool:
    """
    Check if a session should be included based on categories and title.

    We want technical sessions from the main KubeCon track:
    - Breakout sessions, deep dives
    - Maintainer track, SIG meetings
    - Case studies, end user stories

    We exclude:
    - Co-located events (WasmCon, ArgoCon, etc.)
    - Keynotes, sponsored sessions
    - Lightning/flash talks
    - Beginner/101 content
    - Workshops/tutorials (usually co-located day)
    """
    title_lower = title.lower()
    categories_lower = [c.lower() for c in categories]
    text = f"{title_lower} {' '.join(categories_lower)} {description.lower()}"

    # EXCLUDE: Check title and categories against exclusion list
    for exclude in EXCLUDE_CATEGORIES:
        if exclude in title_lower:
            return False
        for cat in categories_lower:
            if exclude in cat:
                return False

    # EXCLUDE: Co-located event indicators in title
    colocated_indicators = [
        "hosted by", "all access pass", "full day event", "half day event",
        "| all access", "- sold out", "day hosted by",
    ]
    for indicator in colocated_indicators:
        if indicator in title_lower:
            return False

    # EXCLUDE: Panels and fireside chats (usually less technical)
    if "panel" in title_lower or "fireside" in title_lower:
        return False

    # INCLUDE: Check if any category matches our include list
    for cat in categories_lower:
        for include in INCLUDE_CATEGORIES:
            if include in cat:
                return True

    # INCLUDE: Main conference session indicators
    main_session_indicators = [
        "breakout", "deep dive", "deep-dive", "maintainer",
        "sig-", "sig ", "case study", "contribfest",
    ]
    for indicator in main_session_indicators:
        if indicator in text:
            return True

    # INCLUDE: Technical K8s content (but not if it's a co-located event)
    k8s_technical = [
        "kubernetes", "k8s", "kubectl", "kubelet", "kube-apiserver",
        "etcd", "scheduler", "controller", "operator", "crd",
        "pod", "deployment", "statefulset", "daemonset",
        "service mesh", "ingress", "gateway api",
        "storage", "csi", "pv", "pvc",
        "rbac", "security", "policy",
        "scheduling", "autoscaling", "hpa", "vpa",
        "dra", "resource", "gpu", "device",
    ]
    for keyword in k8s_technical:
        if keyword in text:
            # Double-check it's not a co-located event
            if "hosted by" not in title_lower and "all access" not in title_lower:
                return True

    # Default: exclude (be conservative)
    return False


class SchedScraper:
    """Scraper for Sched.com conference schedules via iCal export."""

    def __init__(
        self,
        conference_id: str,
        use_cache: bool = True,
    ):
        if conference_id not in SCHED_CONFERENCES:
            available = ", ".join(SCHED_CONFERENCES.keys())
            raise ValueError(f"Unknown conference: {conference_id}. Available: {available}")

        self.conference_id = conference_id
        self.config = SCHED_CONFERENCES[conference_id]
        self.base_url = self.config["sched_url"]
        self.use_cache = use_cache
        self.cache_dir = CACHE_DIR / "sched" / conference_id

        if use_cache:
            self.cache_dir.mkdir(parents=True, exist_ok=True)

        self.client = httpx.Client(
            timeout=60,
            headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                "Accept": "text/calendar,text/plain,*/*",
            },
        )

    def fetch_ical(self) -> str:
        """Fetch the iCal export for the conference."""
        cache_file = self.cache_dir / "all.ics"

        if self.use_cache and cache_file.exists():
            log(f"  Using cached iCal from {cache_file}")
            return cache_file.read_text()

        ical_url = f"{self.base_url}/all.ics"
        log(f"  Fetching iCal from {ical_url}...")

        response = self.client.get(ical_url)
        response.raise_for_status()
        content = response.text

        if self.use_cache:
            cache_file.write_text(content)

        return content

    def scrape_all_sessions(
        self,
        max_sessions: int | None = None,
    ) -> list[SchedSession]:
        """
        Scrape all sessions from the conference via iCal export.

        Args:
            max_sessions: Maximum number of sessions to return

        Returns:
            List of SchedSession objects
        """
        ical_text = self.fetch_ical()
        events = parse_ical(ical_text)

        log(f"  Parsed {len(events)} events from iCal")

        sessions = []
        for event in events:
            title = unescape_ical(event.get("SUMMARY", ""))
            description = unescape_ical(event.get("DESCRIPTION", ""))
            categories = [c.strip() for c in event.get("CATEGORIES", "").split(",") if c.strip()]
            location = unescape_ical(event.get("LOCATION", ""))
            url = event.get("URL", "")
            uid = event.get("UID", "")

            # Filter out non-session events
            if not should_include_session(categories, title, description):
                continue

            # Extract speakers from title
            clean_title, speakers = extract_speakers_from_title(title)

            # Detect session type
            session_type = detect_session_type(title, categories, description)

            session = SchedSession(
                session_id=uid,
                title=clean_title,
                speakers=speakers,
                description=description,
                session_type=session_type,
                categories=categories,
                location=location,
                start_time=event.get("DTSTART"),
                end_time=event.get("DTEND"),
                session_url=url,
            )
            sessions.append(session)

            if max_sessions and len(sessions) >= max_sessions:
                break

        log(f"  Found {len(sessions)} sessions (filtered from {len(events)} events)")
        return sessions


def extract_labels_from_session(session: SchedSession) -> list[str]:
    """Extract topic labels from session title and description."""
    labels: list[str] = []
    text = f"{session.title} {session.description or ''} {' '.join(session.categories)}".lower()

    # Kubernetes features/concepts - comprehensive keyword map
    keyword_map = {
        # Core K8s resources
        "pod": [" pod ", "pods ", "podspec", "pod resource", "pod configuration"],
        "deployment": ["deployment", "deployments"],
        "service": [" service ", "services ", "clusterip", "nodeport", "loadbalancer"],
        "statefulset": ["statefulset", "stateful"],
        "daemonset": ["daemonset"],
        "job": [" job ", " jobs ", "cronjob", "batch job"],
        "configmap": ["configmap", "config map"],
        "secret": [" secret ", "secrets "],
        "namespace": ["namespace", "namespaces"],
        "node": [" node ", " nodes ", "node pool"],

        # Networking
        "networking": ["network", "cni", "network policy", "networkpolicy"],
        "ingress": ["ingress"],
        "gateway-api": ["gateway api", "gateway-api", "httproute", "grpcroute"],
        "service-mesh": ["service mesh", "istio", "linkerd", "envoy proxy"],
        "cilium": ["cilium"],
        "calico": ["calico"],
        "dns": [" dns ", "coredns", "kube-dns"],
        "load-balancing": ["load balanc", "loadbalancer"],

        # Storage
        "storage": ["storage", "persistent volume", "pvc", "pv ", "storageclass"],
        "csi": [" csi ", "container storage interface"],
        "rook": ["rook"],
        "ceph": ["ceph"],

        # Scheduling & Resources
        "scheduling": ["scheduler", "scheduling", "kube-scheduler", "schedule "],
        "dra": ["dynamic resource allocation", " dra ", "resourceclaim", "deviceclass"],
        "autoscaling": ["autoscal", "hpa", "vpa", "keda", "cluster autoscaler"],
        "resource-management": ["resource request", "resource limit", "qos class", "resource quota"],

        # Security
        "security": ["security", "secure", "vulnerability", "cve-"],
        "rbac": ["rbac", "role-based", "clusterrole", "rolebinding"],
        "pod-security": ["pod security", "podsecurity", "psa ", "pss "],
        "network-policy": ["network policy", "networkpolicy"],
        "secrets-management": ["secret management", "vault", "sealed secret", "external secret"],
        "supply-chain": ["supply chain", "sbom", "slsa", "provenance"],
        "sigstore": ["sigstore", "cosign", "rekor", "fulcio"],

        # Observability
        "observability": ["observability", "o11y"],
        "monitoring": ["monitoring", "metrics", "prometheus", "thanos"],
        "logging": ["logging", " logs ", "fluentd", "fluentbit", "loki"],
        "tracing": ["tracing", "trace ", "jaeger", "zipkin", "tempo"],
        "opentelemetry": ["opentelemetry", "otel"],
        "grafana": ["grafana"],

        # AI/ML
        "ai": [" ai ", "artificial intelligence", "genai", "generative ai"],
        "ml": ["machine learning", " ml ", "mlops", "model serving", "model training"],
        "llm": [" llm ", "large language model", "language model"],
        "gpu": [" gpu ", " gpus ", "nvidia", "cuda", "accelerator"],
        "ray": [" ray ", "ray on kubernetes", "kuberay", "ray cluster"],
        "vllm": ["vllm", "vllm ", " vllm"],
        "inference": ["inference", "inferencing"],

        # Data & Databases
        "database": ["database", "dbaas", " db ", "postgres", "mysql", "mongodb", "redis", "cassandra"],
        "data": ["data on kubernetes", "data platform", "data pipeline"],
        "kafka": ["kafka", "strimzi"],
        "spark": [" spark ", "apache spark"],

        # GitOps & CI/CD
        "gitops": ["gitops", "git-ops"],
        "argocd": ["argocd", "argo cd", "argo-cd"],
        "flux": [" flux ", "fluxcd"],
        "ci-cd": [" ci/cd", "cicd", "continuous integration", "continuous delivery"],
        "tekton": ["tekton"],

        # Operators & Controllers
        "operator": ["operator", "operators"],
        "controller": ["controller", "controllers", "controller-runtime"],
        "crd": [" crd ", "custom resource", "customresourcedefinition"],

        # Platform & Developer Experience
        "platform-engineering": ["platform engineering", "platform team", "internal developer", " idp "],
        "developer-experience": ["developer experience", "devex", " dx "],
        "backstage": ["backstage"],

        # Multi-cluster & Federation
        "multi-cluster": ["multi-cluster", "multicluster", "federation", "cluster api"],
        "cluster-api": ["cluster api", "cluster-api", "capi "],

        # Edge & IoT
        "edge": [" edge ", "edge computing", "k3s", "microk8s", "k0s"],
        "iot": [" iot ", "internet of things"],

        # Core Components
        "etcd": ["etcd"],
        "api-server": ["api-server", "apiserver", "kube-apiserver"],
        "kubelet": ["kubelet"],
        "kube-proxy": ["kube-proxy", "kubeproxy"],
        "containerd": ["containerd"],
        "cri-o": ["cri-o", "crio"],

        # Container & Runtime
        "container": ["container", "containers", "containerization"],
        "image": ["container image", "image registry", "oci image"],
        "wasm": ["wasm", "webassembly", "wasmcloud"],

        # Cost & FinOps
        "cost": ["cost", "finops", "cost optimization", "cost management"],
        "sustainability": ["sustainability", "carbon", "green computing", "environmental"],

        # Windows
        "windows": ["windows"],

        # eBPF
        "ebpf": ["ebpf", " bpf "],

        # Helm & Packaging
        "helm": [" helm ", "helm chart"],
        "kustomize": ["kustomize"],

        # Testing
        "testing": ["testing", " test ", "e2e test", "conformance"],
        "chaos": ["chaos engineering", "chaos mesh", "litmus", "chaos monkey"],

        # Sidecar & Containers
        "sidecar": ["sidecar", "sidecar container"],
        "init-container": ["init container", "initcontainer"],

        # Specific projects
        "knative": ["knative"],
        "crossplane": ["crossplane"],
        "kyverno": ["kyverno"],
        "gatekeeper": ["gatekeeper", "opa ", "open policy agent"],
        "cert-manager": ["cert-manager", "certmanager"],
        "external-dns": ["external-dns", "externaldns"],
        "velero": ["velero"],
        "virtual-kubelet": ["virtual kubelet"],

        # Cloud Providers & Managed Kubernetes
        "aws": [" aws ", "amazon web services", "amazon eks", " eks ", "elastic kubernetes"],
        "eks": [" eks ", "amazon eks", "elastic kubernetes service"],
        "gcp": [" gcp ", "google cloud", "google kubernetes", " gke "],
        "gke": [" gke ", "google kubernetes engine"],
        "azure": ["azure", "microsoft azure", " aks ", "azure kubernetes"],
        "aks": [" aks ", "azure kubernetes service"],
        "alibaba": ["alibaba", "alicloud", "aliyun", " ack "],
        "ack": [" ack ", "alibaba container service"],
        "oracle": ["oracle cloud", " oke ", "oracle kubernetes"],
        "oke": [" oke ", "oracle kubernetes engine"],
        "ibm": ["ibm cloud", "ibm kubernetes", " iks "],
        "digitalocean": ["digitalocean", " doks "],
        "linode": ["linode", "akamai cloud"],
        "vultr": ["vultr"],
        "civo": ["civo"],
        "openshift": ["openshift", "red hat openshift", " ocp "],
        "rancher": ["rancher", "rke ", "rke2"],
        "tanzu": ["tanzu", "vmware tanzu", "tkg "],
    }

    for label, keywords in keyword_map.items():
        if any(kw in text for kw in keywords):
            labels.append(label)

    # Extract SIG labels (sig-node, sig-network, sig-storage, etc.)
    sig_pattern = r'\bsig[- ]([a-z]+(?:[- ][a-z]+)?)\b'
    sig_matches = re.findall(sig_pattern, text)
    for sig in sig_matches:
        sig_label = f"sig-{sig.replace(' ', '-')}"
        if sig_label not in labels:
            labels.append(sig_label)

    # Also check for "SIG Network", "SIG Node" etc. in title
    sig_title_pattern = r'\bSIG[- ]?([A-Za-z]+(?:[- ][A-Za-z]+)?)\b'
    sig_title_matches = re.findall(sig_title_pattern, session.title)
    for sig in sig_title_matches:
        sig_label = f"sig-{sig.lower().replace(' ', '-')}"
        if sig_label not in labels:
            labels.append(sig_label)

    return labels


def extract_keps_from_session(session: SchedSession) -> list[str]:
    """Extract KEP references from session description."""
    keps: list[str] = []
    text = f"{session.title} {session.description or ''}"

    # Pattern: KEP-1234 or KEP 1234
    kep_pattern = r"KEP[- ]?(\d+)"
    matches = re.findall(kep_pattern, text, re.IGNORECASE)
    for match in matches:
        keps.append(f"KEP-{match}")

    return list(set(keps))


# ============================================================================
# LLM Enrichment
# ============================================================================


class EnrichedSession(BaseModel):
    """Structured output for session enrichment."""

    summary: str = Field(
        description="1-2 sentence summary of what this session covers and why it matters to Kubernetes users/operators. Be detailed and specific, not generic."
    )
    labels: list[str] = Field(
        description="4-8 lowercase topic labels for categorization and discovery. Be thorough - include SIG labels (only if about K8s development), technology names, concepts, and session type labels."
    )
    session_type: str = Field(
        description="Session type: keynote, deep-dive, tutorial, lightning-talk, panel, case-study, workshop, maintainer-track, or general"
    )
    kep_references: list[str] | None = Field(
        default=None,
        description="KEP numbers mentioned or relevant (e.g., KEP-1287, KEP-4381). Use empty list if none."
    )
    affected_kinds: list[str] | None = Field(
        default=None,
        description="Kubernetes resource types discussed (e.g., Pod, Deployment, ResourceClaim). Use empty list if none."
    )


def create_session_enrichment_prompt(session: SchedSession, conference_name: str) -> str:
    """Create the prompt for enriching a session."""
    speakers = ", ".join(session.speakers) if session.speakers else "Unknown"
    categories = ", ".join(session.categories) if session.categories else "None"

    return f"""Analyze this KubeCon/CloudNativeCon session and extract metadata.

Conference: {conference_name}
Title: {session.title}
Speakers: {speakers}
Categories: {categories}

Description:
---
{session.description or "(No description)"}
---

Extract:

1. **summary**: 1-2 sentence summary of what this session covers and why it matters to Kubernetes users/operators.

2. **labels**: 4-8 lowercase topic labels for categorization and discovery.

   IMPORTANT GUIDELINES FOR LABELS:

   - **SIG labels** (sig-node, sig-network, sig-storage, sig-scheduling, sig-auth, sig-apps, etc.):
     ONLY use SIG labels when the session is:
     - A SIG maintainer session or SIG intro/deep-dive
     - Specifically about changes TO Kubernetes developed by that SIG
     - About features/KEPs owned by that SIG

     DO NOT use SIG labels just because a talk USES features from that SIG's area.
     Example: A talk about "deploying LLMs on Kubernetes with GPUs" should NOT get sig-node just because it uses nodes/GPUs.
     Example: A talk about "DRA improvements in 1.35" SHOULD get sig-node because DRA is a sig-node feature.

   - **Core K8s resources**: pod, deployment, service, statefulset, daemonset, job, configmap, secret, namespace, node, ingress, networkpolicy

   - **Features/Areas**: scheduling, networking, storage, security, observability, autoscaling, dra (dynamic resource allocation), gateway-api, service-mesh, rbac, pod-security

   - **Technologies/Projects**: ray, kuberay, istio, cilium, envoy, prometheus, grafana, argocd, flux, crossplane, kyverno, gatekeeper, cert-manager, knative, velero, helm, kustomize, etcd, containerd, ebpf

   - **AI/ML**: ai, ml, gpu, llm, inference, model-serving, vllm, ray, kuberay

   - **Data**: database, kafka, spark, data-pipeline, dbaas

   - **Concepts**: gitops, platform-engineering, multi-cluster, cost, finops, chaos-engineering, supply-chain, wasm

   - **Cloud Providers & Managed K8s**: aws, eks, gcp, gke, azure, aks, alibaba, ack, oracle, oke, ibm, digitalocean, openshift, rancher, tanzu
     Use these when the session specifically discusses a cloud provider's Kubernetes offering or cloud-specific features.

   - **Session type labels**: maintainer-track (for SIG/maintainer sessions), case-study, panel, deep-dive

3. **session_type**: Classify the session type:
   - keynote: Opening/closing keynotes, major announcements
   - deep-dive: Technical deep dives into specific topics
   - tutorial: Hands-on tutorials and workshops
   - lightning-talk: Short 5-10 minute talks
   - panel: Panel discussions with multiple speakers
   - case-study: Real-world implementation stories
   - workshop: Interactive hands-on sessions
   - maintainer-track: Project maintainer sessions, SIG meetings
   - general: General sessions that don't fit above

4. **kep_references**: KEP numbers mentioned or clearly relevant to the topic.
   - Format as KEP-XXXX (e.g., KEP-1287, KEP-4381)
   - Only include if explicitly mentioned or clearly the main topic

5. **affected_kinds**: Kubernetes resource types discussed.
   - Only include if the session specifically discusses these resources
   - Examples: Pod, Deployment, Service, ResourceClaim, Job, StatefulSet, Gateway, HTTPRoute

Be thorough with labels - they help users discover content. But be precise with SIG labels - only use them when the talk is about Kubernetes development/features, not just using Kubernetes."""


def enrich_session_with_llm(
    session: SchedSession,
    conference_name: str,
    agent,
) -> tuple[EnrichedSession | None, tuple[int, int]]:
    """Enrich a single session with LLM."""
    prompt = create_session_enrichment_prompt(session, conference_name)

    try:
        result = agent(prompt, structured_output_model=EnrichedSession)
        usage = get_result_usage(result)
        return result.structured_output, usage
    except Exception as e:
        log(f"  [ERROR] Enrichment failed for '{session.title[:40]}...': {e}")
        return None, (0, 0)


def enrich_sessions_batch(
    sessions: list[SchedSession],
    conference_name: str,
    provider: ProviderType | None = None,
    model_id: str | None = None,
    concurrency: int = 10,
) -> dict[str, EnrichedSession]:
    """
    Enrich multiple sessions with LLM in parallel.

    Args:
        sessions: List of sessions to enrich
        conference_name: Conference name for context
        provider: LLM provider override
        model_id: Model ID override
        concurrency: Number of concurrent requests

    Returns:
        Dict mapping session_id to EnrichedSession
    """
    import concurrent.futures
    import threading

    config = load_config()
    provider_name, provider_config = get_provider_config(config, provider)
    effective_model_id = get_effective_model_id(provider_config, model_id)

    log(f"\n[ENRICH] Enriching {len(sessions)} sessions with LLM")
    log(f"  Provider: {provider_name}, Model: {effective_model_id}")
    log(f"  Concurrency: {concurrency}")

    tracker = UsageTracker(effective_model_id)
    results: dict[str, EnrichedSession] = {}
    lock = threading.Lock()
    processed_count = 0

    def process_session(session: SchedSession) -> tuple[str, EnrichedSession | None, tuple[int, int]]:
        """Process a single session (thread-safe)."""
        # Create agent per thread (not thread-safe to share)
        agent = create_agent(
            provider_name,  # type: ignore
            provider_config,
            "You are a Kubernetes expert analyzing conference session content. "
            "When providing structured output, be thorough and detailed: write comprehensive summaries "
            "(not just rephrasing the title), and include ALL relevant topic labels (aim for 5-8). "
            "Your labels and summaries help users discover and understand content.",
            model_id,
        )

        result, usage = enrich_session_with_llm(session, conference_name, agent)
        return session.session_id, result, usage

    # Process with thread pool
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = {executor.submit(process_session, s): s for s in sessions}

        for future in concurrent.futures.as_completed(futures):
            session = futures[future]

            try:
                session_id, enriched, (in_tokens, out_tokens) = future.result()

                with lock:
                    processed_count += 1
                    tracker.add(in_tokens, out_tokens)

                    if enriched:
                        results[session_id] = enriched
                        labels_str = ", ".join(enriched.labels[:4])
                        log(f"  [{processed_count}/{len(sessions)}] {session.title[:40]}... → {labels_str}")
                    else:
                        log(f"  [{processed_count}/{len(sessions)}] {session.title[:40]}... [FAIL]")

            except Exception as e:
                with lock:
                    processed_count += 1
                    log(f"  [{processed_count}/{len(sessions)}] {session.title[:40]}... [ERROR] {e}")

    log(f"\n[DONE] Enriched {len(results)}/{len(sessions)} sessions")
    if tracker.total_input or tracker.total_output:
        log(f"[USAGE] {tracker.format_total()}")

    return results


def session_to_content_entry(
    session: SchedSession,
    conference_id: str,
    conference_date: str,
    enrichment: EnrichedSession | None = None,
) -> dict[str, Any]:
    """
    Convert a SchedSession to a content_links entry.

    Args:
        session: SchedSession object
        conference_id: Conference identifier
        conference_date: Conference start date
        enrichment: Optional LLM enrichment data

    Returns:
        Content entry dict
    """
    # Use enrichment data if available, otherwise fall back to rule-based extraction
    if enrichment:
        labels = list(enrichment.labels)
        keps = validate_kep_references(list(enrichment.kep_references or []))
        session_type = enrichment.session_type
        summary = enrichment.summary
    else:
        labels = extract_labels_from_session(session)
        keps = validate_kep_references(extract_keps_from_session(session))
        session_type = session.session_type
        # Create summary from first part of description
        summary = None
        if session.description:
            first_sentence = session.description.split(".")[0]
            summary = first_sentence[:200] if len(first_sentence) > 200 else first_sentence
            if summary and not summary.endswith("."):
                summary += "."

    # Add conference labels - both generic "kubecon" and specific "kubecon-na-2024"
    if conference_id.startswith("kubecon"):
        labels.append("kubecon")
    labels.append(conference_id)

    # Add session type label
    if session_type:
        labels.append(session_type)

    # Build links
    links: list[dict[str, Any]] = []
    for kep in keps:
        links.append({"targetType": "kep", "targetId": kep})

    # Add kind links if enrichment provided affected_kinds
    if enrichment and enrichment.affected_kinds:
        for kind in enrichment.affected_kinds:
            # Map common kinds to their API groups
            group = "core"
            if kind in ("Deployment", "StatefulSet", "DaemonSet", "ReplicaSet"):
                group = "apps"
            elif kind in ("Ingress", "NetworkPolicy"):
                group = "networking.k8s.io"
            elif kind in ("ResourceClaim", "ResourceClass", "DeviceClass"):
                group = "resource.k8s.io"
            elif kind in ("Job", "CronJob"):
                group = "batch"
            links.append({"targetType": "kind", "targetId": kind, "targetGroup": group})

    # Determine primary URL and content type
    # Priority: YouTube video > Sched page
    # For future conferences, use "scheduled" type instead of "reference"
    is_future = SCHED_CONFERENCES.get(conference_id, {}).get("future", False)

    # Build a nice source name from conference_id
    # e.g., "kubecon-eu-2026" -> "KubeCon EU 2026"
    def format_conference_source(conf_id: str) -> str:
        parts = conf_id.replace("-", " ").split()
        formatted = []
        for part in parts:
            if part.lower() == "kubecon":
                formatted.append("KubeCon")
            elif part.lower() in ("eu", "na"):
                formatted.append(part.upper())
            elif part.lower() == "china":
                formatted.append("China")
            else:
                formatted.append(part)
        return " ".join(formatted)

    if session.youtube_url:
        url = session.youtube_url
        content_type = "video"
        source = "youtube.com"
    else:
        url = session.session_url
        content_type = "scheduled" if is_future else "reference"
        source = format_conference_source(conference_id)

    if url and url.startswith("http://"):
        url = url.replace("http://", "https://")

    entry: dict[str, Any] = {
        "url": url,
        "title": session.title,
        "type": content_type,
        "source": source,
        "isOfficial": True,  # CNCF content
        "publishedDate": conference_date,
        "labels": list(set(labels)),
        "links": links,
    }

    if session.speakers:
        entry["author"] = ", ".join(session.speakers)
    if summary:
        entry["summary"] = summary
    if session.description:
        # Clean up description
        desc = session.description[:500]
        # Remove "Location: ..." prefix if present
        if desc.startswith("Location:"):
            desc = desc.split("\n", 1)[-1].strip()
        if desc:
            entry["description"] = desc

    # Add slides URL if available
    if session.slides_url:
        entry["slidesUrl"] = session.slides_url

    # Keep Sched URL as reference if we're using YouTube as primary
    if session.youtube_url and session.session_url:
        entry["schedUrl"] = session.session_url.replace("http://", "https://")

    # Add experience level if available
    if session.experience_level:
        entry["experienceLevel"] = session.experience_level

    return entry


def import_sched_sessions(
    conference_id: str,
    max_sessions: int | None = None,
    dry_run: bool = False,
    enrich: bool = True,
    scrape_media: bool = True,
    scrape_delay: float = 1.0,
    provider: ProviderType | None = None,
    model_id: str | None = None,
    concurrency: int = 10,
    force: bool = False,
) -> int:
    """
    Import sessions from a Sched.com conference into a conference-specific content file.

    Sessions are saved to content_links_{conference_id}.json (e.g., content_links_kubecon_na_2024.json).

    Args:
        conference_id: Conference identifier
        max_sessions: Maximum sessions to import
        dry_run: If True, don't save changes
        enrich: If True, use LLM to enrich sessions (default: True)
        scrape_media: If True, scrape YouTube/slides URLs from Sched pages (default: True)
        scrape_delay: Delay between scrape requests in seconds (default: 1.0)
        provider: LLM provider override
        model_id: Model ID override
        concurrency: Number of concurrent LLM requests
        force: If True, re-import existing sessions (update in place)

    Returns:
        Number of sessions imported
    """
    scraper = SchedScraper(conference_id=conference_id)

    sessions = scraper.scrape_all_sessions(max_sessions=max_sessions)

    if not sessions:
        log("  No sessions found")
        return 0

    config = SCHED_CONFERENCES[conference_id]

    # Load existing content from ALL files to check for duplicates
    all_data = load_all_content()
    existing_urls = {c["url"] for c in all_data.get("content", [])}
    # Also check schedUrl field (used when YouTube is primary URL)
    existing_sched_urls = {c.get("schedUrl") for c in all_data.get("content", []) if c.get("schedUrl")}
    # Also check for existing YouTube URLs
    existing_youtube = {c.get("url") for c in all_data.get("content", []) if "youtube.com" in c.get("url", "")}

    # Filter out sessions that already exist (by Sched URL in either url or schedUrl field)
    def is_new_session(s: SchedSession) -> bool:
        if not s.session_url:
            return False
        sched_url = s.session_url.replace("http://", "https://")
        return sched_url not in existing_urls and sched_url not in existing_sched_urls

    if force:
        new_sessions = [s for s in sessions if s.session_url]
        existing_count = len([s for s in new_sessions if not is_new_session(s)])
        log(f"  Force mode: re-importing all {len(new_sessions)} sessions ({existing_count} existing)")
    else:
        new_sessions = [s for s in sessions if is_new_session(s)]

    if not new_sessions:
        log(f"  All {len(sessions)} sessions already exist")
        return 0

    if not force:
        log(f"  {len(new_sessions)} new sessions to import (skipping {len(sessions) - len(new_sessions)} existing)")

    # Scrape YouTube/slides URLs and experience level from Sched pages
    if scrape_media and not dry_run:
        media_results = scrape_sessions_media_batch(new_sessions, delay=scrape_delay)

        # Update sessions with media URLs and experience level
        for session in new_sessions:
            youtube_url, slides_url, exp_level = media_results.get(session.session_id, (None, None, None))
            session.youtube_url = youtube_url
            session.slides_url = slides_url
            session.experience_level = exp_level

            # Skip if YouTube URL already exists
            if youtube_url and youtube_url in existing_youtube:
                log(f"    [SKIP] YouTube already exists: {session.title[:40]}...")

    # Enrich sessions with LLM if enabled
    enrichments: dict[str, EnrichedSession] = {}
    if enrich and not dry_run:
        try:
            enrichments = enrich_sessions_batch(
                new_sessions,
                config["name"],
                provider=provider,
                model_id=model_id,
                concurrency=concurrency,
            )
        except ImportError as e:
            log(f"  [WARN] LLM enrichment unavailable: {e}")
            log("  Falling back to rule-based extraction")
        except Exception as e:
            log(f"  [WARN] LLM enrichment failed: {e}")
            log("  Falling back to rule-based extraction")

    # Load conference-specific file for saving
    conf_file = get_content_file_for_conference(conference_id)
    conf_data = load_content(conf_file)

    added = 0
    videos = 0
    slides = 0

    for session in new_sessions:
        # Get enrichment if available
        enrichment = enrichments.get(session.session_id)

        entry = session_to_content_entry(
            session,
            conference_id,
            config["conference_date"],
            enrichment=enrichment,
        )

        # Skip if URL is empty
        if not entry["url"]:
            continue
        # Skip if already exists (unless force)
        if not force and (entry["url"] in existing_urls or entry["url"] in existing_youtube):
            continue

        if not dry_run:
            if force:
                # Replace existing entry in-place if found
                replaced = False
                sched_url = (session.session_url or "").replace("http://", "https://")
                content_list = conf_data.setdefault("content", [])
                for i, existing in enumerate(content_list):
                    if existing.get("url") == sched_url or existing.get("schedUrl") == sched_url:
                        content_list[i] = entry
                        replaced = True
                        break
                if not replaced:
                    content_list.append(entry)
            else:
                conf_data.setdefault("content", []).append(entry)
            existing_urls.add(entry["url"])

        added += 1
        if session.youtube_url:
            videos += 1
        if session.slides_url:
            slides += 1

        # Status markers
        video_marker = "🎬" if session.youtube_url else "○"
        enriched_marker = "✓" if enrichment else ""
        log(f"  {video_marker}{enriched_marker} {entry['title'][:55]}...")

    if not dry_run and added > 0:
        save_content(conf_data, conf_file)

    enriched_count = len(enrichments)
    verb = "Imported/updated" if force else "Imported"
    log(f"\n{verb} {added} sessions:")
    log(f"  - {videos} with YouTube videos")
    log(f"  - {slides} with slides PDFs")
    log(f"  - {enriched_count} enriched with LLM")
    return added


def list_available_conferences() -> None:
    """Print available conferences."""
    log("Available conferences:")
    for conf_id, info in SCHED_CONFERENCES.items():
        log(f"  {conf_id}")
        log(f"    {info['name']}")
        log(f"    {info['location']} ({info['conference_date']})")
        log(f"    {info['sched_url']}")
        log()


class LabelReview(BaseModel):
    """Structured output for label review."""

    labels: list[str] = Field(
        description="Corrected list of 4-8 lowercase topic labels"
    )
    removed_labels: list[str] = Field(
        default_factory=list,
        description="Labels that were incorrectly applied and should be removed"
    )
    reasoning: str = Field(
        description="Brief explanation of changes made"
    )


def create_label_review_prompt(entry: dict[str, Any]) -> str:
    """Create prompt for reviewing and fixing labels on an existing entry."""
    return f"""Review and fix the labels for this KubeCon session.

Title: {entry.get('title', '')}
Current Labels: {', '.join(entry.get('labels', []))}

Description:
---
{entry.get('description', entry.get('summary', '(No description)'))}
---

TASK: Review the current labels and fix any that are incorrectly applied.

IMPORTANT RULES FOR SIG LABELS (sig-node, sig-network, sig-storage, sig-scheduling, sig-auth, sig-apps, etc.):

SIG labels should ONLY be used when:
1. The session is a SIG maintainer session or SIG intro/deep-dive
2. The session is specifically about changes TO Kubernetes developed by that SIG
3. The session is about features/KEPs owned by that SIG

SIG labels should NOT be used just because a talk USES features from that SIG's area.

Examples:
- "Deploying LLMs on Kubernetes with GPUs" → NO sig-node (just uses nodes/GPUs)
- "DRA improvements in 1.35" → YES sig-node (DRA is a sig-node feature)
- "Running Ray on Kubernetes" → NO sig-node, NO sig-scheduling (just uses K8s)
- "SIG-Node: Intro and Deep Dive" → YES sig-node (it's a SIG session)
- "Gateway API conformance testing" → YES sig-network (Gateway API is sig-network)
- "Using Istio service mesh" → NO sig-network (just uses networking)

Return:
1. **labels**: The corrected list of labels (keep good ones, remove bad ones, add missing ones)
2. **removed_labels**: List of labels that were incorrectly applied
3. **reasoning**: Brief explanation of what you changed and why"""


def review_labels_batch(
    entries: list[dict[str, Any]],
    provider: ProviderType | None = None,
    model_id: str | None = None,
    concurrency: int = 10,
) -> dict[str, LabelReview]:
    """
    Review and fix labels for multiple entries in parallel.

    Args:
        entries: List of content entries to review
        provider: LLM provider override
        model_id: Model ID override
        concurrency: Number of concurrent requests

    Returns:
        Dict mapping entry URL to LabelReview
    """
    from concurrent.futures import ThreadPoolExecutor

    config = load_config()
    provider_name, provider_config = get_provider_config(config, provider)
    effective_model = get_effective_model_id(provider_config, model_id)

    log(f"\n[REVIEW] Reviewing labels for {len(entries)} sessions")
    log(f"  Provider: {provider_name}, Model: {effective_model}")
    log(f"  Concurrency: {concurrency}")

    results: dict[str, LabelReview] = {}
    usage_tracker = UsageTracker(effective_model)

    def review_single(entry: dict[str, Any], idx: int) -> tuple[str, LabelReview | None]:
        agent = create_agent(
            provider_name,  # type: ignore
            provider_config,
            "You are a Kubernetes expert reviewing conference session labels for accuracy.",
            model_id,
        )
        prompt = create_label_review_prompt(entry)

        try:
            result = agent(prompt, structured_output_model=LabelReview)
            usage = get_result_usage(result)
            usage_tracker.add(usage[0], usage[1])

            review = result.structured_output
            url = entry.get("url", "")

            # Log changes
            if review and review.removed_labels:
                log(f"  [{idx}] {entry['title'][:45]}...")
                log(f"      Removed: {', '.join(review.removed_labels)}")

            return url, review
        except Exception as e:
            log(f"  [ERROR] Review failed for '{entry.get('title', '')[:40]}...': {e}")
            return entry.get("url", ""), None

    # Run in parallel with thread pool
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [
            executor.submit(review_single, entry, i + 1)
            for i, entry in enumerate(entries)
        ]
        for future in futures:
            url, review = future.result()
            if review:
                results[url] = review

    log(f"\n[DONE] Reviewed {len(results)}/{len(entries)} sessions")
    log(f"[USAGE] {usage_tracker.format_total()}")

    return results


def re_enrich_sessions(
    conference_id: str,
    max_sessions: int | None = None,
    force: bool = False,
    dry_run: bool = False,
    provider: ProviderType | None = None,
    model_id: str | None = None,
    concurrency: int = 10,
) -> int:
    """
    Re-enrich existing sessions with LLM to update labels, summary, and links.

    Converts existing content entries back to SchedSession objects and runs them
    through the enrichment pipeline, then updates entries in-place.

    Args:
        conference_id: Conference identifier
        max_sessions: Maximum sessions to process
        force: If True, re-enrich all sessions; otherwise only unenriched ones
        dry_run: If True, don't save changes
        provider: LLM provider override
        model_id: Model ID override
        concurrency: Number of concurrent LLM requests

    Returns:
        Number of sessions updated
    """
    config = SCHED_CONFERENCES[conference_id]
    conf_file = get_content_file_for_conference(conference_id)
    conf_data = load_content(conf_file)

    entries = conf_data.get("content", [])
    if not entries:
        log(f"  No sessions found for {conference_id}")
        return 0

    # Select entries to re-enrich
    if force:
        to_enrich = entries
    else:
        # Only enrich entries that lack a summary (proxy for "not enriched")
        to_enrich = [e for e in entries if not e.get("summary")]

    if max_sessions:
        to_enrich = to_enrich[:max_sessions]

    if not to_enrich:
        log(f"  All {len(entries)} sessions already enriched (use --force to re-enrich)")
        return 0

    log(f"  {len(to_enrich)} sessions to enrich (of {len(entries)} total)")

    # Convert content entries back to SchedSession objects for the enrichment pipeline
    sessions: list[SchedSession] = []
    entry_by_session_id: dict[str, dict[str, Any]] = {}
    for entry in to_enrich:
        session_id = entry.get("url", "").split("/")[-1] or entry.get("url", "")
        session = SchedSession(
            session_id=session_id,
            title=entry.get("title", ""),
            speakers=entry.get("author", "").split(", ") if entry.get("author") else [],
            description=entry.get("description"),
            session_url=entry.get("schedUrl") or entry.get("url"),
        )
        sessions.append(session)
        entry_by_session_id[session_id] = entry

    # Run enrichment
    enrichments = enrich_sessions_batch(
        sessions,
        config["name"],
        provider=provider,
        model_id=model_id,
        concurrency=concurrency,
    )

    # Apply enrichments back to existing entries
    updated = 0
    for session in sessions:
        enrichment = enrichments.get(session.session_id)
        if not enrichment:
            continue

        entry = entry_by_session_id[session.session_id]

        # Rebuild labels: keep conference/type labels, replace enriched ones
        old_labels = set(entry.get("labels", []))
        # Preserve structural labels (conference, type)
        structural = {l for l in old_labels if l.startswith("kubecon") or l == conference_id}
        new_labels = set(enrichment.labels) | structural
        if enrichment.session_type:
            new_labels.add(enrichment.session_type)

        # Rebuild links from enrichment
        links: list[dict[str, Any]] = []
        # Keep non-KEP links (e.g., kind links will be rebuilt)
        keps = validate_kep_references(list(enrichment.kep_references or []))
        for kep in keps:
            links.append({"targetType": "kep", "targetId": kep})
        if enrichment.affected_kinds:
            for kind in enrichment.affected_kinds:
                group = "core"
                if kind in ("Deployment", "StatefulSet", "DaemonSet", "ReplicaSet"):
                    group = "apps"
                elif kind in ("Ingress", "NetworkPolicy"):
                    group = "networking.k8s.io"
                elif kind in ("ResourceClaim", "ResourceClass", "DeviceClass"):
                    group = "resource.k8s.io"
                elif kind in ("Job", "CronJob"):
                    group = "batch"
                links.append({"targetType": "kind", "targetId": kind, "targetGroup": group})

        if not dry_run:
            entry["labels"] = list(new_labels)
            entry["links"] = links
            if enrichment.summary:
                entry["summary"] = enrichment.summary

        updated += 1
        log(f"  ✓ {entry.get('title', '')[:55]}...")

    if not dry_run and updated > 0:
        save_content(conf_data, conf_file)
        log(f"\n[OK] Updated {updated} sessions in {conf_file}")

    return updated


def re_enrich_conference_labels(
    conference_id: str,
    max_sessions: int | None = None,
    dry_run: bool = False,
    provider: ProviderType | None = None,
    model_id: str | None = None,
    concurrency: int = 10,
) -> int:
    """
    Re-enrich existing sessions to fix labels.

    Args:
        conference_id: Conference identifier
        max_sessions: Maximum sessions to process
        dry_run: If True, don't save changes
        provider: LLM provider override
        model_id: Model ID override
        concurrency: Number of concurrent LLM requests

    Returns:
        Number of sessions updated
    """
    conf_file = get_content_file_for_conference(conference_id)
    conf_data = load_content(conf_file)

    entries = conf_data.get("content", [])
    if not entries:
        log(f"  No sessions found for {conference_id}")
        return 0

    # Filter to sessions that have SIG labels (most likely to need fixing)
    sig_entries = [
        e for e in entries
        if any(lbl.startswith("sig-") for lbl in e.get("labels", []))
    ]

    log(f"  Found {len(entries)} total sessions, {len(sig_entries)} with SIG labels")

    # Limit if requested
    to_review = sig_entries[:max_sessions] if max_sessions else sig_entries

    if not to_review:
        log("  No sessions with SIG labels to review")
        return 0

    # Review labels
    reviews = review_labels_batch(
        to_review,
        provider=provider,
        model_id=model_id,
        concurrency=concurrency,
    )

    # Apply changes
    updated = 0
    for entry in entries:
        url = entry.get("url", "")
        if url not in reviews:
            continue

        review = reviews[url]
        old_labels = set(entry.get("labels", []))
        new_labels = set(review.labels)

        if old_labels != new_labels:
            if not dry_run:
                entry["labels"] = list(new_labels)
            updated += 1

    if not dry_run and updated > 0:
        save_content(conf_data, conf_file)
        log(f"\n[OK] Updated {updated} sessions in {conf_file}")

    return updated


# ============================================================================
# KEP Linking for Content
# ============================================================================


class KEPMatch(BaseModel):
    """Structured output for KEP matching."""

    kep: str = Field(description="KEP identifier (e.g., KEP-1287)")
    confidence: float = Field(default=0.8, description="Confidence score 0.0-1.0")
    reason: str = Field(default="Related to session topic", description="Brief reason for the match")


class ContentKEPLinks(BaseModel):
    """Structured output for content-to-KEP linking."""

    kep_matches: list[KEPMatch] = Field(
        default_factory=list,
        description="List of KEPs that are relevant to this content"
    )


def create_kep_linking_prompt(
    content: dict[str, Any],
    keps: list[dict[str, Any]],
) -> str:
    """Create prompt for linking content to KEPs."""

    # Format content info
    content_info = f"""
Title: {content.get('title', 'Unknown')}
Type: {content.get('type', 'Unknown')}
Labels: {', '.join(content.get('labels', []))}
Summary: {content.get('summary', 'N/A')}
Description: {content.get('description', 'N/A')[:500]}
"""

    # Format KEP list (compact)
    kep_list = []
    for kep in keps:
        kep_id = kep.get("kep", kep.get("id", ""))  # Try both field names
        title = kep.get("title", "")
        labels = kep.get("labels", [])
        kinds = kep.get("affected_kinds", [])
        if not kep_id:
            continue  # Skip KEPs without ID
        kep_list.append(f"- {kep_id}: {title}")
        if labels:
            kep_list.append(f"  Labels: {', '.join(labels[:5])}")
        if kinds:
            kep_list.append(f"  Kinds: {', '.join(kinds[:5])}")

    keps_text = "\n".join(kep_list)

    return f"""You are matching KubeCon sessions to Kubernetes Enhancement Proposals (KEPs).

KEPs are SPECIFIC KUBERNETES API/IMPLEMENTATION CHANGES. A session must be SPECIFICALLY ABOUT the KEP's Kubernetes implementation to match.

## Session
{content_info}

## Available KEPs
{keps_text}

## CRITICAL: What Makes a Valid Match

A valid match requires the session to be SPECIFICALLY about the KEP's Kubernetes implementation:

✅ VALID matches:
- "In-Place Pod Resizing" session → KEP-1287 (In-place Update of Pod Resources) - session IS about this exact K8s feature
- "Dynamic Resource Allocation Deep Dive" → KEP-4381 (DRA) - session IS about this exact K8s feature
- "SIG-Node: What's New" discussing specific KEPs by number → those KEPs

❌ INVALID matches (DO NOT MAKE THESE):
- "TAG-Runtime Overview" mentioning CDI → KEP-4009 (CDI in Device Plugin) - session is about CNCF TAG, not the K8s KEP
- "Multi-cluster Observability" → any KEP - session is about using K8s, not K8s development
- "Platform Engineering Best Practices" → any KEP - session is about using K8s, not K8s development
- "Kubernetes Security" → random security KEPs - too vague
- Session mentions "scheduling" → all scheduling KEPs - keyword match is NOT enough
- Session about a CNCF project (Prometheus, Envoy, etc.) → K8s KEPs - different projects
- Session about using K8s features → KEPs for those features - using != developing

## The Key Question

Ask yourself: "Is this session about DEVELOPING/IMPLEMENTING this specific Kubernetes feature, or just USING Kubernetes?"

- If USING Kubernetes → NO MATCH (even if they use features from KEPs)
- If about a CNCF project that's not Kubernetes → NO MATCH
- If about Kubernetes DEVELOPMENT of this specific feature → MATCH

## Rules

1. ONLY match if the session is SPECIFICALLY about the KEP's Kubernetes implementation
2. Mentioning a technology (CDI, DRA, scheduling) is NOT enough - must be about the K8s KEP specifically
3. Maximum 1-2 KEPs per session (most sessions match ZERO)
4. Minimum confidence 0.90 (be very conservative)
5. When in doubt, return EMPTY list - false negatives are fine, false positives are not

Return matches with:
- kep: KEP identifier (e.g., "KEP-1287")
- confidence: 0.90-1.0 only
- reason: Explain the SPECIFIC connection to the K8s implementation (not vague)

Most sessions will NOT match any KEPs. Return empty list unless you're confident."""


def link_content_to_keps_batch(
    content_items: list[dict[str, Any]],
    keps: list[dict[str, Any]],
    provider: ProviderType | None = None,
    model_id: str | None = None,
    concurrency: int = 10,
) -> dict[str, list[KEPMatch]]:
    """
    Link content items to KEPs using LLM.

    Args:
        content_items: List of content items to process
        keps: List of KEPs to match against
        provider: LLM provider override
        model_id: Model ID override
        concurrency: Number of concurrent requests

    Returns:
        Dict mapping content URL to list of KEP matches
    """
    from concurrent.futures import ThreadPoolExecutor

    config = load_config()
    provider_name, provider_config = get_provider_config(config, provider)
    effective_model_id = get_effective_model_id(provider_config, model_id)

    log(f"\n[LINK] Linking {len(content_items)} content items to {len(keps)} KEPs")
    log(f"  Provider: {provider_name}, Model: {effective_model_id}")
    log(f"  Concurrency: {concurrency}")

    usage_tracker = UsageTracker(effective_model_id)
    results: dict[str, list[KEPMatch]] = {}

    def link_single(content: dict[str, Any], idx: int) -> tuple[str, list[KEPMatch]]:
        """Link a single content item to KEPs."""
        agent = create_agent(
            provider_name,  # type: ignore
            provider_config,
            "You are a Kubernetes expert matching content to KEPs.",
            model_id,
        )

        prompt = create_kep_linking_prompt(content, keps)

        try:
            result = agent(prompt, structured_output_model=ContentKEPLinks)
            usage = get_result_usage(result)
            usage_tracker.add(usage[0], usage[1])

            links = result.structured_output
            url = content.get("url", "")

            # Filter to high confidence matches (0.90+ for stricter matching)
            matches = [m for m in links.kep_matches if m.confidence >= 0.90]

            if matches:
                kep_ids = [m.kep for m in matches]
                log(f"  [{idx}] {content['title'][:45]}... → {', '.join(kep_ids)}")

            return url, matches
        except Exception as e:
            log(f"  [ERROR] Linking failed for '{content.get('title', '')[:40]}...': {e}")
            return content.get("url", ""), []

    # Run in parallel
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [
            executor.submit(link_single, item, i + 1)
            for i, item in enumerate(content_items)
        ]
        for future in futures:
            url, matches = future.result()
            if matches:
                results[url] = matches

    log(f"\n[DONE] Linked {len(results)}/{len(content_items)} content items to KEPs")
    log(f"[USAGE] {usage_tracker.format_total()}")

    return results


def link_conference_to_keps(
    conference_id: str,
    max_items: int | None = None,
    dry_run: bool = False,
    force: bool = False,
    provider: ProviderType | None = None,
    model_id: str | None = None,
    concurrency: int = 10,
    min_confidence: float = 0.90,
) -> int:
    """
    Link conference content to KEPs using LLM.

    Args:
        conference_id: Conference identifier
        max_items: Maximum items to process
        dry_run: If True, don't save changes
        force: If True, re-process items that already have KEP links (removes old links)
        provider: LLM provider override
        model_id: Model ID override
        concurrency: Number of concurrent LLM requests
        min_confidence: Minimum confidence for KEP links

    Returns:
        Number of content items updated
    """
    import json

    # Load conference content
    conf_file = get_content_file_for_conference(conference_id)
    conf_data = load_content(conf_file)

    entries = conf_data.get("content", [])
    if not entries:
        log(f"  No content found for {conference_id}")
        return 0

    if force:
        # Process all entries, removing existing KEP links first
        log(f"  [FORCE] Will re-process all {len(entries)} items (removing existing KEP links)")
        to_process = entries[:max_items] if max_items else entries

        # Remove existing KEP links from entries we'll process
        removed_count = 0
        for entry in to_process:
            entry_links = entry.get("links", [])
            old_kep_links = [lnk for lnk in entry_links if lnk.get("targetType") == "kep"]
            if old_kep_links:
                for link in old_kep_links:
                    log(f"  [DROP] {link.get('targetId')} from '{entry.get('title', '')[:40]}...'")
                    removed_count += 1
            entry["links"] = [lnk for lnk in entry_links if lnk.get("targetType") != "kep"]

        if removed_count > 0:
            log(f"  [FORCE] Removed {removed_count} existing KEP links")
    else:
        # Filter to items without KEP links
        no_kep_entries = [
            e for e in entries
            if not any(
                link.get("targetType") == "kep"
                for link in e.get("links", [])
            )
        ]
        log(f"  Found {len(entries)} total items, {len(no_kep_entries)} without KEP links")
        to_process = no_kep_entries[:max_items] if max_items else no_kep_entries

    if not to_process:
        log("  No items to process")
        return 0

    # Load KEPs from kep_metadata.json
    kep_file = CURATED_KEPS_DIR / "kep_metadata.json"
    if not kep_file.exists():
        log(f"  [ERROR] KEP metadata not found: {kep_file}")
        log("  Run 'uv run k8s-pipeline extract-kep-metadata' first")
        return 0

    with open(kep_file) as f:
        kep_data = json.load(f)

    # Build KEP list with IDs included in each entry
    keps_dict = kep_data.get("keps", {})
    keps = []
    for kep_id, kep_value in keps_dict.items():
        kep_entry = dict(kep_value)
        kep_entry["kep"] = kep_id  # Add the ID to the entry
        keps.append(kep_entry)
    log(f"  Loaded {len(keps)} KEPs from metadata")

    # Build set of valid KEP IDs for validation
    valid_kep_ids = set(keps_dict.keys())
    log(f"  Valid KEP IDs: {len(valid_kep_ids)}")

    # Link content to KEPs
    links = link_content_to_keps_batch(
        to_process,
        keps,
        provider=provider,
        model_id=model_id,
        concurrency=concurrency,
    )

    # Apply changes (with validation)
    updated = 0
    hallucinated = 0
    for entry in entries:
        url = entry.get("url", "")
        if url not in links:
            continue

        matches = links[url]
        if not matches:
            continue

        # Add KEP links
        entry_links = entry.get("links", [])
        for match in matches:
            if match.confidence >= min_confidence:
                # Validate KEP exists
                if match.kep not in valid_kep_ids:
                    hallucinated += 1
                    log(f"  [SKIP] Hallucinated KEP: {match.kep}")
                    continue

                kep_link = {
                    "targetType": "kep",
                    "targetId": match.kep,
                    "confidence": match.confidence,
                    "reason": match.reason,
                }
                # Check if already exists (by targetType + targetId)
                existing = next(
                    (lnk for lnk in entry_links
                     if lnk.get("targetType") == "kep" and lnk.get("targetId") == match.kep),
                    None
                )
                if not existing:
                    if not dry_run:
                        entry_links.append(kep_link)
                    updated += 1

        if not dry_run:
            entry["links"] = entry_links

    if hallucinated > 0:
        log(f"\n[WARN] Filtered out {hallucinated} hallucinated KEP references")

    # Save if we made changes (either added new links or removed old ones with --force)
    if not dry_run and (updated > 0 or force):
        save_content(conf_data, conf_file)
        if force:
            log(f"\n[OK] Re-processed {len(to_process)} items, added {updated} KEP links to {conf_file}")
        else:
            log(f"\n[OK] Added {updated} KEP links to {conf_file}")

    return updated


def validate_kep_links(
    conference_id: str | None = None,
    dry_run: bool = False,
) -> tuple[int, int]:
    """
    Validate and remove invalid KEP links from content files.

    Args:
        conference_id: Conference to validate, or None for all
        dry_run: If True, don't save changes

    Returns:
        Tuple of (total_removed, total_valid)
    """
    import json

    # Load valid KEPs
    kep_file = CURATED_KEPS_DIR / "kep_metadata.json"
    if not kep_file.exists():
        log(f"[ERROR] KEP metadata not found: {kep_file}")
        return 0, 0

    with open(kep_file) as f:
        kep_data = json.load(f)

    valid_kep_ids = set(kep_data.get("keps", {}).keys())
    log(f"Loaded {len(valid_kep_ids)} valid KEP IDs")

    # Get files to process
    if conference_id:
        files = [get_content_file_for_conference(conference_id)]
    else:
        files = list(CURATED_CONTENT_DIR.glob("content_links_kubecon_*.json"))

    total_removed = 0
    total_valid = 0

    for conf_file in files:
        if not conf_file.exists():
            continue

        conf_data = load_content(conf_file)
        entries = conf_data.get("content", [])
        file_removed = 0
        file_valid = 0

        for entry in entries:
            entry_links = entry.get("links", [])
            new_links = []

            for link in entry_links:
                if link.get("targetType") == "kep":
                    kep_id = link.get("targetId", "")
                    if kep_id in valid_kep_ids:
                        new_links.append(link)
                        file_valid += 1
                    else:
                        file_removed += 1
                        log(f"  [REMOVE] {kep_id} from '{entry.get('title', '')[:40]}...'")
                else:
                    new_links.append(link)

            if not dry_run:
                entry["links"] = new_links

        if file_removed > 0:
            log(f"\n{conf_file.name}: removed {file_removed}, kept {file_valid}")
            if not dry_run:
                save_content(conf_data, conf_file)

        total_removed += file_removed
        total_valid += file_valid

    log(f"\n[DONE] Removed {total_removed} invalid KEP links, kept {total_valid} valid")
    return total_removed, total_valid
