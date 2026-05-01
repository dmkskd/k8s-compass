# do_not_publish filter

Upstream entries flagged `do_not_publish: true` (e.g. PRs whose release-note
field is "NONE", a leftover PR template, or a stack trace) must be skipped
before reaching `changesByKind`.

## Inputs

- `release-notes-1.36.json` with two PRs:
  - #131846 with `do_not_publish: true` (and text `"NONE"`)
  - #200001 with a real release note

## Expected

- `transform_release_notes_to_changes(...)` returns only #200001.
- #131846 is silently dropped.
