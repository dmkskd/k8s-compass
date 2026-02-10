"""Core shared modules for the K8s pipeline."""

from .config import (
    CACHE_DIR,
    CLUSTER_SCOPED_KINDS,
    DATA_ROOT,
    GROUP_COLORS,
    GROUP_DISPLAY_NAMES,
    K8S_VERSIONS,
    KIND_DOCS_URLS,
    OPENAPI_URL_TEMPLATE,
    OUTPUT_DIR,
    PIPELINE_DATA_DIR,
    PIPELINE_ROOT,
    REPO_ROOT,
    REPOS_DIR,
)
from .models import (
    APIGroup,
    APITree,
    APIVersion,
    Kind,
    KindSchema,
    Relationship,
    SchemaProperty,
    VersionInfo,
)

__all__ = [
    # Config
    "K8S_VERSIONS",
    "OPENAPI_URL_TEMPLATE",
    "REPO_ROOT",
    "DATA_ROOT",
    "OUTPUT_DIR",
    "PIPELINE_ROOT",
    "PIPELINE_DATA_DIR",
    "CACHE_DIR",
    "REPOS_DIR",
    "GROUP_COLORS",
    "GROUP_DISPLAY_NAMES",
    "CLUSTER_SCOPED_KINDS",
    "KIND_DOCS_URLS",
    # Models
    "Relationship",
    "Kind",
    "APIVersion",
    "APIGroup",
    "APITree",
    "VersionInfo",
    "SchemaProperty",
    "KindSchema",
]
