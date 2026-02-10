"""Content management modules (content links, conference talks, YouTube, Sched).

Public API:
- add_content, load_content, save_content, flatten_content_for_export
- add_conference_talk, import_sched_sessions, import_youtube_videos
- suggest_labels_llm, suggest_labels_embedding, build_taxonomy
"""

from .content_links import (
    Content,
    ContentLink,
    ContentType,
    add_content,
    flatten_content_for_export,
    get_all_labels,
    get_content_by_label,
    get_content_file_for_conference,
    get_content_for_field,
    get_content_for_kep,
    get_content_for_kind,
    get_content_for_release,
    get_official_content_for_release,
    list_all_content,
    list_content_files,
    load_all_content,
    load_content,
    save_content,
    split_content_by_conference,
)
from .conference_ingest import (
    CONFERENCES,
    ConferenceTalk,
    add_conference_talk,
    add_talks_batch,
    enrich_talk_with_llm,
    get_talks_by_topic,
    import_from_json,
    list_conference_content,
)
from .label_suggester import (
    LabelComparison,
    LabelSuggestion,
    compare_labelers,
    print_comparison,
    suggest_labels_embedding,
    suggest_labels_llm,
)
from .sched_fetcher import (
    SCHED_CONFERENCES,
    EnrichedSession,
    SchedScraper,
    SchedSession,
    extract_keps_from_session,
    extract_labels_from_session,
    import_sched_sessions,
    link_conference_to_keps,
    list_available_conferences,
    re_enrich_conference_labels,
    session_to_content_entry,
    validate_kep_links,
)
from .taxonomy_builder import (
    build_taxonomy,
    get_taxonomy,
    load_taxonomy,
    save_taxonomy,
)
from .youtube_fetcher import (
    YOUTUBE_PLAYLISTS,
    YouTubeVideo,
    fetch_playlist_videos,
    import_youtube_videos,
    list_available_playlists,
)

# Public API - minimal surface for CLI
__all__ = [
    # Content CRUD
    "add_content",
    "load_content",
    "load_all_content",
    "save_content",
    "flatten_content_for_export",
    # Conference import
    "add_conference_talk",
    "import_sched_sessions",
    "import_youtube_videos",
    # Labels
    "suggest_labels_llm",
    "suggest_labels_embedding",
    "build_taxonomy",
    # Types
    "Content",
    "ContentLink",
    "ContentType",
]
