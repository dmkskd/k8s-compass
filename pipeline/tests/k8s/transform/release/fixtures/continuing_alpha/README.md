# Continuing alpha — work shipped, no graduation

KEP-5004 (DRA Extended Resource) graduated to alpha in v1.34.
Beta was originally planned for v1.35 but slipped to v1.36.
Real PRs touching this feature still shipped in v1.35.

## Truth

- **1.34**: alpha graduation. (not tested here; covered by other fixtures)
- **1.35**: NO stage promotion. But several PRs reference KEP-5004.
  → Feature should be in 1.35, still as alpha.
- **1.36**: beta graduation. (not tested here)

## Inputs

- `kep.yaml` — current state: alpha=v1.34, beta=v1.36, stable=v1.37 (no v1.35 entry)
- `release-notes-1.35.json` — has PRs linking KEP-5004

## Expected resolver output for 1.35

- KEP-5004 IN features.
- `stage = "alpha"` (carried forward from the most recent earlier milestone).
