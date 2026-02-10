"""Pydantic models for K8s API data structures."""

from pydantic import BaseModel


class Relationship(BaseModel):
    """A relationship between two Kubernetes kinds."""

    type: str  # owns, selects, references, mounts, configures
    target_kind: str
    target_group: str
    description: str
    field_path: str | None = None


class Kind(BaseModel):
    """A Kubernetes Kind (e.g., Pod, Deployment)."""

    name: str
    singular_name: str
    plural_name: str
    scope: str  # Namespaced or Cluster
    short_names: list[str] = []
    categories: list[str] = []
    schema_ref: str
    field_count: int
    description: str = ""
    relationships: list[Relationship] = []
    docs_url: str | None = None  # Link to official K8s documentation


class APIVersion(BaseModel):
    """An API version within a group (e.g., v1, v1beta1)."""

    name: str
    is_preferred: bool
    kinds: list[Kind]


class APIGroup(BaseModel):
    """An API group (e.g., apps, core, networking.k8s.io)."""

    name: str
    display_name: str
    description: str
    color: str
    versions: list[APIVersion]


class APITree(BaseModel):
    """The complete API tree for a Kubernetes version."""

    version: str
    release_date: str
    groups: list[APIGroup]


class VersionInfo(BaseModel):
    """Information about a Kubernetes version."""

    version: str
    release_date: str
    end_of_life: str | None = None
    is_latest: bool = False


class Feature(BaseModel):
    """A KEP feature in a release."""

    kep: str  # e.g., "KEP-1287"
    kep_path: str | None = None
    title: str
    stage: str  # alpha, beta, stable
    sig: str
    category: str  # High-level category (Workloads, Networking, etc.)
    labels: list[str] = []  # Fine-grained topic labels (numa, cpu-manager, dra, etc.)
    description: str = ""
    impact: str | None = None
    feature_gate: str | None = None
    affected_kinds: list[str] = []
    affected_fields: list[str] = []
    history: dict[str, str | list[str]] = {}


class SchemaProperty(BaseModel):
    """A property in a K8s resource schema."""

    name: str
    path: str
    type: str  # string, integer, number, boolean, object, array, map, intOrString
    description: str = ""
    required: bool = False
    default: str | int | bool | None = None
    enum: list[str] | None = None
    minimum: int | None = None
    maximum: int | None = None
    pattern: str | None = None
    properties: list["SchemaProperty"] | None = None
    items: "SchemaProperty | None" = None
    ref_kind: str | None = None  # Referenced K8s type, e.g., "PodTemplateSpec"


class KindSchema(BaseModel):
    """Full schema for a Kubernetes Kind."""

    group: str
    version: str
    kind: str
    description: str
    properties: list[SchemaProperty]
