"""Parse Kubernetes OpenAPI specs into structured data.

Loads OpenAPI specs from the local kubernetes repo clone (pipeline/repos/kubernetes/)
and parses them into APITree structures for the frontend.
"""

import json
from collections import defaultdict

import httpx
from rich.console import Console

from ...core.config import (
    CACHE_DIR,
    CLUSTER_SCOPED_KINDS,
    GROUP_COLORS,
    GROUP_DISPLAY_NAMES,
    KIND_DOCS_URLS,
    OPENAPI_URL_TEMPLATE,
)
from ...core.models import APIGroup, APITree, APIVersion, Kind, Relationship
from ...input.repo_manager import checkout_version, get_repo_path, reset_to_default_branch

console = Console()

# Path to OpenAPI spec within the kubernetes repo
OPENAPI_SPEC_PATH = "api/openapi-spec/swagger.json"


def load_openapi_spec(version: str, use_cache: bool = True) -> dict:
    """
    Load the OpenAPI spec for a Kubernetes version.

    Strategy:
    1. Check cache first (if use_cache=True)
    2. Try loading from local kubernetes repo (if cloned)
    3. Fall back to fetching from GitHub

    Args:
        version: K8s version (e.g., "1.30")
        use_cache: Whether to use cached spec if available

    Returns:
        The OpenAPI spec as a dictionary
    """
    cache_path = CACHE_DIR / f"openapi-{version}.json"

    # Check cache first
    if use_cache and cache_path.exists():
        console.print(f"  [dim]Using cached spec for {version}[/dim]")
        return json.loads(cache_path.read_text())

    # Try local repo first
    spec = _load_from_local_repo(version)
    if spec:
        _cache_spec(spec, cache_path)
        return spec

    # Fall back to GitHub
    spec = _fetch_from_github(version)
    _cache_spec(spec, cache_path)
    return spec


def _load_from_local_repo(version: str) -> dict | None:
    """Load OpenAPI spec from local kubernetes repo clone."""
    from ...input.repo_manager import get_current_ref

    repo_path = get_repo_path("kubernetes")

    if not repo_path.exists():
        console.print("  [dim]Local repo not found, will fetch from GitHub[/dim]")
        return None

    # Checkout the correct version
    if not checkout_version("kubernetes", version, quiet=True):
        console.print(f"  [yellow]Could not checkout {version}, falling back to GitHub[/yellow]")
        return None

    spec_path = repo_path / OPENAPI_SPEC_PATH

    if not spec_path.exists():
        console.print(f"  [yellow]OpenAPI spec not found at {spec_path}[/yellow]")
        reset_to_default_branch("kubernetes")
        return None

    # Log the current git ref for traceability
    current_ref = get_current_ref("kubernetes")
    console.print(f"  [blue]Loading OpenAPI spec for {version} from local repo...[/blue]")
    console.print(f"  [dim]kubernetes repo at: {current_ref}[/dim]")

    try:
        spec = json.loads(spec_path.read_text())
        console.print(f"  [green]✓ Loaded {version} from local repo[/green]")
        return spec
    except json.JSONDecodeError as e:
        console.print(f"  [red]Failed to parse OpenAPI spec: {e}[/red]")
        return None


def _fetch_from_github(version: str) -> dict:
    """Fetch OpenAPI spec from GitHub (fallback)."""
    url = OPENAPI_URL_TEMPLATE.format(version=version)
    console.print(f"  [blue]Fetching OpenAPI spec for {version} from GitHub...[/blue]")

    try:
        with httpx.Client(timeout=60.0) as client:
            response = client.get(url)
            response.raise_for_status()
            spec = response.json()
    except httpx.HTTPStatusError as e:
        console.print(f"  [red]Failed to fetch {version}: HTTP {e.response.status_code}[/red]")
        raise
    except Exception as e:
        console.print(f"  [red]Failed to fetch {version}: {e}[/red]")
        raise

    console.print(f"  [green]✓ Fetched {version} from GitHub[/green]")
    return spec


def _cache_spec(spec: dict, cache_path) -> None:
    """Cache the OpenAPI spec to disk."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(spec))


def clear_openapi_cache() -> None:
    """Clear the OpenAPI spec cache."""
    if CACHE_DIR.exists():
        for f in CACHE_DIR.glob("openapi-*.json"):
            f.unlink()
        console.print("[yellow]OpenAPI cache cleared[/yellow]")


def parse_openapi_spec(spec: dict, version: str) -> APITree:
    """Parse an OpenAPI spec into an APITree structure."""
    definitions = spec.get("definitions", {})
    groups_data: dict[str, dict[str, list[Kind]]] = defaultdict(lambda: defaultdict(list))

    for def_name, definition in definitions.items():
        gvk_list = definition.get("x-kubernetes-group-version-kind", [])
        if not gvk_list:
            continue

        gvk = gvk_list[0]
        group = gvk.get("group", "") or "core"
        api_version = gvk.get("version", "")
        kind_name = gvk.get("kind", "")

        if not kind_name or not api_version:
            continue
        if "List" in kind_name and kind_name.endswith("List"):
            continue
        if "Options" in kind_name:
            continue

        kind = parse_kind(def_name, definition, group, api_version, kind_name, version, definitions)
        if kind:
            groups_data[group][api_version].append(kind)

    api_groups = []
    for group_name in sorted(groups_data.keys()):
        versions_data = groups_data[group_name]
        api_versions = []
        for ver_name in sorted(versions_data.keys(), reverse=True):
            kinds = sorted(versions_data[ver_name], key=lambda k: k.name)
            is_preferred = ver_name == sorted(versions_data.keys(), reverse=True)[0]
            api_versions.append(APIVersion(name=ver_name, is_preferred=is_preferred, kinds=kinds))

        if api_versions:
            api_groups.append(
                APIGroup(
                    name=group_name,
                    display_name=GROUP_DISPLAY_NAMES.get(
                        group_name, group_name.split(".")[0].title()
                    ),
                    description=get_group_description(group_name),
                    color=GROUP_COLORS.get(group_name, "#64748B"),
                    versions=api_versions,
                )
            )

    api_groups.sort(key=lambda g: (0 if g.name == "core" else 1, g.name))
    return APITree(version=version, release_date=get_release_date(version), groups=api_groups)


def parse_kind(
    def_name: str,
    definition: dict,
    group: str,
    api_version: str,
    kind_name: str,
    k8s_version: str,
    all_definitions: dict,
) -> Kind | None:
    """Parse a single Kind from its OpenAPI definition."""
    field_count = count_fields(definition, all_definitions)
    scope = "Cluster" if kind_name in CLUSTER_SCOPED_KINDS else "Namespaced"
    description = definition.get("description", "")
    relationships = infer_relationships(definition, kind_name, all_definitions)

    return Kind(
        name=kind_name,
        singular_name=kind_name.lower(),
        plural_name=get_plural_name(kind_name),
        scope=scope,
        short_names=get_short_names(kind_name),
        categories=get_categories(kind_name),
        schema_ref=f"/schemas/{k8s_version}/{group}/{kind_name}.json",
        field_count=field_count,
        description=description[:500] if description else "",
        relationships=relationships,
        docs_url=KIND_DOCS_URLS.get(kind_name),
    )


def count_fields(
    definition: dict, all_definitions: dict, depth: int = 0, seen: set | None = None
) -> int:
    """Count the total number of fields in a definition, recursively."""
    if depth > 8:
        return 0
    if seen is None:
        seen = set()

    count = 0
    properties = definition.get("properties", {})

    for prop_name, prop in properties.items():
        if depth == 0 and prop_name in ("apiVersion", "kind", "metadata"):
            continue
        count += 1

        ref = prop.get("$ref")
        if ref and ref not in seen:
            seen.add(ref)
            ref_def = resolve_ref(ref, all_definitions)
            if ref_def:
                count += count_fields(ref_def, all_definitions, depth + 1, seen)

        if "properties" in prop:
            count += count_fields(prop, all_definitions, depth + 1, seen)

        items = prop.get("items", {})
        if items:
            item_ref = items.get("$ref")
            if item_ref and item_ref not in seen:
                seen.add(item_ref)
                ref_def = resolve_ref(item_ref, all_definitions)
                if ref_def:
                    count += count_fields(ref_def, all_definitions, depth + 1, seen)
            elif "properties" in items:
                count += count_fields(items, all_definitions, depth + 1, seen)

    return count


def resolve_ref(ref: str, all_definitions: dict) -> dict | None:
    """Resolve a $ref to its definition."""
    if not ref.startswith("#/definitions/"):
        return None
    def_name = ref[14:]
    return all_definitions.get(def_name)


def infer_relationships(
    definition: dict, kind_name: str, all_definitions: dict
) -> list[Relationship]:
    """Infer relationships from the schema structure."""
    relationships = []

    relationship_patterns = {
        ("Pod", "spec.volumes[].configMap"): (
            "mounts",
            "ConfigMap",
            "core",
            "Mounts ConfigMaps as volumes",
        ),
        ("Pod", "spec.volumes[].secret"): ("mounts", "Secret", "core", "Mounts Secrets as volumes"),
        ("Pod", "spec.volumes[].persistentVolumeClaim"): (
            "mounts",
            "PersistentVolumeClaim",
            "core",
            "Mounts PVCs as volumes",
        ),
        ("Pod", "spec.serviceAccountName"): (
            "references",
            "ServiceAccount",
            "core",
            "Runs as ServiceAccount",
        ),
        ("Pod", "spec.nodeName"): ("references", "Node", "core", "Scheduled to Node"),
        ("Pod", "spec.priorityClassName"): (
            "references",
            "PriorityClass",
            "scheduling.k8s.io",
            "Uses PriorityClass",
        ),
        ("PodTemplate", "template"): (
            "owns",
            "Pod",
            "core",
            "Defines Pod template for creating copies",
        ),
        ("Service", "spec.selector"): (
            "selects",
            "Pod",
            "core",
            "Routes traffic to Pods via label selector",
        ),
        ("Deployment", "spec.template"): (
            "owns",
            "ReplicaSet",
            "apps",
            "Creates and manages ReplicaSets",
        ),
        ("ReplicaSet", "spec.template"): ("owns", "Pod", "core", "Creates and manages Pods"),
        ("StatefulSet", "spec.template"): ("owns", "Pod", "core", "Creates ordered, sticky Pods"),
        ("StatefulSet", "spec.volumeClaimTemplates"): (
            "owns",
            "PersistentVolumeClaim",
            "core",
            "Creates PVCs from templates",
        ),
        ("StatefulSet", "spec.serviceName"): (
            "references",
            "Service",
            "core",
            "Requires headless Service",
        ),
        ("DaemonSet", "spec.template"): ("owns", "Pod", "core", "Runs Pod on each node"),
        ("Job", "spec.template"): ("owns", "Pod", "core", "Creates Pods to run to completion"),
        ("CronJob", "spec.jobTemplate"): ("owns", "Job", "batch", "Creates Jobs on schedule"),
        ("Ingress", "spec.rules"): ("references", "Service", "core", "Routes to Services"),
        ("Ingress", "spec.tls"): ("references", "Secret", "core", "Uses TLS secrets"),
        ("Ingress", "spec.ingressClassName"): (
            "references",
            "IngressClass",
            "networking.k8s.io",
            "Uses IngressClass",
        ),
        ("NetworkPolicy", "spec.podSelector"): (
            "selects",
            "Pod",
            "core",
            "Applies to Pods via selector",
        ),
        ("PodDisruptionBudget", "spec.selector"): (
            "selects",
            "Pod",
            "core",
            "Protects Pods via selector",
        ),
        ("HorizontalPodAutoscaler", "spec.scaleTargetRef"): (
            "references",
            "Deployment",
            "apps",
            "Scales workloads",
        ),
        ("RoleBinding", "roleRef"): (
            "references",
            "Role",
            "rbac.authorization.k8s.io",
            "Binds to Role",
        ),
        ("RoleBinding", "subjects"): (
            "references",
            "ServiceAccount",
            "core",
            "Grants to ServiceAccounts",
        ),
        ("ClusterRoleBinding", "roleRef"): (
            "references",
            "ClusterRole",
            "rbac.authorization.k8s.io",
            "Binds to ClusterRole",
        ),
        ("ClusterRoleBinding", "subjects"): (
            "references",
            "ServiceAccount",
            "core",
            "Grants to ServiceAccounts",
        ),
        ("PersistentVolumeClaim", "spec.volumeName"): (
            "references",
            "PersistentVolume",
            "core",
            "Binds to PV",
        ),
        ("PersistentVolumeClaim", "spec.storageClassName"): (
            "references",
            "StorageClass",
            "storage.k8s.io",
            "Uses StorageClass",
        ),
        ("PersistentVolume", "spec.storageClassName"): (
            "references",
            "StorageClass",
            "storage.k8s.io",
            "Uses StorageClass",
        ),
        ("ServiceAccount", "imagePullSecrets"): (
            "references",
            "Secret",
            "core",
            "References image pull secrets",
        ),
        ("VolumeAttachment", "spec.nodeName"): ("references", "Node", "core", "Attached to Node"),
        ("VolumeAttachment", "spec.source"): (
            "references",
            "PersistentVolume",
            "core",
            "Attaches PV",
        ),
        ("CSINode", "metadata.name"): ("references", "Node", "core", "Associated with Node"),
    }

    for (pattern_kind, field_path), (
        rel_type,
        target_kind,
        target_group,
        desc,
    ) in relationship_patterns.items():
        if kind_name == pattern_kind:
            relationships.append(
                Relationship(
                    type=rel_type,
                    target_kind=target_kind,
                    target_group=target_group,
                    description=desc,
                    field_path=field_path,
                )
            )

    return relationships


def get_plural_name(kind: str) -> str:
    """Get the plural name for a kind."""
    plurals = {
        "Endpoints": "endpoints",
        "Ingress": "ingresses",
        "NetworkPolicy": "networkpolicies",
        "PodSecurityPolicy": "podsecuritypolicies",
        "StorageClass": "storageclasses",
        "IngressClass": "ingressclasses",
        "RuntimeClass": "runtimeclasses",
        "PriorityClass": "priorityclasses",
    }
    if kind in plurals:
        return plurals[kind]
    lower = kind.lower()
    if lower.endswith("s"):
        return lower + "es"
    if lower.endswith("y"):
        return lower[:-1] + "ies"
    return lower + "s"


def get_short_names(kind: str) -> list[str]:
    """Get short names for a kind."""
    short_names = {
        "Pod": ["po"],
        "Service": ["svc"],
        "Deployment": ["deploy"],
        "ReplicaSet": ["rs"],
        "StatefulSet": ["sts"],
        "DaemonSet": ["ds"],
        "ConfigMap": ["cm"],
        "ServiceAccount": ["sa"],
        "Namespace": ["ns"],
        "Node": ["no"],
        "PersistentVolume": ["pv"],
        "PersistentVolumeClaim": ["pvc"],
        "Endpoints": ["ep"],
        "ResourceQuota": ["quota"],
        "LimitRange": ["limits"],
        "HorizontalPodAutoscaler": ["hpa"],
        "CronJob": ["cj"],
        "Ingress": ["ing"],
        "NetworkPolicy": ["netpol"],
        "PodDisruptionBudget": ["pdb"],
        "StorageClass": ["sc"],
        "PriorityClass": ["pc"],
        "CustomResourceDefinition": ["crd", "crds"],
        "Event": ["ev"],
        "ComponentStatus": ["cs"],
        "Certificate": ["cert", "certs"],
        "CertificateSigningRequest": ["csr"],
    }
    return short_names.get(kind, [])


def get_categories(kind: str) -> list[str]:
    """Get categories for a kind."""
    all_category = {
        "Pod",
        "Service",
        "Deployment",
        "ReplicaSet",
        "StatefulSet",
        "DaemonSet",
        "Job",
        "CronJob",
        "HorizontalPodAutoscaler",
    }
    return ["all"] if kind in all_category else []


def get_group_description(group: str) -> str:
    """Get a description for an API group."""
    descriptions = {
        "core": "Core Kubernetes API objects including Pods, Services, ConfigMaps, and Secrets",
        "apps": "Higher-level application management including Deployments, StatefulSets, and DaemonSets",
        "batch": "Batch processing workloads including Jobs and CronJobs",
        "networking.k8s.io": "Network policies, Ingress, and service mesh configurations",
        "rbac.authorization.k8s.io": "Role-based access control for Kubernetes resources",
        "autoscaling": "Horizontal and vertical pod autoscaling",
        "policy": "Pod security and disruption policies",
        "storage.k8s.io": "Storage classes and CSI driver configurations",
        "scheduling.k8s.io": "Pod scheduling priorities and preemption",
        "admissionregistration.k8s.io": "Dynamic admission control webhooks",
        "apiextensions.k8s.io": "Custom Resource Definitions (CRDs)",
        "certificates.k8s.io": "Certificate signing requests and management",
        "coordination.k8s.io": "Leader election and distributed coordination",
        "discovery.k8s.io": "Endpoint slices for scalable service discovery",
        "events.k8s.io": "Cluster events and audit logging",
        "flowcontrol.apiserver.k8s.io": "API server request prioritization and fairness",
        "node.k8s.io": "Node-specific configurations and runtime classes",
        "resource.k8s.io": "Dynamic resource allocation and claims",
    }
    return descriptions.get(group, f"API group: {group}")


def get_release_date(version: str) -> str:
    """Get the release date for a K8s version."""
    release_dates = {
        "1.35": "2025-12-17",
        "1.34": "2025-08-13",
        "1.33": "2025-04-23",
        "1.32": "2024-12-11",
        "1.31": "2024-08-13",
        "1.30": "2024-04-17",
        "1.29": "2023-12-13",
        "1.28": "2023-08-15",
        "1.27": "2023-04-11",
        "1.26": "2022-12-08",
        "1.25": "2022-08-23",
        "1.24": "2022-05-03",
        "1.23": "2021-12-07",
    }
    return release_dates.get(version, "unknown")
