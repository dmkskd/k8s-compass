"""Configuration for the K8s API pipeline.

This file contains curated mappings that enrich the parsed OpenAPI data.
See DATA_SOURCES.md for documentation on how each mapping was created
and how to maintain it.

Data categories:
- K8S_VERSIONS: List of versions to fetch (deterministic)
- GROUP_COLORS: UI colors for API groups (design choice)
- GROUP_DISPLAY_NAMES: Human-friendly group names (curated)
- CLUSTER_SCOPED_KINDS: Non-namespaced resources (from kubectl api-resources)
- KIND_DOCS_URLS: Links to kubernetes.io docs (LLM-assisted, manually verified)
"""

from pathlib import Path

# Kubernetes versions to fetch (configurable)
K8S_VERSIONS = [
    "1.36",
    "1.35",
    "1.34",
    "1.33",
    "1.32",
    "1.31",
    "1.30",
    "1.29",
    "1.28",
    "1.27",
    "1.26",
    "1.25",
]

# URL template for fetching OpenAPI specs
OPENAPI_URL_TEMPLATE = (
    "https://raw.githubusercontent.com/kubernetes/kubernetes/"
    "release-{version}/api/openapi-spec/swagger.json"
)

# Directory structure
# __file__ is pipeline/src/k8s/core/config.py
# Go up: config.py -> core -> k8s -> src -> pipeline -> repo_root
REPO_ROOT = Path(__file__).parent.parent.parent.parent.parent

# Pipeline directories (source of truth for all data)
PIPELINE_ROOT = REPO_ROOT / "pipeline"
PIPELINE_DATA_DIR = PIPELINE_ROOT / "data"

# Pipeline output directories
OUTPUT_DIR = PIPELINE_DATA_DIR / "output" / "json"  # Intermediate JSON files
PARQUET_DIR = PIPELINE_DATA_DIR / "output" / "parquet"  # Final parquet files
BENCHMARK_DIR = PIPELINE_DATA_DIR / "output" / "benchmark"  # Benchmark experiments

# Web app data directory (copy destination for dev server)
WEB_DATA_DIR = REPO_ROOT / "packages" / "web" / "public" / "data"
WEB_PARQUET_DIR = WEB_DATA_DIR / "parquet"

# Legacy aliases (for backward compatibility during migration)
DATA_ROOT = WEB_DATA_DIR  # TODO: Remove after migration

# Hidden directories (not version controlled - see .gitignore)
CACHE_DIR = PIPELINE_ROOT / ".cache"  # OpenAPI cache, GitHub cache

# Curated data directories (organized by category)
CURATED_DIR = PIPELINE_DATA_DIR / "curated"
CURATED_RELEASES_DIR = CURATED_DIR / "releases"  # {version}-curated.json
CURATED_CONTENT_DIR = CURATED_DIR / "content"  # content_links*.json
CURATED_FEATURE_GATES_DIR = CURATED_DIR / "feature-gates"  # feature_gates_{version}.json
CURATED_KUBECTL_DIR = CURATED_DIR / "kubectl"  # kubectl_commands_{version}.json
CURATED_KEPS_DIR = CURATED_DIR / "keps"  # kep_metadata.json, label_*.json
CURATED_COMPONENTS_DIR = CURATED_DIR / "components"  # components.json
REPOS_DIR = PIPELINE_DATA_DIR / "repos"  # Git clones (kubernetes, enhancements)

# API group colors for visualization
GROUP_COLORS = {
    "core": "#3B82F6",
    "apps": "#10B981",
    "batch": "#F59E0B",
    "networking.k8s.io": "#8B5CF6",
    "rbac.authorization.k8s.io": "#EF4444",
    "autoscaling": "#06B6D4",
    "policy": "#EC4899",
    "storage.k8s.io": "#84CC16",
    "scheduling.k8s.io": "#F97316",
    "admissionregistration.k8s.io": "#14B8A6",
    "apiextensions.k8s.io": "#6366F1",
    "certificates.k8s.io": "#A855F7",
    "coordination.k8s.io": "#F43F5E",
    "discovery.k8s.io": "#0EA5E9",
    "events.k8s.io": "#22C55E",
    "flowcontrol.apiserver.k8s.io": "#EAB308",
    "node.k8s.io": "#64748B",
    "resource.k8s.io": "#FB923C",
}

# Display names for API groups
GROUP_DISPLAY_NAMES = {
    "core": "Core",
    "apps": "Apps",
    "batch": "Batch",
    "networking.k8s.io": "Networking",
    "rbac.authorization.k8s.io": "RBAC",
    "autoscaling": "Autoscaling",
    "policy": "Policy",
    "storage.k8s.io": "Storage",
    "scheduling.k8s.io": "Scheduling",
    "admissionregistration.k8s.io": "Admission",
    "apiextensions.k8s.io": "API Extensions",
    "certificates.k8s.io": "Certificates",
    "coordination.k8s.io": "Coordination",
    "discovery.k8s.io": "Discovery",
    "events.k8s.io": "Events",
    "flowcontrol.apiserver.k8s.io": "Flow Control",
    "node.k8s.io": "Node",
    "resource.k8s.io": "Resource",
}

# Cluster-scoped resources (not namespaced)
CLUSTER_SCOPED_KINDS = {
    "Namespace",
    "Node",
    "PersistentVolume",
    "ClusterRole",
    "ClusterRoleBinding",
    "StorageClass",
    "PriorityClass",
    "CSIDriver",
    "CSINode",
    "VolumeAttachment",
    "IngressClass",
    "RuntimeClass",
    "PodSecurityPolicy",
    "CustomResourceDefinition",
    "APIService",
    "MutatingWebhookConfiguration",
    "ValidatingWebhookConfiguration",
    "ValidatingAdmissionPolicy",
    "ValidatingAdmissionPolicyBinding",
    "CertificateSigningRequest",
    "ClusterCIDR",
    "IPAddress",
    "ServiceCIDR",
    "FlowSchema",
    "PriorityLevelConfiguration",
    "Lease",
    "ComponentStatus",
}

# Documentation URLs for Kubernetes Kinds
# Maps Kind name to its official documentation page
KIND_DOCS_URLS = {
    # Core workloads
    "Pod": "https://kubernetes.io/docs/concepts/workloads/pods/",
    "ReplicationController": "https://kubernetes.io/docs/concepts/workloads/controllers/replicationcontroller/",
    # Apps workloads
    "Deployment": "https://kubernetes.io/docs/concepts/workloads/controllers/deployment/",
    "ReplicaSet": "https://kubernetes.io/docs/concepts/workloads/controllers/replicaset/",
    "StatefulSet": "https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/",
    "DaemonSet": "https://kubernetes.io/docs/concepts/workloads/controllers/daemonset/",
    # Batch workloads
    "Job": "https://kubernetes.io/docs/concepts/workloads/controllers/job/",
    "CronJob": "https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/",
    # Services & Networking
    "Service": "https://kubernetes.io/docs/concepts/services-networking/service/",
    "Endpoints": "https://kubernetes.io/docs/concepts/services-networking/service/#endpoints",
    "EndpointSlice": "https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/",
    "Ingress": "https://kubernetes.io/docs/concepts/services-networking/ingress/",
    "IngressClass": "https://kubernetes.io/docs/concepts/services-networking/ingress/#ingress-class",
    "NetworkPolicy": "https://kubernetes.io/docs/concepts/services-networking/network-policies/",
    # Config & Storage
    "ConfigMap": "https://kubernetes.io/docs/concepts/configuration/configmap/",
    "Secret": "https://kubernetes.io/docs/concepts/configuration/secret/",
    "PersistentVolume": "https://kubernetes.io/docs/concepts/storage/persistent-volumes/",
    "PersistentVolumeClaim": "https://kubernetes.io/docs/concepts/storage/persistent-volumes/#persistentvolumeclaims",
    "StorageClass": "https://kubernetes.io/docs/concepts/storage/storage-classes/",
    "VolumeAttachment": "https://kubernetes.io/docs/concepts/storage/volumes/#primitives",
    "CSIDriver": "https://kubernetes.io/docs/concepts/storage/volumes/#csi",
    "CSINode": "https://kubernetes.io/docs/concepts/storage/volumes/#csi",
    "CSIStorageCapacity": "https://kubernetes.io/docs/concepts/storage/storage-capacity/",
    # Cluster resources
    "Namespace": "https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/",
    "Node": "https://kubernetes.io/docs/concepts/architecture/nodes/",
    "ResourceQuota": "https://kubernetes.io/docs/concepts/policy/resource-quotas/",
    "LimitRange": "https://kubernetes.io/docs/concepts/policy/limit-range/",
    # RBAC
    "ServiceAccount": "https://kubernetes.io/docs/concepts/security/service-accounts/",
    "Role": "https://kubernetes.io/docs/reference/access-authn-authz/rbac/#role-and-clusterrole",
    "ClusterRole": "https://kubernetes.io/docs/reference/access-authn-authz/rbac/#role-and-clusterrole",
    "RoleBinding": "https://kubernetes.io/docs/reference/access-authn-authz/rbac/#rolebinding-and-clusterrolebinding",
    "ClusterRoleBinding": "https://kubernetes.io/docs/reference/access-authn-authz/rbac/#rolebinding-and-clusterrolebinding",
    # Autoscaling
    "HorizontalPodAutoscaler": "https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/",
    # Policy
    "PodDisruptionBudget": "https://kubernetes.io/docs/concepts/workloads/pods/disruptions/",
    "PodSecurityPolicy": "https://kubernetes.io/docs/concepts/security/pod-security-policy/",
    # Scheduling
    "PriorityClass": "https://kubernetes.io/docs/concepts/scheduling-eviction/pod-priority-preemption/",
    # API Extensions
    "CustomResourceDefinition": "https://kubernetes.io/docs/concepts/extend-kubernetes/api-extension/custom-resources/",
    # Admission
    "MutatingWebhookConfiguration": "https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers/",
    "ValidatingWebhookConfiguration": "https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers/",
    "ValidatingAdmissionPolicy": "https://kubernetes.io/docs/reference/access-authn-authz/validating-admission-policy/",
    # Certificates
    "CertificateSigningRequest": "https://kubernetes.io/docs/reference/access-authn-authz/certificate-signing-requests/",
    # Coordination
    "Lease": "https://kubernetes.io/docs/concepts/architecture/leases/",
    # Events
    "Event": "https://kubernetes.io/docs/reference/kubernetes-api/cluster-resources/event-v1/",
    # Node
    "RuntimeClass": "https://kubernetes.io/docs/concepts/containers/runtime-class/",
    # Resource (DRA)
    "ResourceClaim": "https://kubernetes.io/docs/concepts/scheduling-eviction/dynamic-resource-allocation/",
    "ResourceClaimTemplate": "https://kubernetes.io/docs/concepts/scheduling-eviction/dynamic-resource-allocation/",
    "DeviceClass": "https://kubernetes.io/docs/concepts/scheduling-eviction/dynamic-resource-allocation/",
    "ResourceSlice": "https://kubernetes.io/docs/concepts/scheduling-eviction/dynamic-resource-allocation/",
    # Flow Control
    "FlowSchema": "https://kubernetes.io/docs/concepts/cluster-administration/flow-control/",
    "PriorityLevelConfiguration": "https://kubernetes.io/docs/concepts/cluster-administration/flow-control/",
}

# =============================================================================
# Cloud Provider Configuration
# =============================================================================

# Provider metadata for K8s distributions
# product: endoflife.date product ID
# color: UI color for visualization
# versioning: "k8s" (direct mapping) or "custom" (needs mapping)
# support_model: "standard+extended", "standard-only", or "lts"
PROVIDERS = {
    "eks": {
        "display_name": "Amazon EKS",
        "product": "amazon-eks",
        "color": "#FF9900",
        "docs_url": "https://docs.aws.amazon.com/eks/",
        "version_docs_url": "https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-versions.html",
        "versioning": "k8s",
        "support_model": "standard+extended",
        "standard_support_months": 14,
        "extended_support_months": 12,
    },
    "gke": {
        "display_name": "Google GKE",
        "product": "google-kubernetes-engine",
        "color": "#4285F4",
        "docs_url": "https://cloud.google.com/kubernetes-engine/docs",
        "version_docs_url": "https://cloud.google.com/kubernetes-engine/docs/release-schedule",
        "versioning": "k8s",
        "support_model": "standard+extended",
        "standard_support_months": 14,
        "extended_support_months": 12,
    },
    "aks": {
        "display_name": "Azure AKS",
        "product": "azure-kubernetes-service",
        "color": "#0078D4",
        "docs_url": "https://learn.microsoft.com/en-us/azure/aks/",
        "version_docs_url": "https://learn.microsoft.com/en-us/azure/aks/supported-kubernetes-versions",
        "versioning": "k8s",
        "support_model": "standard+extended",
        "standard_support_months": 12,
        "extended_support_months": 12,
    },
    "openshift": {
        "display_name": "Red Hat OpenShift",
        "product": "red-hat-openshift",
        "color": "#EE0000",
        "docs_url": "https://docs.openshift.com/",
        "version_docs_url": "https://access.redhat.com/support/policy/updates/openshift",
        "versioning": "custom",
        "support_model": "standard+extended",
        "standard_support_months": 18,
        "extended_support_months": 6,
        # OpenShift 4.x maps to K8s 1.x (approximate mapping)
        # https://access.redhat.com/solutions/4870701
        "k8s_mapping": {
            "4.20": "1.33",
            "4.19": "1.32",
            "4.18": "1.31",
            "4.17": "1.30",
            "4.16": "1.29",
            "4.15": "1.28",
            "4.14": "1.27",
            "4.13": "1.26",
            "4.12": "1.25",
            "4.11": "1.24",
            "4.10": "1.23",
        },
    },
}

# endoflife.date API base URL
ENDOFLIFE_API_URL = "https://endoflife.date/api"
