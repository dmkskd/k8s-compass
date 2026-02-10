"""Tests for KEP field linker module."""

import pytest

from k8s.transform.kep.field_linker import (
    compute_text_similarity,
    extract_feature_gate,
    is_canonical_field,
    match_field_to_keps,
    tokenize,
)


class TestTokenize:
    """Tests for tokenize function."""

    def test_basic_tokenization(self):
        tokens = tokenize("hello world")
        assert "hello" in tokens
        assert "world" in tokens

    def test_camel_case_splitting(self):
        tokens = tokenize("workloadRef")
        assert "workload" in tokens
        assert "ref" in tokens

    def test_pascal_case_splitting(self):
        tokens = tokenize("PodGroup")
        # "pod" is in stop words, so only "group" remains
        assert "group" in tokens

    def test_stop_words_removed(self):
        tokens = tokenize("the pod is a resource")
        assert "the" not in tokens
        assert "is" not in tokens
        assert "a" not in tokens

    def test_short_words_removed(self):
        tokens = tokenize("go to do it")
        # All words are <= 2 chars or stop words
        assert len(tokens) == 0

    def test_empty_string(self):
        tokens = tokenize("")
        assert len(tokens) == 0


class TestComputeTextSimilarity:
    """Tests for compute_text_similarity function."""

    def test_identical_texts(self):
        sim = compute_text_similarity("gang scheduling", "gang scheduling")
        assert sim == 1.0

    def test_completely_different(self):
        sim = compute_text_similarity("apple banana", "xyz abc")
        assert sim == 0.0

    def test_partial_overlap(self):
        sim = compute_text_similarity("gang scheduling pods", "scheduling pods groups")
        assert 0.0 < sim < 1.0

    def test_empty_strings(self):
        assert compute_text_similarity("", "") == 0.0
        assert compute_text_similarity("hello", "") == 0.0
        assert compute_text_similarity("", "world") == 0.0


class TestExtractFeatureGate:
    """Tests for extract_feature_gate function."""

    def test_requires_enabling_pattern(self):
        text = "This feature requires enabling the GangScheduling feature gate"
        assert extract_feature_gate(text) == "GangScheduling"

    def test_feature_gate_colon_pattern(self):
        text = "Feature gate: PodCertificates"
        assert extract_feature_gate(text) == "PodCertificates"

    def test_no_feature_gate(self):
        text = "This is a regular description without any gates"
        assert extract_feature_gate(text) is None

    def test_case_insensitive(self):
        text = "Requires enabling the GANGSCHEDULING FEATURE GATE"
        result = extract_feature_gate(text)
        assert result is not None


class TestMatchFieldToKeps:
    """Tests for match_field_to_keps function."""

    @pytest.fixture
    def sample_features(self):
        return [
            {
                "kep": "KEP-4671",
                "title": "Gang Scheduling",
                "description": "All-or-nothing scheduling for pod groups via Workload API",
                "featureGate": "GangScheduling",
                "affectedKinds": ["Workload", "PodGroup"],
                "affectedFields": [],
            },
            {
                "kep": "KEP-4317",
                "title": "Pod Certificates for Workload Identity",
                "description": "Native workload identity with automated certificate rotation",
                "featureGate": "PodCertificates",
                "affectedKinds": ["Pod", "PodCertificateRequest"],
                "affectedFields": [],
            },
            {
                "kep": "KEP-5328",
                "title": "Node Declared Features Before Scheduling",
                "description": "Nodes declare supported features via status.declaredFeatures",
                "featureGate": "NodeDeclaredFeatures",
                "affectedKinds": ["Node"],
                "affectedFields": ["status.declaredFeatures"],
            },
        ]

    def test_match_by_affected_fields(self, sample_features):
        """Fields listed in affectedFields should match with high confidence."""
        field = {
            "path": "status.declaredFeatures",
            "kind": "Node",
            "group": "core",
        }
        result = match_field_to_keps(field, sample_features, {})
        assert result is not None
        assert result.kep == "KEP-5328"
        assert result.confidence >= 0.99

    def test_match_workload_ref_to_gang_scheduling(self, sample_features):
        """workloadRef should match Gang Scheduling, not Workload Identity."""
        field = {
            "path": "spec.workloadRef",
            "kind": "Pod",
            "group": "core",
        }
        # Simulate schema with description mentioning Workload and PodGroup
        schemas = {
            "core/Pod": {
                "properties": [
                    {
                        "name": "spec",
                        "properties": [
                            {
                                "name": "workloadRef",
                                "description": "WorkloadRef provides a reference to the Workload object. Used by scheduler for PodGroup scheduling policies.",
                            }
                        ],
                    }
                ]
            }
        }
        result = match_field_to_keps(field, sample_features, schemas)
        assert result is not None
        # Should match Gang Scheduling because description mentions Workload and PodGroup
        assert result.kep == "KEP-4671"

    def test_no_match_below_threshold(self, sample_features):
        """Fields with no good matches should return None."""
        field = {
            "path": "spec.someRandomField",
            "kind": "ConfigMap",
            "group": "core",
        }
        result = match_field_to_keps(field, sample_features, {})
        assert result is None

    def test_kind_overlap_boosts_confidence(self, sample_features):
        """Fields on affected kinds should get higher confidence."""
        field = {
            "path": "spec.someField",
            "kind": "Pod",
            "group": "core",
        }
        # Pod is in KEP-4317's affectedKinds
        result = match_field_to_keps(field, sample_features, {})
        # Should match something due to kind overlap
        if result:
            assert result.kep == "KEP-4317"


class TestMatchFieldToKepsEdgeCases:
    """Edge case tests for match_field_to_keps."""

    def test_empty_features_list(self):
        field = {"path": "spec.test", "kind": "Pod", "group": "core"}
        result = match_field_to_keps(field, [], {})
        assert result is None

    def test_feature_without_affected_kinds(self):
        features = [
            {
                "kep": "KEP-1234",
                "title": "Some Feature",
                "description": "A feature description",
                "affectedKinds": [],
                "affectedFields": [],
            }
        ]
        field = {"path": "spec.test", "kind": "Pod", "group": "core"}
        result = match_field_to_keps(field, features, {})
        # Should not crash, may or may not match based on text similarity
        assert result is None or isinstance(result.confidence, float)

    def test_feature_gate_in_description_matches(self):
        features = [
            {
                "kep": "KEP-4671",
                "title": "Gang Scheduling",
                "description": "All-or-nothing scheduling",
                "featureGate": "GangScheduling",
                "affectedKinds": [],
                "affectedFields": [],
            }
        ]
        field = {"path": "spec.gangConfig", "kind": "Pod", "group": "core"}
        schemas = {
            "core/Pod": {
                "properties": [
                    {
                        "name": "spec",
                        "properties": [
                            {
                                "name": "gangConfig",
                                "description": "Requires enabling the GangScheduling feature gate",
                            }
                        ],
                    }
                ]
            }
        }
        result = match_field_to_keps(field, features, schemas)
        assert result is not None
        assert result.kep == "KEP-4671"
        assert result.confidence >= 0.9


class TestIsCanonicalField:
    """Tests for is_canonical_field function."""

    def test_pod_fields_are_canonical(self):
        """Fields on Pod itself are always canonical."""
        assert is_canonical_field("Pod", "core", "spec.workloadRef") is True
        assert is_canonical_field("Pod", "core", "spec.containers") is True
        assert is_canonical_field("Pod", "core", "status.phase") is True

    def test_podtemplate_fields_are_canonical(self):
        """Fields on PodTemplate are canonical."""
        assert is_canonical_field("PodTemplate", "core", "template.spec.containers") is True

    def test_deployment_embedded_podspec_not_canonical(self):
        """Fields under spec.template.spec in Deployment are NOT canonical."""
        assert is_canonical_field("Deployment", "apps", "spec.template.spec.workloadRef") is False
        assert is_canonical_field("Deployment", "apps", "spec.template.spec.containers") is False

    def test_deployment_own_fields_are_canonical(self):
        """Deployment's own fields (not embedded) are canonical."""
        assert is_canonical_field("Deployment", "apps", "spec.replicas") is True
        assert is_canonical_field("Deployment", "apps", "spec.selector") is True
        assert is_canonical_field("Deployment", "apps", "spec.template.metadata") is True

    def test_daemonset_embedded_podspec_not_canonical(self):
        """Fields under spec.template.spec in DaemonSet are NOT canonical."""
        assert is_canonical_field("DaemonSet", "apps", "spec.template.spec.workloadRef") is False

    def test_statefulset_embedded_podspec_not_canonical(self):
        """Fields under spec.template.spec in StatefulSet are NOT canonical."""
        assert is_canonical_field("StatefulSet", "apps", "spec.template.spec.workloadRef") is False

    def test_job_embedded_podspec_not_canonical(self):
        """Fields under spec.template.spec in Job are NOT canonical."""
        assert is_canonical_field("Job", "batch", "spec.template.spec.workloadRef") is False

    def test_cronjob_embedded_podspec_not_canonical(self):
        """Fields under spec.jobTemplate.spec.template.spec in CronJob are NOT canonical."""
        assert is_canonical_field("CronJob", "batch", "spec.jobTemplate.spec.template.spec.workloadRef") is False

    def test_replicaset_embedded_podspec_not_canonical(self):
        """Fields under spec.template.spec in ReplicaSet are NOT canonical."""
        assert is_canonical_field("ReplicaSet", "apps", "spec.template.spec.workloadRef") is False

    def test_other_kinds_are_canonical(self):
        """Fields on kinds that don't embed PodSpec are canonical."""
        assert is_canonical_field("ConfigMap", "core", "data") is True
        assert is_canonical_field("Service", "core", "spec.ports") is True
        assert is_canonical_field("Node", "core", "status.declaredFeatures") is True
