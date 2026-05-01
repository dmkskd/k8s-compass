# Manual addition — kep.yaml stale, upstream confirms feature

KEP-2570 (Memory QoS) was originally alpha in v1.27 and has not had a kep.yaml
update since. In v1.36 the release blog and many PRs flagged Memory QoS as a
1.36 alpha highlight; the kep.yaml never got the v1.36 milestone added.

## Truth

- **1.36**: Memory QoS shipped (alpha) and is highlighted in the release.

## Inputs

- `kep.yaml` — only has `alpha: v1.27` (stale)
- `release-notes-1.36.json` — has PRs linking KEP-2570
- `curated.json` — manual entry marking KEP-2570 as alpha + isHighlight

## Expected for 1.36

- KEP-2570 IN features.
- `stage = "alpha"` (curated overrides; upstream provides the existence signal).
- `isHighlight = true`.
