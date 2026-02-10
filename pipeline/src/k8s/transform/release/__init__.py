"""Release data building and changelog parsing.

Public API:
- build_release, build_all_releases, build_release_index
- parse_changelog, enrich_changes, enrich_release_notes
- load_release, save_release
"""

from .builder import (
    build_all_releases,
    build_release,
    build_release_index,
)
from .change_enricher import (
    ENRICHABLE_KINDS,
    EnrichedChange,
    enrich_changes,
    enrich_changes_batch,
    enrich_single_change,
    load_release,
    save_release,
)
from .changelog_parser import (
    ActionRequiredNote,
    ChangeEntry,
    CVEEntry,
    ParsedChangelog,
    PatchRelease,
    changelog_to_dict,
    parse_changelog,
)
from .release_notes_enricher import (
    DeprecationEnrichment,
    UrgentNoteEnrichment,
    enrich_deprecation,
    enrich_release_notes,
    enrich_urgent_note,
)

# Public API - minimal surface for CLI
__all__ = [
    # Core operations
    "build_release",
    "build_all_releases",
    "build_release_index",
    "parse_changelog",
    "enrich_changes",
    "enrich_release_notes",
    "load_release",
    "save_release",
    # Types
    "ParsedChangelog",
]
