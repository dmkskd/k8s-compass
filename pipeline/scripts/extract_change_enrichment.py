#!/usr/bin/env python3
"""Extract change enrichment data from release JSONs into separate files.

One-time migration: for each version, reads {version}.json, extracts enrichment
from changesByKind entries, and writes to {version}-changes-enriched.json keyed
by prNumber.

Usage:
    python pipeline/scripts/extract_change_enrichment.py
    python pipeline/scripts/extract_change_enrichment.py --version 1.35
    python pipeline/scripts/extract_change_enrichment.py --dry-run
"""

import argparse
import hashlib
import json
from pathlib import Path

RELEASES_DIR = Path(__file__).resolve().parent.parent / "data" / "output" / "json" / "releases"


def change_key(change: dict) -> str:
    if pr := change.get("prNumber"):
        return str(pr)
    desc = change.get("description", "")
    return f"desc:{hashlib.sha256(desc.encode()).hexdigest()[:16]}"


def extract_version(version: str, dry_run: bool = False) -> int:
    release_path = RELEASES_DIR / f"{version}.json"
    if not release_path.exists():
        print(f"  [SKIP] {version}.json not found")
        return 0

    with open(release_path) as f:
        data = json.load(f)

    enrichment_data: dict[str, dict] = {}

    for kind, entries in data.get("changesByKind", {}).items():
        for entry in entries:
            if enrichment := entry.get("enrichment"):
                enrichment_data[change_key(entry)] = enrichment

    for patch in data.get("patchReleases", []):
        for kind, entries in patch.get("changesByKind", {}).items():
            for entry in entries:
                if enrichment := entry.get("enrichment"):
                    enrichment_data[change_key(entry)] = enrichment

    if not enrichment_data:
        print(f"  [SKIP] {version}: no enrichment data found")
        return 0

    if dry_run:
        print(f"  [DRY] {version}: would extract {len(enrichment_data)} enrichments")
    else:
        output_path = RELEASES_DIR / f"{version}-changes-enriched.json"
        with open(output_path, "w") as f:
            json.dump(enrichment_data, f, indent=2)
        print(f"  [OK] {version}: extracted {len(enrichment_data)} enrichments -> {output_path.name}")

    return len(enrichment_data)


def main():
    parser = argparse.ArgumentParser(description="Extract change enrichment from release JSONs")
    parser.add_argument("--version", help="Single version to extract (e.g. 1.35)")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be extracted")
    args = parser.parse_args()

    if args.version:
        extract_version(args.version, dry_run=args.dry_run)
    else:
        total = 0
        for release_file in sorted(RELEASES_DIR.glob("*.json")):
            if "-" in release_file.stem or release_file.name in ("index.json", "schema.json", "schema-v2.json"):
                continue
            total += extract_version(release_file.stem, dry_run=args.dry_run)
        print(f"\nTotal: {total} enrichments extracted")


if __name__ == "__main__":
    main()
