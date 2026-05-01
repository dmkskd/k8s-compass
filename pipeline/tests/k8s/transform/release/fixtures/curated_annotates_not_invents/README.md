# Curated annotates, does not invent

A stale curated entry shouldn't be able to materialize a feature in a release
when neither kep.yaml nor upstream PRs put the KEP in that release.

## Scenario

KEP-1710 (SELinux Skip Relabeling) was at one point planned for 1.34 and a
curated entry got created. The KEP slipped to 1.36; kep.yaml was corrected.
The 1.34-curated entry was forgotten and is now stale.

## Inputs

- `kep.yaml` — `stable: v1.36` (no 1.34 milestone)
- `release-notes-1.34.json` — no KEP-1710 PRs
- `curated.json` — leftover entry saying KEP-1710 is stable in 1.34

## Expected for 1.34

- KEP-1710 NOT in features. Curated entry is ignored — no signal to anchor it.
