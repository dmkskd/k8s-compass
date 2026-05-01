# Stage history honesty

The `history` field on each feature must reflect the **current** kep.yaml
state, not a stale snapshot from an earlier build.

## Inputs

- `kep.yaml` for KEP-5004 — `alpha: v1.34, beta: v1.36, stable: v1.37`
- `release-notes-1.36.json` — has PRs for KEP-5004

## Expected for 1.36

- KEP-5004 IN features.
- `stage = "beta"` (kep.yaml says beta=v1.36).
- `history.alpha == "1.34"`
- `history.beta == "1.36"`
- `history.stable == "1.37"` (future milestone — included as planned/tentative).
