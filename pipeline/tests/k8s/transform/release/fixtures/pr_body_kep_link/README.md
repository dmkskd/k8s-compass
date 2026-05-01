# PR body KEP link — third signal beyond release-notes documentation field

Some KEPs have real shipping work in a release, but the PR authors did not
fill in the structured `documentation: [{type: KEP, ...}]` field in their
release note. The KEP reference only lives in the PR body.

Real examples in 1.35:
- KEP-5067 (Pod Generation) — promoted to GA via PR #134948.
- KEP-4817 (DRA Resource Claim Device Status) — config change via PR #134905.

Neither PR's release-notes.json entry has the structured KEP doc field, so
the upstream signal misses them. The PR enrichment step (`--with-prs`) does
parse PR bodies and extract `related_keps`. Resolver should accept that as
a third anchor signal.

## Inputs

- `kep.yaml` for KEP-5067 (`stable: v1.35`) and KEP-4817 (`stable: v1.36`).
  Note: KEP-5067 ALSO has a kep.yaml milestone match for 1.35 — it's
  included to test that PR-body signal would still anchor it even if the
  kep.yaml wasn't updated. KEP-4817 has NO 1.35 milestone.
- `release-notes-1.35.json` — three PRs, none with structured KEP docs.
- `pr-data.json` — maps PR number to `related_keps` (parsed from PR body).

## Expected for 1.35

- KEP-5067 IN features (anchored by kep.yaml milestone OR PR-body signal).
- KEP-4817 IN features (anchored by PR-body signal alone).
