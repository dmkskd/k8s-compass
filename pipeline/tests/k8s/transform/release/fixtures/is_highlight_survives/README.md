# isHighlight survives rebuild

The `isHighlight` flag is a curatorial decision (not derivable from upstream
data). It must be preserved through the merge step for KEPs that are present
in extraction.

## Inputs

- `kep.yaml` for KEP-127 (User Namespaces) — `stable: v1.36`
- `release-notes-1.36.json` — has PRs for KEP-127
- `curated.json` — `{ kep: KEP-127, isHighlight: true }` (no other fields)

## Expected for 1.36

- KEP-127 IN features.
- `isHighlight = true` (preserved from curated).
- Other fields (title, stage, sig, history) come from extraction.
