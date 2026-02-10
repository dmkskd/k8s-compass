"""Integration tests for schema extraction including Go enum parsing.

These tests exercise the full pipeline: OpenAPI spec + Go source → schema with enums/defaults.
They require the kubernetes repo to be checked out and OpenAPI specs cached.
"""

import pytest
import json
from pathlib import Path

from k8s.transform.openapi import parse_kind_schema
from k8s.transform.openapi.go_enum_extractor import get_enums_for_version, _enum_cache


# Path to cached OpenAPI specs
CACHE_DIR = Path(__file__).parent.parent.parent.parent / ".cache"
REPO_DIR = Path(__file__).parent.parent.parent.parent / "data" / "repos" / "kubernetes"


def load_openapi_spec(version: str = "1.35") -> dict:
    """Load cached OpenAPI spec."""
    spec_path = CACHE_DIR / f"openapi-{version}.json"
    if not spec_path.exists():
        pytest.skip(f"OpenAPI spec not cached: {spec_path}")
    return json.loads(spec_path.read_text())


def get_definition(spec: dict, kind: str, group: str = "apps", api_version: str = "v1") -> tuple[str, dict]:
    """Find a definition in the OpenAPI spec."""
    definitions = spec.get("definitions", {})
    
    # Build expected definition name pattern
    if group == "core":
        prefix = f"io.k8s.api.core.{api_version}"
    else:
        prefix = f"io.k8s.api.{group}.{api_version}"
    
    def_name = f"{prefix}.{kind}"
    
    if def_name not in definitions:
        pytest.skip(f"Definition not found: {def_name}")
    
    return def_name, definitions[def_name]


@pytest.fixture(scope="module")
def openapi_spec():
    """Load OpenAPI spec once per test module."""
    return load_openapi_spec("1.35")


@pytest.fixture(scope="module") 
def all_definitions(openapi_spec):
    """Get all definitions from spec."""
    return openapi_spec.get("definitions", {})


@pytest.fixture(scope="module")
def enum_data():
    """Load enum data from Go source. Clears cache to force re-parsing."""
    # Clear cache to ensure we're testing fresh parsing
    _enum_cache.clear()
    
    if not REPO_DIR.exists():
        pytest.skip("Kubernetes repo not cloned")
    
    # This exercises parse_enums_from_go_source()
    data = get_enums_for_version("1.35")
    
    if not data.get("enums"):
        pytest.skip("No enums parsed from Go source")
    
    return data


class TestGoEnumParsing:
    """Test that Go source parsing extracts correct enum types and values."""
    
    def test_deployment_strategy_type_enum_exists(self, enum_data):
        """DeploymentStrategyType should be parsed from Go source."""
        enums = enum_data.get("enums", {})
        assert "DeploymentStrategyType" in enums, \
            f"DeploymentStrategyType not found. Available: {list(enums.keys())[:10]}"
    
    def test_deployment_strategy_type_values(self, enum_data):
        """DeploymentStrategyType should have Recreate and RollingUpdate."""
        enums = enum_data.get("enums", {})
        values = enums.get("DeploymentStrategyType", [])
        assert "Recreate" in values
        assert "RollingUpdate" in values
    
    def test_statefulset_strategy_type_enum_exists(self, enum_data):
        """StatefulSetUpdateStrategyType should be parsed."""
        enums = enum_data.get("enums", {})
        assert "StatefulSetUpdateStrategyType" in enums
    
    def test_statefulset_strategy_type_values(self, enum_data):
        """StatefulSetUpdateStrategyType should have RollingUpdate and OnDelete."""
        enums = enum_data.get("enums", {})
        values = enums.get("StatefulSetUpdateStrategyType", [])
        assert "RollingUpdate" in values
        assert "OnDelete" in values
    
    def test_restart_policy_enum(self, enum_data):
        """RestartPolicy should have Always, OnFailure, Never."""
        enums = enum_data.get("enums", {})
        assert "RestartPolicy" in enums
        values = enums.get("RestartPolicy", [])
        assert "Always" in values
        assert "OnFailure" in values
        assert "Never" in values
    
    def test_service_type_enum(self, enum_data):
        """ServiceType should have ClusterIP, NodePort, LoadBalancer."""
        enums = enum_data.get("enums", {})
        assert "ServiceType" in enums
        values = enums.get("ServiceType", [])
        assert "ClusterIP" in values
        assert "NodePort" in values
        assert "LoadBalancer" in values


class TestFieldMapping:
    """Test that struct fields are correctly mapped to enum types."""
    
    def test_deployment_strategy_field_mapping(self, enum_data):
        """DeploymentStrategy.type should map to DeploymentStrategyType."""
        field_map = enum_data.get("field_map", {})
        assert field_map.get("DeploymentStrategy.type") == "DeploymentStrategyType"
    
    def test_statefulset_strategy_field_mapping(self, enum_data):
        """StatefulSetUpdateStrategy.type should map to StatefulSetUpdateStrategyType."""
        field_map = enum_data.get("field_map", {})
        assert field_map.get("StatefulSetUpdateStrategy.type") == "StatefulSetUpdateStrategyType"
    
    def test_daemonset_strategy_field_mapping(self, enum_data):
        """DaemonSetUpdateStrategy.type should map to DaemonSetUpdateStrategyType."""
        field_map = enum_data.get("field_map", {})
        assert field_map.get("DaemonSetUpdateStrategy.type") == "DaemonSetUpdateStrategyType"


class TestFullSchemaParsing:
    """Test parse_kind_schema produces correct output with enums and defaults."""
    
    def test_deployment_strategy_type_in_schema(self, openapi_spec, all_definitions):
        """Deployment schema should have correct enum for spec.strategy.type."""
        def_name, definition = get_definition(openapi_spec, "Deployment", "apps")
        
        schema = parse_kind_schema(
            def_name, definition, "apps", "v1", "Deployment",
            all_definitions, version="1.35"
        )
        
        # Find spec.strategy.type
        spec = next((p for p in schema.properties if p.name == "spec"), None)
        assert spec is not None
        
        strategy = next((p for p in (spec.properties or []) if p.name == "strategy"), None)
        assert strategy is not None
        
        type_field = next((p for p in (strategy.properties or []) if p.name == "type"), None)
        assert type_field is not None
        
        assert type_field.enum == ["Recreate", "RollingUpdate"], \
            f"Expected ['Recreate', 'RollingUpdate'], got {type_field.enum}"
        assert type_field.default == "RollingUpdate"
    
    def test_statefulset_strategy_type_in_schema(self, openapi_spec, all_definitions):
        """StatefulSet schema should have different enum than Deployment."""
        def_name, definition = get_definition(openapi_spec, "StatefulSet", "apps")
        
        schema = parse_kind_schema(
            def_name, definition, "apps", "v1", "StatefulSet",
            all_definitions, version="1.35"
        )
        
        spec = next((p for p in schema.properties if p.name == "spec"), None)
        assert spec is not None
        
        strategy = next((p for p in (spec.properties or []) if p.name == "updateStrategy"), None)
        assert strategy is not None
        
        type_field = next((p for p in (strategy.properties or []) if p.name == "type"), None)
        assert type_field is not None
        
        # StatefulSet uses OnDelete, not Recreate
        assert type_field.enum == ["RollingUpdate", "OnDelete"], \
            f"Expected ['RollingUpdate', 'OnDelete'], got {type_field.enum}"
    
    def test_pod_restart_policy_in_schema(self, openapi_spec, all_definitions):
        """Pod schema should have restartPolicy enum and default."""
        def_name, definition = get_definition(openapi_spec, "Pod", "core")
        
        schema = parse_kind_schema(
            def_name, definition, "core", "v1", "Pod",
            all_definitions, version="1.35"
        )
        
        spec = next((p for p in schema.properties if p.name == "spec"), None)
        assert spec is not None
        
        restart = next((p for p in (spec.properties or []) if p.name == "restartPolicy"), None)
        assert restart is not None
        
        assert restart.enum is not None
        assert "Always" in restart.enum
        assert "OnFailure" in restart.enum
        assert "Never" in restart.enum
        assert restart.default == "Always"
    
    def test_service_type_in_schema(self, openapi_spec, all_definitions):
        """Service schema should have type enum and default."""
        def_name, definition = get_definition(openapi_spec, "Service", "core")
        
        schema = parse_kind_schema(
            def_name, definition, "core", "v1", "Service",
            all_definitions, version="1.35"
        )
        
        spec = next((p for p in schema.properties if p.name == "spec"), None)
        assert spec is not None
        
        type_field = next((p for p in (spec.properties or []) if p.name == "type"), None)
        assert type_field is not None
        
        assert type_field.enum is not None
        assert "ClusterIP" in type_field.enum
        assert "NodePort" in type_field.enum
        assert "LoadBalancer" in type_field.enum
        assert type_field.default == "ClusterIP"
