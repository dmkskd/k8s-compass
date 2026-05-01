"""
Tests for `extract_features_for_version` (in `k8s.transform.kep.parser`).

Each test isolates the function by monkeypatching module-level paths
(`KEPS_DIR`, `PR_CACHE_DIR`) and the `get_release_notes_path` helper to
point at fixture directories.

Curated overlay tests use `merge_features` from the builder.

Edge cases captured here are drawn from real K8s release data; see
fixtures/<case>/README.md for the narrative description of each.
"""
import json
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures"


def _extract(monkeypatch, tmp_path, fixture_name: str, version: str):
    """Run the in-place extractor against a fixture directory.

    Steps:
    1. Point parser.KEPS_DIR at the fixture's keps/ subdirectory.
    2. Point parser.PR_CACHE_DIR at a tmp dir, populated from the fixture's
       pr-data.json (if present) — one JSON file per PR.
    3. Patch `get_release_notes_path` to return the fixture release-notes file.

    Returns features as dicts (via features_to_dict).
    """
    from k8s.transform.kep import parser as parser_mod
    from k8s.transform.kep.parser import (
        extract_features_for_version,
        features_to_dict,
    )

    fixture_dir = FIXTURES / fixture_name
    keps_dir = fixture_dir / "keps"
    release_notes = fixture_dir / f"release-notes-{version}.json"
    pr_data_path = fixture_dir / "pr-data.json"

    pr_cache_dir = tmp_path / "pr-cache"
    pr_cache_dir.mkdir()
    if pr_data_path.exists():
        with open(pr_data_path) as f:
            pr_data = json.load(f)
        for pr_num, info in pr_data.items():
            cache_payload = {
                "fetched_at": "test",
                "data": {},
                "parsed": {
                    "number": int(pr_num),
                    "related_keps": info.get("related_keps", []),
                },
            }
            with open(pr_cache_dir / f"{pr_num}.json", "w") as f:
                json.dump(cache_payload, f)

    monkeypatch.setattr(parser_mod, "KEPS_DIR", keps_dir)
    monkeypatch.setattr(parser_mod, "PR_CACHE_DIR", pr_cache_dir)
    monkeypatch.setattr(
        "k8s.input.upstream_stager.get_release_notes_path",
        lambda v: release_notes,
    )

    features = extract_features_for_version(version)
    return features_to_dict(features)


def _resolve_with_curated(monkeypatch, tmp_path, fixture_name: str, version: str):
    """Run extractor + merge_features with curated overlay from the fixture."""
    from k8s.transform.release.builder import merge_features

    extracted = _extract(monkeypatch, tmp_path, fixture_name, version)
    curated_path = FIXTURES / fixture_name / "curated.json"
    curated_features = []
    if curated_path.exists():
        with open(curated_path) as f:
            curated_features = json.load(f).get("features", [])
    return merge_features(extracted, curated_features)


class TestPhantomPlannedSlipped:
    """KEP-1710 — planned for 1.34, slipped to 1.36."""

    FIXTURE = "phantom_planned_slipped"

    def test_not_in_planned_release_when_slipped(self, monkeypatch, tmp_path):
        features = _extract(monkeypatch, tmp_path, self.FIXTURE, "1.34")
        keps = {f["kep"] for f in features}
        assert "KEP-1710" not in keps

    def test_in_actual_release(self, monkeypatch, tmp_path):
        features = _extract(monkeypatch, tmp_path, self.FIXTURE, "1.36")
        kep_1710 = next((f for f in features if f["kep"] == "KEP-1710"), None)
        assert kep_1710 is not None
        assert kep_1710["stage"] == "stable"


class TestContinuingAlpha:
    """KEP-5004 — alpha in 1.34, work continued in 1.35 with no graduation."""

    FIXTURE = "continuing_alpha"

    def test_appears_in_intermediate_release(self, monkeypatch, tmp_path):
        features = _extract(monkeypatch, tmp_path, self.FIXTURE, "1.35")
        keps = {f["kep"] for f in features}
        assert "KEP-5004" in keps

    def test_stage_carried_from_earlier_milestone(self, monkeypatch, tmp_path):
        features = _extract(monkeypatch, tmp_path, self.FIXTURE, "1.35")
        kep_5004 = next(f for f in features if f["kep"] == "KEP-5004")
        assert kep_5004["stage"] == "alpha"


class TestManualAdditionKepYamlStale:
    """KEP-2570 — kep.yaml stale, but curated + upstream PRs anchor the feature."""

    FIXTURE = "manual_addition_kep_yaml_stale"

    def test_feature_present_anchored_by_upstream(self, monkeypatch, tmp_path):
        features = _resolve_with_curated(monkeypatch, tmp_path, self.FIXTURE, "1.36")
        keps = {f["kep"] for f in features}
        assert "KEP-2570" in keps

    def test_stage_from_curated_overrides(self, monkeypatch, tmp_path):
        features = _resolve_with_curated(monkeypatch, tmp_path, self.FIXTURE, "1.36")
        kep_2570 = next(f for f in features if f["kep"] == "KEP-2570")
        assert kep_2570["stage"] == "alpha"

    def test_is_highlight_from_curated(self, monkeypatch, tmp_path):
        features = _resolve_with_curated(monkeypatch, tmp_path, self.FIXTURE, "1.36")
        kep_2570 = next(f for f in features if f["kep"] == "KEP-2570")
        assert kep_2570.get("isHighlight") is True


class TestCuratedAnnotatesNotInvents:
    """Stale curated entry must NOT materialize a feature without a real signal."""

    FIXTURE = "curated_annotates_not_invents"

    def test_curated_alone_does_not_create_feature(self, monkeypatch, tmp_path):
        features = _resolve_with_curated(monkeypatch, tmp_path, self.FIXTURE, "1.34")
        keps = {f["kep"] for f in features}
        assert "KEP-1710" not in keps


class TestMalformedKepYaml:
    """A kep.yaml with a bad date in an unused field (e.g. `creation-date:
    2023-14-05` — month 14) must not crash parsing or drop the KEP. The
    real fields we care about (milestones, kep-number, title) are still
    valid, so the feature should still be extracted."""

    FIXTURE = "malformed_kep_yaml"

    def test_does_not_crash(self, monkeypatch, tmp_path):
        features = _extract(monkeypatch, tmp_path, self.FIXTURE, "1.35")
        assert isinstance(features, list)

    def test_malformed_date_does_not_drop_kep(self, monkeypatch, tmp_path):
        features = _extract(monkeypatch, tmp_path, self.FIXTURE, "1.35")
        keps = {f["kep"] for f in features}
        assert "KEP-9999" in keps, (
            "Bad creation-date is in an unused field; KEP-9999 has alpha=v1.35 "
            "and should still be present"
        )


class TestIsHighlightSurvives:
    """Curated isHighlight flag must be preserved through merge for known KEPs."""

    FIXTURE = "is_highlight_survives"

    def test_is_highlight_preserved(self, monkeypatch, tmp_path):
        features = _resolve_with_curated(monkeypatch, tmp_path, self.FIXTURE, "1.36")
        kep_127 = next(f for f in features if f["kep"] == "KEP-127")
        assert kep_127.get("isHighlight") is True

    def test_extraction_fields_intact(self, monkeypatch, tmp_path):
        features = _resolve_with_curated(monkeypatch, tmp_path, self.FIXTURE, "1.36")
        kep_127 = next(f for f in features if f["kep"] == "KEP-127")
        assert kep_127["stage"] == "stable"
        assert kep_127["title"] == "Support User Namespaces"


class TestStageHistoryHonesty:
    """Feature history must reflect current kep.yaml, not a stale snapshot."""

    FIXTURE = "stage_history_honesty"

    def test_current_milestones_in_history(self, monkeypatch, tmp_path):
        features = _extract(monkeypatch, tmp_path, self.FIXTURE, "1.36")
        kep_5004 = next(f for f in features if f["kep"] == "KEP-5004")
        history = kep_5004["history"]
        assert history.get("alpha") == "1.34"
        assert history.get("beta") == "1.36"
        assert history.get("stable") == "1.37"

    def test_stage_matches_milestone_for_version(self, monkeypatch, tmp_path):
        features = _extract(monkeypatch, tmp_path, self.FIXTURE, "1.36")
        kep_5004 = next(f for f in features if f["kep"] == "KEP-5004")
        assert kep_5004["stage"] == "beta"


class TestPrBodyKepLink:
    """KEPs referenced from PR body (not from structured release-notes field)
    must still anchor features when --with-prs enrichment is available."""

    FIXTURE = "pr_body_kep_link"

    def test_anchored_by_pr_body_signal_alone(self, monkeypatch, tmp_path):
        features = _extract(monkeypatch, tmp_path, self.FIXTURE, "1.35")
        keps = {f["kep"] for f in features}
        assert "KEP-4817" in keps

    def test_kep_yaml_match_still_works(self, monkeypatch, tmp_path):
        features = _extract(monkeypatch, tmp_path, self.FIXTURE, "1.35")
        keps = {f["kep"] for f in features}
        assert "KEP-5067" in keps


class TestBugChangeDoesNotAnchor:
    """A `bug` kind PR that mentions a KEP in its body must NOT promote
    that KEP into the release's feature list. Bug fixes are *changes*,
    not *features*."""

    FIXTURE = "bug_change_does_not_anchor"

    def test_kep_not_anchored_by_bug_pr(self, monkeypatch, tmp_path):
        features = _extract(monkeypatch, tmp_path, self.FIXTURE, "1.35")
        keps = {f["kep"] for f in features}
        assert "KEP-1710" not in keps, (
            "PR #133425 is a bug fix; its 'Related to KEP-1710' body mention "
            "must not promote KEP-1710 to a 1.35 feature"
        )


class TestDoNotPublishFilter:
    """Upstream entries flagged do_not_publish are filtered out of changesByKind."""

    FIXTURE = "do_not_publish_filter"

    def _transform(self):
        from k8s.transform.release.builder import transform_release_notes_to_changes

        path = FIXTURES / self.FIXTURE / "release-notes-1.36.json"
        with open(path) as f:
            raw = json.load(f)
        return transform_release_notes_to_changes(raw)

    def test_flagged_entry_filtered(self):
        changes_by_kind, _ = self._transform()
        all_pr_numbers = {
            c["prNumber"] for changes in changes_by_kind.values() for c in changes
        }
        assert 131846 not in all_pr_numbers

    def test_real_entry_preserved(self):
        changes_by_kind, _ = self._transform()
        all_pr_numbers = {
            c["prNumber"] for changes in changes_by_kind.values() for c in changes
        }
        assert 200001 in all_pr_numbers
