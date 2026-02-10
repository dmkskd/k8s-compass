"""Release data management commands."""

import time

import typer
from rich.console import Console
from rich.table import Table

from ..core.config import K8S_VERSIONS, OUTPUT_DIR
from ..input.repo_manager import get_current_ref, get_repo_path, pull_repo, sync_repos
from ..input.upstream_stager import get_staging_status, stage_all_releases, stage_release
from ..output.json_writer import write_api_tree, write_schemas_file, write_versions_file
from ..transform.kep.field_linker import link_all_versions, write_field_kep_links
from ..transform.openapi.schema_differ import (
    compute_diff,
    compute_field_history,
    compute_kind_history,
    write_diff,
    write_field_history,
    write_kind_history,
)
from ..transform.openapi.tree_parser import load_openapi_spec, parse_openapi_spec
from ..transform.release.builder import build_all_releases, build_release, build_release_index
from ..transform.release.changelog_parser import changelog_to_dict, parse_changelog

app = typer.Typer(name="release", help="Release data management")
console = Console()


@app.command()
def versions():
    """List all configured Kubernetes versions."""
    console.print("\n[bold]Configured Kubernetes versions:[/bold]\n")
    for ver in K8S_VERSIONS:
        console.print(f"  • {ver}")
    console.print()


@app.command("fetch-prs")
def fetch_prs_cmd(
    pr_numbers: list[int] = typer.Argument(None, help="PR numbers to fetch"),
    from_release: str | None = typer.Option(None, "--from-release", "-r", help="Extract from release JSON"),
    force: bool = typer.Option(False, "--force", "-f", help="Force refresh"),
    ttl: int = typer.Option(24, "--ttl", help="Cache TTL in hours"),
    show_rate_limit: bool = typer.Option(False, "--rate-limit", help="Show GitHub API rate limit"),
    clear_cache: bool = typer.Option(False, "--clear-cache", help="Clear PR cache"),
):
    """Fetch PR details from GitHub with caching.

    Set GITHUB_TOKEN env var for higher rate limits (5000/hr vs 60/hr).
    """
    import json

    from ..input.github_fetcher import GitHubFetcher

    fetcher = GitHubFetcher(ttl_hours=ttl)

    if show_rate_limit:
        status = fetcher.get_rate_limit_status()
        console.print("\n[bold]GitHub API Rate Limit:[/bold]")
        console.print(f"  Limit: {status.get('limit', '?')}")
        console.print(f"  Remaining: {status.get('remaining', '?')}")
        console.print(f"  Resets: {status.get('reset', '?')}")
        return

    if clear_cache:
        count = fetcher.clear_cache("prs")
        console.print(f"[green]✓ Cleared {count} cached PRs[/green]")
        return

    prs_to_fetch = list(pr_numbers) if pr_numbers else []

    if from_release:
        release_path = OUTPUT_DIR / "releases" / f"{from_release}.json"
        if not release_path.exists():
            console.print(f"[red]Release file not found: {release_path}[/red]")
            raise typer.Exit(1)

        with open(release_path) as f:
            release_data = json.load(f)

        for change in release_data.get("changes", []):
            if pr_num := change.get("prNumber"):
                if pr_num not in prs_to_fetch:
                    prs_to_fetch.append(pr_num)

        for note in release_data.get("actionRequired", []):
            if pr_num := note.get("prNumber"):
                if pr_num not in prs_to_fetch:
                    prs_to_fetch.append(pr_num)

        console.print(f"[dim]Found {len(prs_to_fetch)} PRs in release {from_release}[/dim]")

    if not prs_to_fetch:
        console.print("[yellow]No PR numbers specified. Use positional args or --from-release[/yellow]")
        raise typer.Exit(1)

    console.print(f"\n[bold]Fetching {len(prs_to_fetch)} PRs...[/bold]")

    results = fetcher.fetch_prs(prs_to_fetch, force=force)

    console.print("\n[bold]Results:[/bold]")
    for _pr_num, pr in sorted(results.items()):
        console.print(f"\n[cyan]PR #{pr.number}[/cyan]: {pr.title[:60]}...")
        console.print(f"  Author: @{pr.author}")
        if pr.related_issues:
            console.print(f"  Fixes: {', '.join(f'#{i}' for i in pr.related_issues)}")

    console.print(f"\n[green]✓ Fetched {len(results)} PRs[/green]")


@app.command()
def providers(
    provider: str | None = typer.Argument(None, help="Specific provider (eks, gke, aks, openshift)"),
    force: bool = typer.Option(False, "--force", "-f", help="Force refresh"),
):
    """Fetch K8s version support data from cloud providers."""
    try:
        from ..transform.providers.provider_versions import (
            fetch_all_providers,
            fetch_provider_versions,
            save_provider_data,
        )

        if provider:
            console.print(f"\n[bold]Fetching {provider} version data...[/bold]")
            versions = fetch_provider_versions(provider)
            result = {provider: versions}
        else:
            console.print("\n[bold]Fetching all provider version data...[/bold]")
            result = fetch_all_providers()

        if result:
            path = save_provider_data(result)
            console.print(f"\n[green]✓[/green] Saved provider data to {path}")
            for prov_id, versions in result.items():
                console.print(f"  {prov_id}: {len(versions)} versions")
        else:
            console.print("[yellow]No provider data fetched[/yellow]")

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


def _parse_all_schemas(spec: dict, version: str) -> dict:
    """Parse all kind schemas from an OpenAPI spec."""
    from ..transform.openapi.field_parser import parse_kind_schema

    definitions = spec.get("definitions", {})
    schemas = {}

    for def_name, definition in definitions.items():
        gvk_list = definition.get("x-kubernetes-group-version-kind", [])
        if not gvk_list:
            continue
        gvk = gvk_list[0]
        group = gvk.get("group", "") or "core"
        api_version = gvk.get("version", "")
        kind_name = gvk.get("kind", "")

        if not kind_name or not api_version:
            continue
        if "List" in kind_name and kind_name.endswith("List"):
            continue
        if "Options" in kind_name:
            continue

        key = f"{group}/{kind_name}"
        schema = parse_kind_schema(
            def_name, definition, group, api_version, kind_name, definitions, version
        )
        schemas[key] = schema

    return schemas


@app.command()
def process(
    version: str = typer.Argument(..., help="K8s version to process (e.g., 1.35)"),
    enrich: bool = typer.Option(True, "--enrich/--no-enrich", "-e", help="Run LLM enrichment"),
    skip_stage: bool = typer.Option(False, "--skip-stage", help="Skip staging"),
    skip_fetch: bool = typer.Option(False, "--skip-fetch", help="Skip OpenAPI fetch"),
    skip_parquet: bool = typer.Option(False, "--skip-parquet", help="Skip Parquet export"),
    skip_sync: bool = typer.Option(False, "--skip-sync", help="Skip syncing repos"),
    force: bool = typer.Option(False, "--force", "-f", help="Force rebuild"),
    llm_concurrency: int = typer.Option(1, "--llm-concurrency", help="Concurrent LLM requests"),
):
    """Run the complete pipeline for a single release.

    This command runs all pipeline steps in order:
    0. Sync upstream repos (kubernetes, enhancements, website)
    1. Stage upstream data (release-notes.json + CHANGELOG)
    2. Build release JSON with PR data
    3. Enrich KEP features with LLM
    4. Enrich changelog entries with LLM
    5. Enrich release notes with LLM
    6. Fetch/parse OpenAPI specs
    7. Generate diffs between versions
    8. Link fields to KEPs
    9. Extract component flags
    10. Extract kubectl commands
    11. Extract feature gates
    12. Export to Parquet

    Use --no-enrich to skip LLM enrichment steps (faster, no API costs).
    """
    from ..input.repo_manager import reset_to_default_branch
    from ..output.parquet import export_to_parquet

    start_time = time.time()

    console.print(f"\n[bold]{'=' * 60}[/bold]")
    console.print(f"[bold]Processing Kubernetes {version}[/bold]")
    console.print(f"[bold]{'=' * 60}[/bold]")
    console.print(f"  Enrich: {'Yes' if enrich else 'No'}")
    console.print(f"  Force: {'Yes' if force else 'No'}")
    console.print(f"  Sync repos: {'No (--skip-sync)' if skip_sync else 'Yes'}")

    if enrich:
        console.print()
        console.print("[yellow]⚠ LLM enrichment enabled - this will make API calls.[/yellow]")
        console.print("[dim]  Use --no-enrich to skip enrichment and avoid API costs.[/dim]")

    console.print()

    steps_completed = []

    try:
        # Step 0: Sync upstream repos
        if not skip_sync:
            console.print("\n[bold cyan][0/12] Syncing upstream repositories...[/bold cyan]")
            required_repos = ["kubernetes", "enhancements", "website"]
            for repo_name in required_repos:
                repo_path = get_repo_path(repo_name)
                if repo_path.exists():
                    console.print(f"  Pulling {repo_name}...")
                    pull_repo(repo_name)
                    ref = get_current_ref(repo_name)
                    console.print(f"    [dim]Current ref: {ref}[/dim]")
                else:
                    console.print(f"  Cloning {repo_name}...")
                    sync_repos([repo_name])
            steps_completed.append("sync-repos")
        else:
            console.print("\n[dim][0/12] Skipping repo sync (--skip-sync)[/dim]")

        # Step 1: Stage upstream data
        if not skip_stage:
            console.print("\n[bold cyan][1/12] Staging upstream data...[/bold cyan]")
            stage_release(version, force=force)
            steps_completed.append("stage")
        else:
            console.print("\n[dim][1/12] Skipping stage (--skip-stage)[/dim]")

        # Step 2: Build release JSON with PR data
        console.print("\n[bold cyan][2/12] Building release JSON with PR data...[/bold cyan]")
        build_release(version, force=force, with_prs=True)
        build_release_index()
        steps_completed.append("build")

        # Step 3: Enrich KEP features (optional)
        if enrich:
            console.print("\n[bold cyan][3/12] Enriching KEP features with LLM...[/bold cyan]")
            try:
                from ..transform.kep.enricher import enrich_features, save_enriched_features
                enriched = enrich_features(version, concurrency=llm_concurrency)
                if enriched:
                    save_enriched_features(version, enriched)
                    console.print(f"  [green]✓ Enriched {len(enriched)} features[/green]")
                steps_completed.append("enrich-features")
            except ImportError:
                console.print("  [yellow]⚠ strands-agents not installed, skipping[/yellow]")
            except Exception as e:
                console.print(f"  [yellow]⚠ Feature enrichment failed: {e}[/yellow]")
        else:
            console.print("\n[dim][3/12] Skipping feature enrichment (--no-enrich)[/dim]")

        # Step 4: Enrich changelog entries (optional)
        if enrich:
            console.print("\n[bold cyan][4/12] Enriching changelog entries with LLM...[/bold cyan]")
            try:
                from ..transform.release.change_enricher import enrich_changes
                enrich_changes(version, concurrency=llm_concurrency)
                steps_completed.append("enrich-changes")
            except ImportError:
                console.print("  [yellow]⚠ strands-agents not installed, skipping[/yellow]")
            except Exception as e:
                console.print(f"  [yellow]⚠ Change enrichment failed: {e}[/yellow]")
        else:
            console.print("\n[dim][4/12] Skipping change enrichment (--no-enrich)[/dim]")

        # Step 5: Enrich release notes (optional)
        if enrich:
            console.print("\n[bold cyan][5/12] Enriching release notes with LLM...[/bold cyan]")
            try:
                from ..transform.release.release_notes_enricher import enrich_release_notes
                results = enrich_release_notes(version, concurrency=llm_concurrency)
                total = sum(v for k, v in results.items() if k != "usage")
                console.print(f"  [green]✓ Enriched {total} release note items[/green]")
                steps_completed.append("enrich-release-notes")
            except ImportError:
                console.print("  [yellow]⚠ strands-agents not installed, skipping[/yellow]")
            except Exception as e:
                console.print(f"  [yellow]⚠ Release notes enrichment failed: {e}[/yellow]")
        else:
            console.print("\n[dim][5/12] Skipping release notes enrichment (--no-enrich)[/dim]")

        # Step 6: Fetch/parse OpenAPI specs
        if not skip_fetch:
            console.print("\n[bold cyan][6/12] Fetching/parsing OpenAPI specs...[/bold cyan]")
            spec = load_openapi_spec(version, use_cache=not force)
            tree = parse_openapi_spec(spec, version)
            write_api_tree(tree)
            schemas = _parse_all_schemas(spec, version)
            write_schemas_file(version, schemas)
            if get_repo_path("kubernetes").exists():
                reset_to_default_branch("kubernetes")
            # Update versions.json with all trees
            all_trees = []
            for ver in K8S_VERSIONS:
                try:
                    s = load_openapi_spec(ver, use_cache=True)
                    t = parse_openapi_spec(s, ver)
                    all_trees.append(t)
                except Exception:
                    pass
            if all_trees:
                write_versions_file(all_trees)
            steps_completed.append("fetch")
        else:
            console.print("\n[dim][6/12] Skipping OpenAPI fetch (--skip-fetch)[/dim]")

        # Step 7: Generate diffs
        console.print("\n[bold cyan][7/12] Generating version diffs...[/bold cyan]")
        versions = sorted(K8S_VERSIONS, key=lambda v: [int(x) for x in v.split(".")])
        diffs_generated = 0
        for i in range(len(versions) - 1):
            v_from, v_to = versions[i], versions[i + 1]
            try:
                d = compute_diff(v_from, v_to)
                write_diff(d)
                diffs_generated += 1
            except Exception:
                pass
        console.print(f"  [green]✓ Generated {diffs_generated} diffs[/green]")
        history = compute_field_history(versions)
        write_field_history(history)
        kind_history = compute_kind_history(versions)
        write_kind_history(kind_history)
        steps_completed.append("diff")

        # Step 8: Link fields to KEPs
        console.print("\n[bold cyan][8/12] Linking fields to KEPs...[/bold cyan]")
        results = link_all_versions()
        total_linked = sum(len(r.links) for r in results.values())
        console.print(f"  [green]✓ Linked {total_linked} fields to KEPs[/green]")
        steps_completed.append("link-keps")

        # Step 9: Extract component flags
        console.print("\n[bold cyan][9/12] Extracting component flags...[/bold cyan]")
        try:
            from ..transform.components.component_extractor import extract_component_flags
            extract_component_flags(version)
            steps_completed.append("extract-components")
        except Exception as e:
            console.print(f"  [yellow]⚠ Component extraction failed: {e}[/yellow]")

        # Step 10: Extract kubectl commands
        console.print("\n[bold cyan][10/12] Extracting kubectl commands...[/bold cyan]")
        try:
            from ..transform.components.kubectl_extractor import extract_kubectl_commands
            extract_kubectl_commands(version)
            steps_completed.append("extract-kubectl")
        except Exception as e:
            console.print(f"  [yellow]⚠ kubectl extraction failed: {e}[/yellow]")

        # Step 11: Extract feature gates
        console.print("\n[bold cyan][11/12] Extracting feature gates...[/bold cyan]")
        try:
            from ..transform.components.feature_gate_extractor import extract_feature_gates
            extract_feature_gates(version)
            steps_completed.append("extract-feature-gates")
        except Exception as e:
            console.print(f"  [yellow]⚠ Feature gate extraction failed: {e}[/yellow]")

        # Step 12: Export to Parquet
        if not skip_parquet:
            console.print("\n[bold cyan][12/12] Exporting to Parquet...[/bold cyan]")
            export_to_parquet()
            steps_completed.append("export-parquet")
        else:
            console.print("\n[dim][12/12] Skipping Parquet export (--skip-parquet)[/dim]")

        elapsed = time.time() - start_time
        console.print(f"\n[bold green]{'=' * 60}[/bold green]")
        console.print(f"[bold green]✓ Pipeline complete for {version} ({elapsed:.1f}s)[/bold green]")
        console.print(f"[bold green]{'=' * 60}[/bold green]")
        console.print(f"\nSteps completed: {', '.join(steps_completed)}")

    except Exception as e:
        console.print(f"\n[red]Pipeline failed: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command()
def stage(
    version: str = typer.Argument(None, help="K8s version"),
    all_versions: bool = typer.Option(False, "--all", "-a", help="Stage all versions"),
    force: bool = typer.Option(False, "--force", "-f", help="Re-fetch even if staged"),
):
    """Stage upstream release data for processing.

    Downloads release-notes.json from cdn.dl.k8s.io and
    CHANGELOG-X.YY.md from the kubernetes repo.
    """
    if all_versions or version is None:
        stage_all_releases(force=force)
    else:
        stage_release(version, force=force)


@app.command()
def status():
    """Show status of staged upstream data."""
    status_data = get_staging_status()

    table = Table(title="Upstream Staging Status")
    table.add_column("Version", style="cyan")
    table.add_column("Release Notes", style="green")
    table.add_column("CHANGELOG", style="green")

    for version in K8S_VERSIONS:
        v_status = status_data["versions"].get(version, {})
        notes = "✓" if v_status.get("release_notes") else "✗"
        changelog = "✓" if v_status.get("changelog") else "✗"
        table.add_row(version, notes, changelog)

    console.print(table)
    summary = status_data["summary"]
    console.print(
        f"\nTotal: {summary['release_notes']}/{len(K8S_VERSIONS)} release notes, "
        f"{summary['changelogs']}/{len(K8S_VERSIONS)} changelogs"
    )


@app.command()
def build(
    version: str = typer.Argument(None, help="K8s version"),
    all_versions: bool = typer.Option(False, "--all", "-a", help="Build all versions"),
    force: bool = typer.Option(False, "--force", "-f", help="Rebuild even if exists"),
    with_index: bool = typer.Option(True, "--index/--no-index", help="Also rebuild index.json"),
    with_prs: bool = typer.Option(False, "--with-prs", "-p", help="Fetch GitHub PR details"),
):
    """Build release JSON from staged upstream data.

    Use --with-prs to fetch PR details from GitHub and enrich changes with:
    - userFacingChange: The release note from PR body
    - relatedIssues: Issues referenced via "Fixes #xxx"
    - relatedKeps: Additional KEPs mentioned in PR body

    Set GITHUB_TOKEN env var for higher rate limits (5000/hr vs 60/hr).
    """
    try:
        if all_versions or version is None:
            build_all_releases(force=force, with_prs=with_prs)
        else:
            build_release(version, force=force, with_prs=with_prs)

        if with_index:
            build_release_index()
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("parse-changelog")
def parse_changelog_cmd(
    version: str = typer.Argument(..., help="K8s version"),
    output: str | None = typer.Option(None, "--output", "-o", help="Output JSON file"),
):
    """Parse a staged CHANGELOG file and extract structured data."""
    import json
    from pathlib import Path

    try:
        parsed = parse_changelog(version)
        result = changelog_to_dict(parsed)

        if output:
            out_path = Path(output)
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(json.dumps(result, indent=2))
            console.print(f"[green]✓[/green] Wrote {output}")
        else:
            console.print(f"\n[bold]CHANGELOG-{version}.md Summary[/bold]")
            console.print(f"  Action required notes: {len(result['actionRequired'])}")
            console.print(f"  Security CVEs: {len(result['securityInformation'])}")
            console.print(f"  Patch releases: {len(result['patchReleases'])}")
    except FileNotFoundError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise typer.Exit(1)


@app.command("enrich-changes")
def enrich_changes_cmd(
    version: str = typer.Argument(..., help="K8s version to enrich"),
    kind: str | None = typer.Option(None, "--kind", "-k", help="Specific change kind"),
    provider: str | None = typer.Option(None, "--provider", "-p", help="Model provider"),
    model: str | None = typer.Option(None, "--model", "-m", help="Specific model ID"),
    max_changes: int | None = typer.Option(None, "--max", "-n", help="Max changes to process"),
    only_with_issues: bool = typer.Option(False, "--with-issues", "-i", help="Only with linked issues"),
    force: bool = typer.Option(False, "--force", "-f", help="Re-enrich existing"),
    skip_patches: bool = typer.Option(False, "--skip-patches", help="Skip patch releases"),
    llm_concurrency: int = typer.Option(1, "--llm-concurrency", help="Concurrent LLM requests"),
    batch: bool = typer.Option(False, "--batch", "-b", help="Process in batches"),
    batch_size: int = typer.Option(5, "--batch-size", help="Batch size"),
):
    """Enrich release changes with LLM-generated context.

    Transforms dry release notes into rich descriptions that answer:
    - What was the problem?
    - Who was affected?
    - What's the fix?
    - Why does it matter?

    Run 'release build --with-prs' first to fetch PR/issue data.
    """
    try:
        from ..transform.release.change_enricher import enrich_changes, enrich_changes_batch

        if batch:
            results = enrich_changes_batch(
                version,
                kind=kind,
                provider=provider,
                model_id=model,
                batch_size=batch_size,
                only_with_issues=only_with_issues,
            )
        else:
            results = enrich_changes(
                version,
                kind=kind,
                provider=provider,
                model_id=model,
                max_changes=max_changes,
                only_with_issues=only_with_issues,
                skip_enriched=not force,
                include_patches=not skip_patches,
                concurrency=llm_concurrency,
            )

        if results:
            for _change_kind, changes in results.items():
                for change in changes:
                    if enrichment := change.get("enrichment"):
                        console.print("\n[bold]Sample enriched change:[/bold]")
                        console.print(f"  PR: #{change.get('prNumber', '?')}")
                        console.print(f"  [cyan]Problem:[/cyan] {enrichment['problem'][:100]}...")
                        console.print(f"  [cyan]Fix:[/cyan] {enrichment['fix'][:100]}...")
                        break
                else:
                    continue
                break

    except ImportError as e:
        console.print(f"[red]Error: {e}[/red]")
        console.print("\n[yellow]Install strands-agents:[/yellow]")
        console.print("  uv pip install 'strands-agents[anthropic]'")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("enrich-notes")
def enrich_notes_cmd(
    version: str = typer.Argument(..., help="K8s version to enrich"),
    categories: list[str] | None = typer.Option(None, "--category", "-c", help="Categories: urgent, deprecations"),
    provider: str | None = typer.Option(None, "--provider", "-p", help="Model provider"),
    max_items: int | None = typer.Option(None, "--max", "-n", help="Max items per category"),
    skip_enriched: bool = typer.Option(True, "--skip-enriched/--no-skip", help="Skip already enriched"),
    llm_concurrency: int = typer.Option(1, "--llm-concurrency", help="Concurrent LLM requests"),
):
    """Enrich release notes with LLM-generated structured content.

    Enriches:
    - urgent: Urgent upgrade notes → title, summary, action, severity
    - deprecations: Deprecation notices → impact, migration steps
    """
    try:
        from ..transform.release.release_notes_enricher import enrich_release_notes

        results = enrich_release_notes(
            version,
            categories=categories,
            provider=provider,
            max_items=max_items,
            skip_enriched=skip_enriched,
            concurrency=llm_concurrency,
        )

        console.print("\n[bold]Enrichment Summary:[/bold]")
        for category, count in results.items():
            console.print(f"  {category}: {count} items enriched")

    except ImportError as e:
        console.print(f"[red]Error: {e}[/red]")
        console.print("\n[yellow]Install strands-agents:[/yellow]")
        console.print("  pip install 'strands-agents[anthropic]'")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)
