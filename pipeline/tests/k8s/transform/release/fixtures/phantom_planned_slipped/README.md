# Phantom: planned milestone, slipped before release

KEP-1710 (SELinux Skip Relabeling) was originally targeted for stable in v1.34.
The GA slipped to v1.36; the kep.yaml was updated after the fact.

## Truth

- **1.34**: KEP-1710 was NOT shipped. No PRs in 1.34 release-notes reference it.
- **1.36**: KEP-1710 graduated to stable. PRs in 1.36 release-notes reference it.

## Inputs

- `keps/sig-storage/1710-selinux-relabeling/kep.yaml` — current state (`stable: v1.36`)
- `release-notes-1.34.json` — no KEP-1710 references
- `release-notes-1.36.json` — has KEP-1710 reference

## Expected resolver output

- Resolving for **1.34**: KEP-1710 NOT in features.
- Resolving for **1.36**: KEP-1710 IN features, `stage=stable`.
