"""Input modules for fetching and staging upstream data."""

from .repo_manager import (
    DEFAULT_REPOS,
    REPOS,
    checkout_version,
    clone_repo,
    get_repo_path,
    get_repo_status,
    list_repos,
    pull_repo,
    reset_to_default_branch,
    sync_repos,
)
from .upstream_stager import (
    CHANGELOGS_DIR,
    PIPELINE_ROOT,
    RELEASE_NOTES_DIR,
    UPSTREAM_DIR,
    get_changelog_path,
    get_release_notes_path,
    get_staging_status,
    is_changelog_staged,
    is_release_notes_staged,
    stage_all_releases,
    stage_release,
)

__all__ = [
    # upstream_stager
    "stage_release",
    "stage_all_releases",
    "get_staging_status",
    "is_release_notes_staged",
    "is_changelog_staged",
    "get_release_notes_path",
    "get_changelog_path",
    "UPSTREAM_DIR",
    "RELEASE_NOTES_DIR",
    "CHANGELOGS_DIR",
    "PIPELINE_ROOT",
    # repo_manager
    "REPOS",
    "DEFAULT_REPOS",
    "sync_repos",
    "list_repos",
    "get_repo_path",
    "checkout_version",
    "reset_to_default_branch",
    "clone_repo",
    "pull_repo",
    "get_repo_status",
]
