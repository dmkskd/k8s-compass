# Bug-fix change must not anchor a KEP as a feature

Real example: PR #133425 in K8s 1.35 — "Fixed SELinux warning controller
not emitting events on some SELinux label conflicts". The PR's body has
"Related to KEP: kubernetes/enhancements#1710".

The change is real (a 1.35 bug fix), but **KEP-1710 (SELinux Skip Relabeling)
did NOT graduate to a new stage in 1.35**. It graduates to stable in 1.36.
We must not promote a bug-fix PR's KEP mention into a 1.35 feature.

## Inputs

- `kep.yaml` for KEP-1710 — milestones don't match 1.35.
- `release-notes-1.35.json` — one entry, PR #133425 with `kinds: ["bug"]`.
- `pr-data.json` — PR #133425 has `related_keps: ["KEP-1710"]`.

## Expected for 1.35

- KEP-1710 is NOT in the features list.
- (The PR remains in `changesByKind` — it's a real change — but that's
  outside the scope of `extract_features_for_version`.)
