"""Unit tests for Go enum extraction and description-based fallback."""

import pytest
from k8s.transform.openapi import (
    extract_default_from_description,
    extract_enum_from_description,
)


class TestExtractDefaultFromDescription:
    """Test default value extraction from description text patterns."""

    def test_default_is_pattern(self):
        desc = 'Type of deployment. Can be "Recreate" or "RollingUpdate". Default is RollingUpdate.'
        assert extract_default_from_description(desc) == "RollingUpdate"

    def test_defaults_to_pattern(self):
        desc = "Defaults to Always if not specified."
        assert extract_default_from_description(desc) == "Always"

    def test_if_not_specified_pattern(self):
        desc = "If not specified, defaults to ClusterFirst."
        assert extract_default_from_description(desc) == "ClusterFirst"

    def test_value_with_default_in_parens(self):
        # Pattern: "Allow" (default)
        desc = 'Valid values are: - "Allow" (default): allows concurrent runs; - "Forbid": forbids'
        assert extract_default_from_description(desc) == "Allow"

    def test_no_default_returns_none(self):
        desc = "No default mentioned here."
        assert extract_default_from_description(desc) is None


class TestExtractEnumFromDescription:
    """Test enum extraction from description text (fallback method)."""

    def test_valid_values_are_pattern(self):
        desc = 'Valid values are: `Always`, `OnFailure`, `Never`.'
        result = extract_enum_from_description(desc)
        assert result == ["Always", "OnFailure", "Never"]

    def test_no_enum_returns_none(self):
        desc = "A simple description without enum values."
        assert extract_enum_from_description(desc) is None
