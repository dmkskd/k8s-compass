"""External content management commands."""

import typer
from rich.console import Console
from rich.table import Table

app = typer.Typer(name="content", help="External content management")
console = Console()


@app.command()
def add(
    url: str = typer.Argument(..., help="Content URL"),
    title: str = typer.Argument(..., help="Content title"),
    content_type: str = typer.Argument(..., help="Type: blog, documentation, video, tutorial, etc."),
    source: str = typer.Argument(..., help="Source domain (e.g., kubernetes.io)"),
    official: bool = typer.Option(False, "--official", "-o", help="Mark as official K8s content"),
    date: str | None = typer.Option(None, "--date", "-d", help="Published date (YYYY-MM-DD)"),
    author: str | None = typer.Option(None, "--author", "-a", help="Author name"),
    summary: str | None = typer.Option(None, "--summary", "-s", help="Brief summary"),
    tags: str | None = typer.Option(None, "--tags", "-t", help="Comma-separated tags"),
    release: str | None = typer.Option(None, "--release", "-r", help="Link to release (e.g., 1.35)"),
    kep: str | None = typer.Option(None, "--kep", "-k", help="Link to KEP (e.g., KEP-4017)"),
    kind: str | None = typer.Option(None, "--kind", help="Link to Kind (e.g., Pod)"),
    kind_group: str | None = typer.Option(None, "--kind-group", help="Kind's API group"),
):
    """Add external content (blog post, documentation, video, etc.) with links."""
    from ..transform.content.content_links import add_content

    links = []
    if release:
        links.append({"targetType": "release", "targetId": release})
    if kep:
        links.append({"targetType": "kep", "targetId": kep})
    if kind:
        link = {"targetType": "kind", "targetId": kind}
        if kind_group:
            link["targetGroup"] = kind_group
        links.append(link)

    if not links:
        console.print("[yellow]Warning: No links specified.[/yellow]")

    tag_list = [t.strip() for t in tags.split(",")] if tags else None

    add_content(
        url=url,
        title=title,
        content_type=content_type,
        source=source,
        links=links,
        is_official=official,
        published_date=date,
        author=author,
        summary=summary,
        tags=tag_list,
    )

    console.print(f"[green]✓ Added content: {title}[/green]")
    console.print(f"  Links: {len(links)} target(s)")
    console.print("\n[yellow]Run 'export parquet' to update the UI data[/yellow]")


@app.command()
def list(
    show_files: bool = typer.Option(False, "--files", "-f", help="Show content files breakdown"),
):
    """List all curated content links."""
    from ..transform.content.content_links import list_content_files, load_all_content

    if show_files:
        list_content_files()
        return

    data = load_all_content()
    content_list = data.get("content", [])

    if not content_list:
        console.print("[dim]No content found[/dim]")
        return

    table = Table(title=f"Content Links ({len(content_list)} items)")
    table.add_column("Type", style="cyan", width=12)
    table.add_column("Official", style="green", width=8)
    table.add_column("Title", width=40)
    table.add_column("Source", width=15)
    table.add_column("Links", width=30)

    for content in content_list:
        official = "✓" if content.get("isOfficial") else ""

        link_strs = []
        for link in content.get("links", []):
            target = f"{link['targetType']}:{link['targetId']}"
            if link.get("targetGroup"):
                target += f"@{link['targetGroup']}"
            link_strs.append(target)
        links_str = ", ".join(link_strs) if link_strs else "-"

        table.add_row(
            content.get("type", ""),
            official,
            content.get("title", "")[:40],
            content.get("source", ""),
            links_str,
        )

    console.print(table)


@app.command()
def split():
    """Split content_links.json into separate files by conference."""
    from ..transform.content.content_links import list_content_files, split_content_by_conference

    console.print("\n[bold]Splitting content by conference...[/bold]\n")
    results = split_content_by_conference()

    if results:
        console.print("\n[bold]Results:[/bold]")
        for conf_id, count in results.items():
            console.print(f"  {conf_id}: {count} items")
    else:
        console.print("[dim]No conference content found to split[/dim]")

    console.print("\n[bold]Content files:[/bold]")
    list_content_files()


@app.command("fetch-sched")
def fetch_sched_cmd(
    conference: str = typer.Argument(None, help="Conference ID (e.g., kubecon-na-2024)"),
    list_conferences: bool = typer.Option(False, "--list", "-l", help="List available conferences"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Preview without saving"),
    max_sessions: int | None = typer.Option(None, "--max", "-n", help="Limit sessions"),
    no_enrich: bool = typer.Option(False, "--no-enrich", help="Skip LLM enrichment"),
):
    """Import conference sessions from Sched.com."""
    try:
        from ..transform.content.sched_fetcher import SCHED_CONFERENCES, import_sched_sessions

        if list_conferences:
            console.print("\n[bold]Available conferences:[/bold]")
            for conf_id, conf_data in SCHED_CONFERENCES.items():
                console.print(f"  {conf_id}: {conf_data.get('name', conf_id)}")
            return

        if not conference:
            console.print("[yellow]Specify a conference ID or use --list[/yellow]")
            raise typer.Exit(1)

        result = import_sched_sessions(
            conference,
            dry_run=dry_run,
            max_sessions=max_sessions,
            enrich=not no_enrich,
        )

        if result:
            console.print(f"\n[green]✓[/green] Imported {result} sessions")
        else:
            console.print("[yellow]No sessions imported[/yellow]")

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("fetch-youtube")
def fetch_youtube_cmd(
    conference: str = typer.Argument(None, help="Conference ID (e.g., kubecon-na-2024)"),
    list_playlists: bool = typer.Option(False, "--list", "-l", help="List available playlists"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Preview without saving"),
    max_videos: int | None = typer.Option(None, "--max", "-n", help="Limit videos"),
):
    """Import videos from CNCF YouTube playlists.

    Requires YOUTUBE_API_KEY environment variable.
    """
    try:
        from ..transform.content.youtube_fetcher import PLAYLISTS, fetch_youtube_videos

        if list_playlists:
            console.print("\n[bold]Available playlists:[/bold]")
            for conf_id, playlist_data in PLAYLISTS.items():
                console.print(f"  {conf_id}: {playlist_data.get('name', conf_id)}")
            return

        if not conference:
            console.print("[yellow]Specify a conference ID or use --list[/yellow]")
            raise typer.Exit(1)

        result = fetch_youtube_videos(
            conference,
            dry_run=dry_run,
            max_videos=max_videos,
        )

        if result:
            console.print(f"\n[green]✓[/green] Imported {len(result)} videos")
        else:
            console.print("[yellow]No videos imported[/yellow]")

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("re-enrich")
def re_enrich_cmd(
    conference: str = typer.Argument(..., help="Conference ID (e.g., kubecon-na-2024)"),
    max_sessions: int | None = typer.Option(None, "--max", "-n", help="Limit sessions"),
    force: bool = typer.Option(False, "--force", "-f", help="Re-enrich all sessions"),
):
    """Re-enrich existing sessions to fix labels."""
    try:
        from ..transform.content.sched_fetcher import re_enrich_sessions

        result = re_enrich_sessions(conference, max_sessions=max_sessions, force=force)

        if result:
            console.print(f"\n[green]✓[/green] Re-enriched {len(result)} sessions")
        else:
            console.print("[yellow]No sessions re-enriched[/yellow]")

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command("list-conferences")
def list_conferences_cmd(
    conference: str | None = typer.Option(None, "--conference", "-c", help="Filter by conference"),
    topic: str | None = typer.Option(None, "--topic", "-t", help="Filter by topic label"),
):
    """List imported conference content."""
    from ..transform.content.content_links import load_all_content

    data = load_all_content()
    content_list = data.get("content", [])

    # Filter to conference content
    sessions = [c for c in content_list if any(
        label.startswith("kubecon-") for label in c.get("labels", [])
    )]

    if conference:
        sessions = [s for s in sessions if conference in s.get("labels", [])]

    if topic:
        sessions = [s for s in sessions if topic in s.get("labels", [])]

    if not sessions:
        console.print("[dim]No conference content found[/dim]")
        return

    table = Table(title=f"Conference Content ({len(sessions)} items)")
    table.add_column("Conference", style="cyan", width=18)
    table.add_column("Title", width=50)
    table.add_column("Type", width=12)

    for session in sessions[:50]:
        conf_labels = [l for l in session.get("labels", []) if l.startswith("kubecon-")]
        conf = conf_labels[0] if conf_labels else "-"
        table.add_row(
            conf,
            session.get("title", "")[:50],
            session.get("type", ""),
        )

    console.print(table)
    if len(sessions) > 50:
        console.print(f"\n[dim]... and {len(sessions) - 50} more[/dim]")


@app.command("add-talk")
def add_talk_cmd(
    conference: str = typer.Argument(..., help="Conference ID (e.g., kubecon-na-2024)"),
    title: str = typer.Argument(..., help="Talk title"),
    speakers: str = typer.Argument(..., help="Speaker names (comma-separated)"),
    video: str | None = typer.Option(None, "--video", "-v", help="Video URL"),
    labels: str | None = typer.Option(None, "--labels", "-l", help="Comma-separated labels"),
    keps: str | None = typer.Option(None, "--keps", "-k", help="Comma-separated KEP IDs"),
    session_type: str = typer.Option("session", "--type", "-t", help="Session type"),
):
    """Add a conference talk to content_links."""
    from ..transform.content.conference_ingest import add_conference_talk

    speaker_list = [s.strip() for s in speakers.split(",")]
    label_list = [l.strip() for l in labels.split(",")] if labels else None
    kep_list = [k.strip() for k in keps.split(",")] if keps else None

    add_conference_talk(
        conference=conference,
        title=title,
        speakers=speaker_list,
        video_url=video,
        labels=label_list,
        kep_links=kep_list,
        session_type=session_type,
    )

    console.print(f"[green]✓ Added talk: {title}[/green]")


@app.command("import-talks")
def import_talks_cmd(
    json_file: str = typer.Argument(..., help="Path to JSON file with talks"),
):
    """Import conference talks from a JSON file."""
    import json
    from pathlib import Path

    from ..transform.content.conference_ingest import add_conference_talk

    path = Path(json_file)
    if not path.exists():
        console.print(f"[red]File not found: {json_file}[/red]")
        raise typer.Exit(1)

    data = json.loads(path.read_text())
    talks = data.get("talks", [])

    for talk in talks:
        add_conference_talk(
            conference=talk["conference"],
            title=talk["title"],
            speakers=talk.get("speakers", []),
            video_url=talk.get("video_url"),
            labels=talk.get("labels"),
            kep_links=talk.get("kep_links"),
            session_type=talk.get("session_type", "session"),
        )

    console.print(f"[green]✓ Imported {len(talks)} talks[/green]")


@app.command("link-keps")
def link_keps_cmd(
    conference: str = typer.Argument(..., help="Conference ID (e.g., kubecon-na-2024)"),
    max_sessions: int | None = typer.Option(None, "--max", "-n", help="Limit sessions"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Preview without saving"),
):
    """Link conference content to KEPs using LLM."""
    try:
        from ..transform.content.sched_fetcher import link_conference_to_keps

        result = link_conference_to_keps(conference, max_items=max_sessions, dry_run=dry_run)

        if result:
            console.print(f"\n[green]✓[/green] Linked {result} sessions to KEPs")
        else:
            console.print("[yellow]No links created[/yellow]")

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)


@app.command()
def validate(
    conference: str | None = typer.Argument(None, help="Conference ID (optional)"),
    fix: bool = typer.Option(False, "--fix", "-f", help="Remove invalid links"),
):
    """Validate KEP links in content files."""
    try:
        from ..transform.content.content_links import validate_kep_links

        result = validate_kep_links(conference=conference, fix=fix)

        valid = result.get("valid", 0)
        invalid = result.get("invalid", 0)

        console.print(f"\n[bold]Validation Results:[/bold]")
        console.print(f"  Valid links: {valid}")
        console.print(f"  Invalid links: {invalid}")

        if fix and invalid > 0:
            console.print(f"\n[green]✓ Removed {invalid} invalid links[/green]")

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)
