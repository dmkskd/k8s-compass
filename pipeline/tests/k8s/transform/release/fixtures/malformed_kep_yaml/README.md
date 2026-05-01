# Malformed kep.yaml — bad date must not drop a real KEP

A kep.yaml file in the enhancements repo can have invalid date fields
(e.g. `creation-date: 2025-13-01` — month 13). Real examples: KEP-4355,
KEP-5075. We don't read those date fields, so they should not affect
extraction.

## Inputs

- `kep.yaml` for KEP-9999 with `creation-date: 2025-13-01` AND `alpha: v1.35`.
- `release-notes-1.35.json` — unrelated entry.

## Expected

- Parsing succeeds (the YAML loader keeps timestamp strings as strings).
- KEP-9999 IS in the 1.35 output features (alpha milestone matches).
