"""KEP & feature management commands."""

import typer
from rich.console import Console
from rich.table import Table

from ..transform.kep.field_linker import (
    link_all_versions,
    link_fields_to_keps,
    write_field_kep_links,
)
from ..transform.kep.parser import (
    build_features_summary,
    extract_features_all_versions,
    extract_features_for_version,
    features_to_dict,
)

app = typer.Typer(name="kep", help="KEP & feature management")
console = Console()


@app.command("compare-models")
def compare_models_cmd(
    version: str = typer.Argument(..., help="K8s version to use"),
    models: list[str] = typer.Argument(..., help="Model IDs to compare"),
    max_features: int = typer.Option(3, "--max", "-n", help="Number of features"),
    provider: str = typer.Option("ollama", "--provider", "-p", help="Model provider"),
):
    """Compare LLM enrichment output across different models.

    Example:
        kep compare-models 1.35 qwen3:8b qwen3:32b --max 3
    """
    try:
        from ..transform.kep.enricher import (
            enrich_feature_with_llm,
            get_kep_readme,
            get_provider_config,
            load_config,
        )

        config = load_config()
        _, provider_config = get_provider_config(config, provider)

        console.print(f"\n[bold]Comparing {len(models)} models on {max_features} features[/bold]")

        features = extract_features_for_version(version)[:max_features]

        for feature in features:
            console.print(f"\n{'='*80}")
            console.print(f"[bold cyan]KEP {feature.kep}: {feature.title}[/bold cyan]")

            readme = get_kep_readme(feature.kep_path)
            if not readme:
                console.print("[yellow]  No README found, skipping[/yellow]")
                continue

            results = {}
            for model_id in models:
                console.print(f"\n[dim]Running {model_id}...[/dim]")
                result = enrich_feature_with_llm(feature, readme, provider, provider_config, model_id)
                results[model_id] = result

            console.print("\n[bold]Description:[/bold]")
            for model_id, result in results.items():
                desc = result.description[:150] + "..." if result and len(result.description) > 150 else (result.description if result else "(failed)")
                console.print(f"  [{model_id}] {desc}")

        console.print(f"\n{'='*80}")
        console.print("[green]✓ Comparison complete[/green]")

    except ImportError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("suggest-labels")
def suggest_labels_cmd(
    kep: str = typer.Argument(..., help="KEP identifier or title text"),
    method: str = typer.Option("hybrid", "--method", "-m", help="Method: embedding, llm, hybrid"),
    top_k: int = typer.Option(5, "--top", "-k", help="Number of labels to suggest"),
):
    """Suggest labels for a KEP using embeddings and/or LLM."""
    try:
        from ..transform.content.label_suggester import suggest_labels

        labels = suggest_labels(kep, method=method, top_k=top_k)

        console.print(f"\n[bold]Suggested labels for: {kep[:50]}...[/bold]\n")
        for label, score in labels:
            console.print(f"  {label}: {score:.2f}")

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("label-features")
def label_features_cmd(
    version: str = typer.Argument(..., help="K8s version (e.g., 1.35)"),
    method: str = typer.Option("hybrid", "--method", "-m", help="Method: embedding, llm, hybrid"),
    force: bool = typer.Option(False, "--force", "-f", help="Re-label existing"),
):
    """Add labels to all features in a release."""
    try:
        from ..transform.content.label_suggester import label_all_features

        result = label_all_features(version, method=method, force=force)

        console.print(f"\n[green]✓[/green] Labeled {len(result)} features")

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("list-labels")
def list_labels_cmd():
    """List all labels in the curated taxonomy."""
    try:
        from ..transform.content.taxonomy_builder import load_taxonomy

        taxonomy = load_taxonomy()

        console.print("\n[bold]Label Taxonomy:[/bold]\n")
        
        # Handle nested taxonomy structure with categories
        categories = taxonomy.get("categories", taxonomy)
        
        for category, data in categories.items():
            console.print(f"[cyan]{category}[/cyan]")
            
            # Handle both old format (list) and new format (dict with related_terms)
            if isinstance(data, dict):
                description = data.get("description", "")
                if description:
                    console.print(f"  [dim]{description}[/dim]")
                labels = data.get("related_terms", [])
            else:
                labels = list(data) if not isinstance(data, list) else data
            
            for label in labels[:10]:
                console.print(f"  • {label}")
            if len(labels) > 10:
                console.print(f"  ... +{len(labels) - 10} more")

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("build-taxonomy")
def build_taxonomy_cmd(
    method: str = typer.Option("clustering", "--method", "-m", help="Method: clustering, llm, hybrid"),
    min_count: int = typer.Option(2, "--min-count", help="Minimum label occurrences"),
):
    """Build a data-driven label taxonomy from KEP metadata."""
    try:
        from ..transform.content.taxonomy_builder import build_taxonomy

        taxonomy = build_taxonomy(method=method, min_count=min_count)

        console.print(f"\n[green]✓[/green] Built taxonomy with {len(taxonomy)} categories")

        for category, labels in list(taxonomy.items())[:5]:
            console.print(f"\n[cyan]{category}[/cyan]")
            for label in labels[:5]:
                console.print(f"  • {label}")

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command()
def build(
    version: str = typer.Argument(None, help="K8s version"),
    all_versions: bool = typer.Option(False, "--all", "-a", help="Build for all versions"),
    output: str | None = typer.Option(None, "--output", "-o", help="Output JSON file"),
):
    """Extract KEP features from the enhancements repo.

    Scans kep.yaml files in pipeline/repos/enhancements and finds KEPs
    that graduated (alpha/beta/stable) in the specified version.
    """
    import json
    from pathlib import Path

    try:
        if all_versions or version is None:
            results = extract_features_all_versions()

            table = Table(title="KEP Features by Version")
            table.add_column("Version", style="cyan")
            table.add_column("Total", justify="right")
            table.add_column("Stable", justify="right", style="green")
            table.add_column("Beta", justify="right", style="yellow")
            table.add_column("Alpha", justify="right", style="dim")

            for ver in sorted(results.keys(), key=lambda v: [int(x) for x in v.split(".")]):
                features = results[ver]
                summary = build_features_summary(features)
                table.add_row(
                    ver,
                    str(summary["total"]),
                    str(summary["stable"]),
                    str(summary["beta"]),
                    str(summary["alpha"]),
                )

            console.print(table)
        else:
            features = extract_features_for_version(version)

            if output:
                out_path = Path(output)
                out_path.parent.mkdir(parents=True, exist_ok=True)
                out_path.write_text(json.dumps(features_to_dict(features), indent=2))
                console.print(f"[green]✓[/green] Wrote {len(features)} features to {output}")
            else:
                table = Table(title=f"KEP Features for {version}")
                table.add_column("KEP", style="cyan")
                table.add_column("Title")
                table.add_column("Stage", style="green")
                table.add_column("SIG")
                table.add_column("Feature Gate", style="dim")

                for f in features:
                    table.add_row(
                        f.kep,
                        f.title[:50] + "..." if len(f.title) > 50 else f.title,
                        f.stage,
                        f.sig,
                        f.feature_gate or "-",
                    )

                console.print(table)

                summary = build_features_summary(features)
                console.print(
                    f"\nTotal: {summary['total']} "
                    f"(Stable: {summary['stable']}, Beta: {summary['beta']}, Alpha: {summary['alpha']})"
                )
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command()
def enrich(
    version: str = typer.Argument(..., help="K8s version to enrich"),
    provider: str | None = typer.Option(None, "--provider", "-p", help="Model provider"),
    model: str | None = typer.Option(None, "--model", "-m", help="Specific model ID"),
    max_features: int | None = typer.Option(None, "--max", help="Max features to process"),
    save: bool = typer.Option(True, "--save/--no-save", help="Save enriched features"),
    use_cache: bool = typer.Option(True, "--cache/--no-cache", help="Use pre-computed metadata"),
    llm_concurrency: int = typer.Option(1, "--llm-concurrency", help="Concurrent LLM requests"),
):
    """Enrich KEP features with LLM-generated descriptions.

    By default, uses pre-computed metadata from kep_metadata.json.
    Falls back to LLM for KEPs not in cache.

    Extracts:
    - description: What the feature does
    - impact: How it affects users
    - affectedKinds: Which K8s resources are affected
    - affectedFields: Which API fields are added/modified
    - labels: Topic labels for categorization
    """
    try:
        from ..transform.kep.enricher import enrich_features, save_enriched_features

        enriched = enrich_features(
            version,
            provider=provider,
            model_id=model,
            max_features=max_features,
            use_cache=use_cache,
            concurrency=llm_concurrency,
        )

        if save and enriched:
            path = save_enriched_features(version, enriched)
            console.print(f"\n[green]✓[/green] Saved {len(enriched)} enriched features to {path}")

        if enriched:
            console.print("\n[bold]Sample enriched feature:[/bold]")
            sample = next((f for f in enriched if f.get("description")), enriched[0])
            console.print(f"  KEP: {sample['kep']}")
            console.print(f"  Title: {sample['title']}")
            console.print(f"  Description: {sample.get('description', '(none)')[:100]}...")
            console.print(f"  Labels: {sample.get('labels', [])}")

    except ImportError as e:
        console.print(f"[red]Error: {e}[/red]")
        console.print("\n[yellow]Install strands-agents:[/yellow]")
        console.print("  pip install 'strands-agents[ollama]'")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command()
def link(
    version: str = typer.Argument(None, help="K8s version to link"),
    all_versions: bool = typer.Option(False, "--all", "-a", help="Link all versions"),
):
    """Link new fields to their associated KEPs.

    Uses heuristic matching:
    - Feature gate matching
    - Affected fields from KEP
    - Kind + text similarity
    """
    try:
        if all_versions or version is None:
            results = link_all_versions()

            total_linked = sum(len(r.links) for r in results.values())
            total_unlinked = sum(len(r.unlinked_fields) for r in results.values())
            total = total_linked + total_unlinked

            console.print("\n[bold]Summary:[/bold]")
            console.print(f"  Total fields: {total}")
            console.print(f"  Linked: {total_linked} ({total_linked/total*100:.0f}%)")
            console.print(f"  Unlinked: {total_unlinked}")
        else:
            result = link_fields_to_keps(version)
            if result.links:
                path = write_field_kep_links(result)
                console.print(f"\n[green]✓[/green] Wrote {path}")
                console.print(f"  Linked: {len(result.links)}")
                console.print(f"  Unlinked: {len(result.unlinked_fields)}")

                if result.links:
                    console.print("\n[bold]Top matches:[/bold]")
                    for link in sorted(result.links, key=lambda x: -x.confidence)[:10]:
                        console.print(
                            f"  {link.field_path} → {link.kep} "
                            f"[dim]({link.confidence:.0%} - {link.match_reason})[/dim]"
                        )
            else:
                console.print(f"[yellow]No links found for {version}[/yellow]")
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("extract-metadata")
def extract_metadata_cmd(
    provider: str | None = typer.Option(None, "--provider", "-p", help="Model provider"),
    model: str | None = typer.Option(None, "--model", "-m", help="Specific model ID"),
    max_keps: int | None = typer.Option(None, "--max", "-n", help="Max KEPs to process"),
    force: bool = typer.Option(False, "--force", "-f", help="Re-process all KEPs"),
    concurrency: int = typer.Option(10, "--concurrency", "-c", help="Concurrent requests"),
    skip_sync: bool = typer.Option(False, "--skip-sync", help="Skip syncing enhancements repo"),
):
    """Extract metadata from ALL KEPs in the enhancements repo.

    This is a one-off command to build the central KEP metadata store.

    Extracts for each KEP:
    - summary: 2-3 sentence description
    - labels: Topic labels for categorization
    - affectedKinds: K8s resources with API changes
    - affectedFields: New API fields
    - keyConcepts: Technical concepts
    """
    try:
        if not skip_sync:
            from ..input.repo_manager import get_repo_path, pull_repo, sync_repos

            repo_path = get_repo_path("enhancements")
            if repo_path.exists():
                console.print("[bold]Updating enhancements repo...[/bold]")
                pull_repo("enhancements")
            else:
                console.print("[bold]Cloning enhancements repo...[/bold]")
                sync_repos(["enhancements"])
            console.print()

        from ..transform.kep.metadata_extractor import OUTPUT_PATH, extract_all_keps

        metadata = extract_all_keps(
            provider=provider,
            model_id=model,
            max_keps=max_keps,
            skip_existing=not force,
            concurrency=concurrency,
        )

        console.print(f"\n[green]✓[/green] Metadata saved to {OUTPUT_PATH}")
        console.print(f"  Total KEPs: {len(metadata.get('keps', {}))}")

        all_labels: dict[str, int] = {}
        for kep_data in metadata.get("keps", {}).values():
            for label in kep_data.get("labels", []):
                all_labels[label] = all_labels.get(label, 0) + 1

        if all_labels:
            console.print("\n[bold]Top labels:[/bold]")
            for label, count in sorted(all_labels.items(), key=lambda x: -x[1])[:15]:
                console.print(f"  {label}: {count}")

    except ImportError as e:
        console.print(f"[red]Error: {e}[/red]")
        console.print("\n[yellow]Install strands-agents:[/yellow]")
        console.print("  pip install 'strands-agents[ollama]'")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("normalize-labels")
def normalize_labels_cmd(
    provider: str | None = typer.Option(None, "--provider", "-p", help="Model provider"),
    model: str | None = typer.Option(None, "--model", "-m", help="Specific model ID"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Preview without saving"),
    stats: bool = typer.Option(False, "--stats", help="Show label statistics"),
):
    """Normalize and consolidate KEP labels.

    Pass 2 of KEP metadata extraction.
    Uses LLM to merge similar labels for consistency.
    """
    try:
        from ..transform.kep.label_normalizer import normalize_labels, show_label_stats

        if stats:
            show_label_stats()
            return

        normalize_labels(
            provider=provider,
            model_id=model,
            dry_run=dry_run,
        )

    except ImportError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)
