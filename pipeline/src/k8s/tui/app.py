"""Main TUI application for the K8s API Pipeline."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import ClassVar

import yaml
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Container, Horizontal, Vertical
from textual.widgets import (
    Button,
    Footer,
    Header,
    Input,
    Label,
    Markdown,
    OptionList,
    RichLog,
    Rule,
    Static,
    Tree,
)
from textual.widgets.option_list import Option

from ..core.config import K8S_VERSIONS, OUTPUT_DIR, PARQUET_DIR, PIPELINE_DATA_DIR, PIPELINE_ROOT


def get_llm_config() -> tuple[str, str]:
    """Read LLM config and return (provider, model_id)."""
    config_path = PIPELINE_ROOT / "llm_config.yaml"
    try:
        with open(config_path) as f:
            config = yaml.safe_load(f)
        provider = config.get("provider", "unknown")
        model_id = config.get(provider, {}).get("model_id", "unknown")
        return provider, model_id
    except Exception:
        return "error", "could not read config"


@dataclass
class Command:
    """A pipeline command with its metadata."""
    name: str
    description: str
    help_text: str = ""
    category: str = "general"
    accepts_version: bool = False
    accepts_all: bool = False
    extra_args: list[tuple[str, str, str]] = None

    def __post_init__(self):
        if self.extra_args is None:
            self.extra_args = []


# All pipeline commands with help text
# Commands use nested structure: "group command" (e.g., "release process")
# Categories match CLI groups: release, kep, openapi, component, content, repo, export, util
COMMANDS: dict[str, Command] = {
    "release process": Command(
        name="release process",
        description="Run complete pipeline for a single release",
        help_text="""**All-in-one command** that runs every step:

0. Sync upstream repos (kubernetes, enhancements, website)
1. Stage upstream data
2. Build release JSON with PR data
3. Enrich features (LLM)
4. Enrich changes (LLM)
5. Enrich release notes (LLM)
6. Fetch OpenAPI specs
7. Generate diffs
8. Link fields to KEPs
9. Extract component flags
10. Extract kubectl commands
11. Extract feature gates
12. Export to Parquet

Use `--no-enrich` to skip LLM steps (faster, no API costs).
Use `--skip-sync` to skip pulling repos (if already up to date).""",
        category="release",
        accepts_version=True,
        extra_args=[
            ("--no-enrich", "Skip LLM enrichment", ""),
            ("--skip-sync", "Skip syncing upstream repos", ""),
            ("--skip-stage", "Use existing staged data", ""),
            ("--skip-fetch", "Skip OpenAPI fetch", ""),
            ("--force", "Force rebuild", ""),
        ],
    ),
    "release stage": Command(
        name="release stage",
        description="Stage upstream release data for processing",
        help_text="""Download release data from upstream sources.

**Downloads:**
- `release-notes.json` from cdn.dl.k8s.io
- `CHANGELOG-X.YY.md` from kubernetes repo

Use `--all` to stage all configured versions.""",
        category="release",
        accepts_version=True,
        accepts_all=True,
        extra_args=[("--force", "Re-fetch even if already staged", "")],
    ),
    "release status": Command(
        name="release status",
        description="Show status of staged upstream data",
        help_text="""Display which versions have been staged.

Shows a table with release notes and CHANGELOG status for each version.""",
        category="release",
    ),
    "release build": Command(
        name="release build",
        description="Build release JSON from staged upstream data",
        help_text="""Combine staged data into release JSON files.

**Merges:**
- release-notes.json → changesByKind
- CHANGELOG.md → actionRequired, securityInfo
- KEPs from enhancements repo → features

Use `--with-prs` to fetch GitHub PR details (required for enrich-changes).""",
        category="release",
        accepts_version=True,
        accepts_all=True,
        extra_args=[
            ("--force", "Rebuild even if exists", ""),
            ("--with-prs", "Fetch GitHub PR details", ""),
        ],
    ),
    "openapi fetch": Command(
        name="openapi fetch",
        description="Fetch OpenAPI specs and generate API tree JSON",
        help_text="""Download and parse Kubernetes OpenAPI specifications.

**Generates:**
- `api-trees/{version}.json` - API group/kind hierarchy
- `schemas/{version}.json` - Full field schemas
- `versions.json` - Version list""",
        category="openapi",
        accepts_version=True,
        accepts_all=True,
        extra_args=[("--no-cache", "Ignore cached specs", "")],
    ),
    "openapi diff": Command(
        name="openapi diff",
        description="Compute diffs between K8s versions",
        help_text="""Generate diff files showing changes between versions.

**Outputs** `diffs/{from}-{to}.json` with:
- kind_added / kind_removed
- field_added / field_removed

Also generates field-history.json and kind-history.json.""",
        category="openapi",
        accepts_all=True,
    ),
    "kep link": Command(
        name="kep link",
        description="Link new fields to their associated KEPs",
        help_text="""Match new API fields to their originating KEPs.

**Uses heuristics:**
- Feature gate matching
- Affected fields from KEP
- Kind + text similarity

Outputs `field-kep-links/{version}.json` with confidence scores.""",
        category="kep",
        accepts_version=True,
        accepts_all=True,
    ),
    "component flags": Command(
        name="component flags",
        description="Extract CLI flags for K8s components",
        help_text="""Extract CLI flags from kubernetes/website docs.

**Components:**
- kube-apiserver
- kube-controller-manager
- kube-scheduler
- kubelet
- kube-proxy

Outputs to `curated/components/components.json`.""",
        category="component",
        accepts_version=True,
    ),
    "component kubectl": Command(
        name="component kubectl",
        description="Extract kubectl commands from docs",
        help_text="""Extract kubectl commands from kubernetes/website.

**Extracts:**
- Command names and descriptions
- Options and flags
- Examples

Outputs to `curated/kubectl/kubectl_commands_{version}.json`.""",
        category="component",
        accepts_version=True,
        accepts_all=True,
    ),
    "component gates": Command(
        name="component gates",
        description="Extract feature gates from docs",
        help_text="""Extract feature gates from kubernetes/website.

**Extracts:**
- Gate names and descriptions
- Stage (alpha/beta/stable/deprecated)
- Affected components
- Related KEPs

Outputs to `curated/feature-gates/feature_gates_{version}.json`.""",
        category="component",
        accepts_version=True,
        accepts_all=True,
    ),

    "kep enrich": Command(
        name="kep enrich",
        description="Enrich KEP features with LLM descriptions",
        help_text="""Use LLM to enrich KEP features.

**Reads** KEP README.md files and generates:
- description - What the feature does
- impact - How it affects users
- affectedKinds - Which K8s resources
- affectedFields - Which API fields

Configure provider in `llm_config.yaml`.""",
        category="kep",
        accepts_version=True,
        extra_args=[
            ("--provider", "ollama, bedrock, or anthropic", ""),
            ("--max", "Max features to process", ""),
        ],
    ),
    "release enrich-changes": Command(
        name="release enrich-changes",
        description="Enrich changelog entries with LLM context",
        help_text="""Transform dry release notes into rich descriptions.

**For each change, generates:**
- problem - What was the issue
- affected - Who was impacted
- fix - What the change does
- impact - Why it matters
- severity - low/medium/high/critical

⚠️ Requires `release build --with-prs` first.""",
        category="release",
        accepts_version=True,
        extra_args=[
            ("--kind", "bugOrRegression, feature, etc.", ""),
            ("--max", "Max changes to process", ""),
        ],
    ),
    "release enrich-notes": Command(
        name="release enrich-notes",
        description="Enrich release notes (urgent, deprecations)",
        help_text="""Enrich release notes with structured LLM content.

**Categories:**
- `urgent` - Urgent upgrade notes → title, action, severity
- `deprecations` - → impact, migration steps
- `api-changes` - → flag breaking changes

Use `-c` to specify category.""",
        category="release",
        accepts_version=True,
        extra_args=[("--category", "urgent, deprecations, api-changes", "")],
    ),
    "kep extract-metadata": Command(
        name="kep extract-metadata",
        description="Extract metadata from all KEPs (one-off)",
        help_text="""Use LLM to extract metadata from ALL KEPs.

**Creates** `kep_metadata.json` with:
- summary - 2-3 sentence description
- labels - Topic labels
- affectedKinds - K8s resources
- affectedFields - API fields
- keyConcepts - Technical concepts

This is a one-off process. Use `--force` to re-process.""",
        category="kep",
        extra_args=[
            ("--max", "Limit KEPs to process", ""),
            ("--force", "Re-process all KEPs", ""),
        ],
    ),
    "kep normalize-labels": Command(
        name="kep normalize-labels",
        description="Normalize KEP labels for consistency",
        help_text="""Consolidate and normalize labels across KEPs.

**Pass 2** of KEP metadata extraction.
Uses LLM to merge similar labels.

Use `--stats` to see label statistics.""",
        category="kep",
        extra_args=[
            ("--dry-run", "Preview without saving", ""),
            ("--stats", "Show label statistics", ""),
        ],
    ),
    "export parquet": Command(
        name="export parquet",
        description="Export all data to Parquet for DuckDB WASM",
        help_text="""Convert JSON files to Parquet for the web UI.

⚠️ **CRITICAL:** The UI reads ONLY from Parquet files.
Always run this after updating any JSON data.

**Outputs** to `packages/web/public/data/parquet/`""",
        category="export",
    ),
    "export benchmark": Command(
        name="export benchmark",
        description="Benchmark different columnar file formats",
        help_text="""Compare disk size and export time for formats.

**Formats tested:**
- Parquet (PyArrow) - default, best compression
- Parquet (DuckDB) - alternative writer
- DuckDB Native - single database file
- Lance - ML-optimized (optional)
- Vortex - state-of-the-art (optional)

⚠️ Lance and Vortex are NOT supported in DuckDB WASM.""",
        category="export",
        extra_args=[
            ("--lance", "Include Lance format", ""),
            ("--vortex", "Include Vortex format", ""),
            ("--per-table", "Show per-table breakdown", ""),
        ],
    ),
    "export docs": Command(
        name="export docs",
        description="Generate schema documentation from PyArrow schemas",
        help_text="""Generate markdown documentation from schema definitions.

**Reads** `schemas.py` and generates:
- ER diagram (ASCII)
- Table definitions with columns
- PK/FK relationships
- Column descriptions

**Output:** `docs/data-model.md`

The schemas in `schemas.py` are the single source of truth for:
1. Parquet file generation (type enforcement)
2. Documentation (this command)
3. TypeScript types (`export types`)
4. UI relationships (`schema_metadata.json`)""",
        category="export",
        extra_args=[
            ("--output", "Output file path", ""),
        ],
    ),
    "export types": Command(
        name="export types",
        description="Generate TypeScript types from PyArrow schemas",
        help_text="""Generate TypeScript interfaces from schema definitions.

**Reads** `schemas.py` and generates:
- TypeScript interfaces for each table (e.g., `ReleasesRow`)
- JSDoc comments with descriptions
- `TableName` union type
- `TableRowMap` interface

**Output:** `packages/web/src/shared/types/db-types.ts`

Field names use snake_case to match DuckDB column names exactly.""",
        category="export",
        extra_args=[
            ("--output", "Output file path", ""),
        ],
    ),
    "export all": Command(
        name="export all",
        description="Run all export steps (parquet + docs + types)",
        help_text="""Convenience command that runs all export steps:

1. `export parquet` - Generate Parquet files for DuckDB WASM
2. `export docs` - Generate schema documentation
3. `export types` - Generate TypeScript types

Use this after modifying schemas to keep everything in sync.""",
        category="export",
    ),
    "repo sync": Command(
        name="repo sync",
        description="Clone or update upstream repositories",
        help_text="""Manage local clones of upstream repos.

**Repos:**
- `kubernetes` - Main repo (OpenAPI specs)
- `enhancements` - KEP repository

Use `--pull` to update existing clones.""",
        category="repo",
        extra_args=[("--pull", "Pull updates", "")],
    ),
    "repo list": Command(
        name="repo list",
        description="List repositories and their status",
        help_text="""Show status of upstream repository clones.""",
        category="repo",
    ),
    "content list": Command(
        name="content list",
        description="List curated content links",
        help_text="""Show external content (blogs, docs, videos) in content_links.json.""",
        category="content",
    ),
    "content fetch-sched": Command(
        name="content fetch-sched",
        description="Import conference sessions from Sched.com",
        help_text="""Fetch KubeCon sessions from Sched.com iCal export.

**Extracts:**
- Session titles and descriptions
- Speaker names
- Video URLs, slides PDFs
- Experience level

**LLM enriches:**
- Topic labels
- Session type
- KEP references

Use `--list` to see available conferences.""",
        category="content",
        extra_args=[
            ("CONFERENCE", "Conference ID (e.g., kubecon-na-2024)", ""),
            ("--list", "List available conferences", ""),
            ("--dry-run", "Preview without saving", ""),
            ("--max", "Limit sessions to process", ""),
            ("--no-enrich", "Skip LLM enrichment", ""),
        ],
    ),
    "content fetch-youtube": Command(
        name="content fetch-youtube",
        description="Import videos from CNCF YouTube playlists",
        help_text="""Fetch conference videos from YouTube.

⚠️ Requires `YOUTUBE_API_KEY` environment variable.

Use `--list` to see available playlists.""",
        category="content",
        extra_args=[
            ("CONFERENCE", "Conference ID", ""),
            ("--list", "List available playlists", ""),
        ],
    ),
    "content list-conferences": Command(
        name="content list-conferences",
        description="List imported conference content",
        help_text="""Show KubeCon talks and sessions.

Filter by conference or topic.""",
        category="content",
        extra_args=[
            ("--conference", "Filter by conference", ""),
            ("--topic", "Filter by topic label", ""),
        ],
    ),
    "release versions": Command(
        name="release versions",
        description="List configured Kubernetes versions",
        help_text=f"""Show versions the pipeline processes.

**Current:** {', '.join(K8S_VERSIONS)}""",
        category="release",
    ),
    "release fetch-prs": Command(
        name="release fetch-prs",
        description="Fetch PR details from GitHub",
        help_text="""Fetch PR details from GitHub with caching.

Set GITHUB_TOKEN env var for higher rate limits (5000/hr vs 60/hr).

Use `--from-release` to extract PR numbers from a release JSON.""",
        category="release",
        extra_args=[
            ("PR_NUMBERS", "PR numbers to fetch", ""),
            ("--from-release", "Extract from release JSON", ""),
            ("--rate-limit", "Show GitHub API rate limit", ""),
            ("--clear-cache", "Clear PR cache", ""),
        ],
    ),
    "release providers": Command(
        name="release providers",
        description="Fetch K8s version support from cloud providers",
        help_text="""Fetch K8s version support data from cloud providers.

**Providers:** eks, gke, aks, openshift

Outputs provider version support data.""",
        category="release",
        extra_args=[
            ("PROVIDER", "Specific provider (optional)", ""),
            ("--force", "Force refresh", ""),
        ],
    ),
    "openapi info": Command(
        name="openapi info",
        description="Show info about a fetched version",
        help_text="""Display API groups and kinds for a version.""",
        category="openapi",
        accepts_version=True,
    ),
    "util clear-cache": Command(
        name="util clear-cache",
        description="Clear the OpenAPI spec cache",
        help_text="""Remove cached OpenAPI specs from `.cache/`""",
        category="util",
    ),
    "kep suggest-labels": Command(
        name="kep suggest-labels",
        description="Suggest labels for a KEP using embeddings/LLM",
        help_text="""Use embeddings and/or LLM to suggest topic labels.

**Methods:**
- embedding - Fast, uses pre-computed embeddings
- llm - Uses LLM for semantic understanding
- hybrid - Combines both (default)""",
        category="kep",
        extra_args=[
            ("KEP", "KEP identifier or title text", ""),
            ("--method", "embedding, llm, or hybrid", ""),
            ("--top", "Number of labels to suggest", ""),
        ],
    ),
    "kep label-features": Command(
        name="kep label-features",
        description="Add labels to all features in a release",
        help_text="""Label all features in a release using embeddings/LLM.

Use `--force` to re-label existing features.""",
        category="kep",
        accepts_version=True,
        extra_args=[
            ("--method", "embedding, llm, or hybrid", ""),
            ("--force", "Re-label existing", ""),
        ],
    ),
    "kep list-labels": Command(
        name="kep list-labels",
        description="List all labels in the curated taxonomy",
        help_text="""Show the label taxonomy with categories and terms.""",
        category="kep",
    ),
    "kep build-taxonomy": Command(
        name="kep build-taxonomy",
        description="Build label taxonomy from KEP metadata",
        help_text="""Generate a hierarchical taxonomy of labels.

Uses KEP metadata to build category structure.

**Methods:**
- clustering - Group similar labels
- llm - Use LLM for categorization
- hybrid - Combine both""",
        category="kep",
        extra_args=[
            ("--method", "clustering, llm, or hybrid", ""),
            ("--min-count", "Minimum label occurrences", ""),
        ],
    ),
    "kep compare-models": Command(
        name="kep compare-models",
        description="Compare LLM enrichment across different models",
        help_text="""Compare LLM enrichment output across different models.

Useful for evaluating model quality for KEP enrichment.

Example:
    kep compare-models 1.35 qwen3:8b qwen3:32b --max 3""",
        category="kep",
        accepts_version=True,
        extra_args=[
            ("MODELS", "Model IDs to compare", ""),
            ("--max", "Number of features to test", ""),
            ("--provider", "Model provider", ""),
        ],
    ),
    "content validate": Command(
        name="content validate",
        description="Validate KEP links in content",
        help_text="""Check that KEP references in content_links are valid.

Validates against kep_metadata.json.""",
        category="content",
    ),
}

CATEGORIES = {
    "release": ("📦", "Release"),
    "kep": ("💡", "KEP"),
    "openapi": ("📋", "OpenAPI"),
    "component": ("⚙️", "Component"),
    "content": ("📚", "Content"),
    "repo": ("🔗", "Repo"),
    "export": ("📤", "Export"),
    "util": ("🔧", "Util"),
}


class LLMConfigPanel(Static):
    """Shows the active LLM provider and model."""

    def compose(self) -> ComposeResult:
        yield Static("[bold]🤖 LLM Config[/bold]", id="llm-title")
        yield Static("", id="llm-info")

    def on_mount(self) -> None:
        self.refresh_config()

    def refresh_config(self) -> None:
        provider, model_id = get_llm_config()
        info = f"[cyan]{provider}[/cyan]\n[dim]{model_id}[/dim]"
        self.query_one("#llm-info", Static).update(info)


class DataFileTree(Tree):
    """Tree widget for browsing data files."""

    def __init__(self, **kwargs):
        super().__init__("📁 Data Files", **kwargs)

    def on_mount(self) -> None:
        self.root.expand()
        self._build_tree()

    def _build_tree(self) -> None:
        self.root.remove_children()

        # Upstream staged data
        upstream = self.root.add("📥 Staged", expand=True)
        staged_dir = PIPELINE_DATA_DIR / "upstream" / "k8s" / "releases"

        notes_dir = staged_dir / "release-notes"
        if notes_dir.exists():
            notes = upstream.add("release-notes/")
            for f in sorted(notes_dir.glob("*.json"))[:5]:
                notes.add_leaf(f.name)
            if len(list(notes_dir.glob("*.json"))) > 5:
                notes.add_leaf("...")

        changelog_dir = staged_dir / "changelogs"
        if changelog_dir.exists():
            changelogs = upstream.add("changelogs/")
            for f in sorted(changelog_dir.glob("*.md"))[:5]:
                changelogs.add_leaf(f.name)

        # Curated data
        curated = self.root.add("✏️ Curated", expand=True)
        curated_dir = PIPELINE_DATA_DIR / "curated"
        if curated_dir.exists():
            for f in sorted(curated_dir.glob("*.json"))[:5]:
                curated.add_leaf(f.name)

        # Built JSON files
        built = self.root.add("🔨 Built JSON", expand=True)

        releases_dir = OUTPUT_DIR / "releases"
        if releases_dir.exists():
            releases = built.add("releases/")
            for f in sorted(releases_dir.glob("*.json"), reverse=True)[:5]:
                releases.add_leaf(f.name)

        api_trees_dir = OUTPUT_DIR / "api-trees"
        if api_trees_dir.exists():
            trees = built.add("api-trees/")
            for f in sorted(api_trees_dir.glob("*.json"), reverse=True)[:5]:
                trees.add_leaf(f.name)

        # Parquet files
        parquet = self.root.add("🗃️ Parquet", expand=True)
        parquet_dir = PARQUET_DIR
        if parquet_dir.exists():
            for f in sorted(parquet_dir.glob("*.parquet"))[:8]:
                parquet.add_leaf(f.name)
            remaining = len(list(parquet_dir.glob("*.parquet"))) - 8
            if remaining > 0:
                parquet.add_leaf(f"... +{remaining} more")

    def refresh_tree(self) -> None:
        self._build_tree()


class CommandList(OptionList):
    """List of available commands grouped by category."""

    def on_mount(self) -> None:
        self._populate()

    def _populate(self) -> None:
        self.clear_options()

        for cat_id, (icon, name) in CATEGORIES.items():
            self.add_option(Option(f"─ {icon} {name} ─", id=f"cat:{cat_id}", disabled=True))
            for cmd_name, cmd in COMMANDS.items():
                if cmd.category == cat_id:
                    self.add_option(Option(f"  {cmd_name}", id=cmd_name))


class CommandDetail(Static):
    """Shows details and help for selected command."""

    def compose(self) -> ComposeResult:
        yield Static("[dim]Select a command from the list[/dim]", id="cmd-title")
        yield Rule()
        yield Markdown("", id="cmd-help")
        yield Rule()
        yield Static("", id="cmd-args")

    def show_command(self, cmd: Command) -> None:
        title = f"[bold cyan]{cmd.name}[/bold cyan]\n[dim]{cmd.description}[/dim]"
        self.query_one("#cmd-title", Static).update(title)
        self.query_one("#cmd-help", Markdown).update(cmd.help_text)

        args_lines = []
        if cmd.accepts_version:
            args_lines.append("[green]VERSION[/green] - K8s version (e.g., 1.35)")
        if cmd.accepts_all:
            args_lines.append("[yellow]--all[/yellow] - Process all versions")
        for flag, desc, _ in cmd.extra_args:
            args_lines.append(f"[yellow]{flag}[/yellow] - {desc}")

        args_text = "[bold]Arguments:[/bold]\n" + "\n".join(args_lines) if args_lines else ""
        self.query_one("#cmd-args", Static).update(args_text)


class CommandRunner(Static):
    """Widget for building and running commands."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.current_cmd: Command | None = None

    def compose(self) -> ComposeResult:
        yield Static("[bold]▶ Run Command[/bold]")
        yield Rule()
        with Horizontal(classes="input-row"):
            yield Label("Version: ")
            yield OptionList(*[Option(v, id=v) for v in K8S_VERSIONS], id="version-select")
        with Horizontal(classes="input-row"):
            yield Label("Args:    ")
            yield Input(placeholder="--force --max 5", id="extra-args")
        yield Static("", id="cmd-preview")
        with Horizontal(classes="button-row"):
            yield Button("▶ Run", id="run-cmd", variant="success")
            yield Button("▶ Run --all", id="run-all", variant="primary")

    def set_command(self, cmd: Command) -> None:
        self.current_cmd = cmd
        self._update_preview()
        self.query_one("#run-all", Button).display = cmd.accepts_all

    def _update_preview(self) -> None:
        if not self.current_cmd:
            return
        version_list = self.query_one("#version-select", OptionList)
        extra = self.query_one("#extra-args", Input).value.strip()

        version = ""
        if version_list.highlighted is not None:
            version = str(version_list.get_option_at_index(version_list.highlighted).id)

        cmd = f"k8s-pipeline {self.current_cmd.name}"
        if self.current_cmd.accepts_version and version:
            cmd += f" {version}"
        if extra:
            cmd += f" {extra}"
        self.query_one("#cmd-preview", Static).update(f"[dim]$ {cmd}[/dim]")

    def get_command_string(self, use_all: bool = False) -> str:
        if not self.current_cmd:
            return ""
        version_list = self.query_one("#version-select", OptionList)
        extra = self.query_one("#extra-args", Input).value.strip()

        cmd = self.current_cmd.name
        if use_all and self.current_cmd.accepts_all:
            cmd += " --all"
        elif self.current_cmd.accepts_version and version_list.highlighted is not None:
            version = str(version_list.get_option_at_index(version_list.highlighted).id)
            cmd += f" {version}"
        if extra:
            cmd += f" {extra}"
        return cmd

    def on_option_list_option_highlighted(self, event: OptionList.OptionHighlighted) -> None:
        if event.option_list.id == "version-select":
            self._update_preview()

    def on_input_changed(self, event: Input.Changed) -> None:
        self._update_preview()


class PipelineTUI(App):
    """TUI for managing the K8s API Pipeline."""

    CSS = """
    Screen {
        layout: horizontal;
    }

    #left-panel {
        width: 28;
        height: 100%;
        background: $panel;
        border-right: tall $primary;
    }

    #left-panel Static {
        padding: 1;
    }

    #cmd-list {
        height: 1fr;
    }

    #llm-panel {
        height: auto;
        padding: 1;
        border-top: tall $primary-darken-2;
    }

    #llm-title {
        padding: 0;
    }

    #llm-info {
        padding: 0;
        margin-top: 1;
    }

    #middle-panel {
        width: 1fr;
        height: 100%;
    }

    #cmd-detail {
        height: 1fr;
        padding: 1;
        border-bottom: tall $primary-darken-2;
    }

    #cmd-runner {
        height: auto;
        min-height: 12;
        padding: 1;
    }

    #right-panel {
        width: 36;
        height: 100%;
        border-left: tall $primary-darken-2;
    }

    #file-tree {
        height: 1fr;
        padding: 1;
        border-bottom: tall $primary-darken-2;
    }

    #output-panel {
        height: 1fr;
        padding: 1;
    }

    #log {
        height: 1fr;
        background: $surface;
    }

    .input-row {
        height: 3;
        margin: 1 0;
    }

    .input-row Label {
        width: 10;
    }

    #version-select {
        width: 16;
        height: 3;
    }

    #extra-args {
        width: 1fr;
    }

    .button-row {
        height: 3;
        margin-top: 1;
    }

    .button-row Button {
        margin-right: 1;
    }

    #cmd-preview {
        margin: 1 0;
        color: $text-muted;
    }

    Rule {
        margin: 1 0;
        color: $primary-darken-3;
    }

    CommandDetail Rule {
        margin: 1 0;
    }

    #cmd-help {
        max-height: 20;
    }
    """

    BINDINGS: ClassVar[list[Binding]] = [
        Binding("q", "quit", "Quit"),
        Binding("r", "refresh", "Refresh"),
        Binding("c", "clear_log", "Clear"),
        Binding("escape", "cancel", "Cancel"),
        Binding("f1", "show_help", "Help"),
    ]

    TITLE = "K8s API Pipeline"
    SUB_TITLE = "Interactive pipeline management"

    def __init__(self):
        super().__init__()
        self.running_process: asyncio.subprocess.Process | None = None

    def compose(self) -> ComposeResult:
        yield Header()

        with Horizontal():
            # Left: Command list + LLM config
            with Vertical(id="left-panel"):
                yield Static("[bold]📋 Commands[/bold]")
                yield CommandList(id="cmd-list")
                with Container(id="llm-panel"):
                    yield LLMConfigPanel()

            # Middle: Detail + Runner
            with Vertical(id="middle-panel"):
                yield CommandDetail(id="cmd-detail")
                yield CommandRunner(id="cmd-runner")

            # Right: Files + Output
            with Vertical(id="right-panel"):
                with Container(id="file-tree"):
                    yield DataFileTree(id="tree")
                with Container(id="output-panel"):
                    yield Static("[bold]📜 Output[/bold]")
                    yield RichLog(id="log", highlight=True, markup=True)

        yield Footer()


    def on_mount(self) -> None:
        self.log_message("[bold cyan]K8s API Pipeline TUI[/bold cyan]")
        self.log_message("")
        self.log_message("Select a command to see help.")
        self.log_message("Press [bold]F1[/bold] for shortcuts.")

    def log_message(self, msg: str) -> None:
        self.query_one("#log", RichLog).write(msg)

    def on_option_list_option_selected(self, event: OptionList.OptionSelected) -> None:
        if event.option_list.id == "cmd-list":
            cmd_name = str(event.option.id)
            if cmd_name.startswith("cat:"):
                return
            if cmd_name in COMMANDS:
                cmd = COMMANDS[cmd_name]
                self.query_one("#cmd-detail", CommandDetail).show_command(cmd)
                self.query_one("#cmd-runner", CommandRunner).set_command(cmd)

    async def on_button_pressed(self, event: Button.Pressed) -> None:
        runner = self.query_one("#cmd-runner", CommandRunner)
        if event.button.id == "run-cmd":
            cmd = runner.get_command_string(use_all=False)
            if cmd:
                await self.run_command(cmd)
        elif event.button.id == "run-all":
            cmd = runner.get_command_string(use_all=True)
            if cmd:
                await self.run_command(cmd)

    async def run_command(self, cmd: str) -> None:
        self.log_message("")
        self.log_message(f"[yellow]$ uv run k8s-pipeline {cmd}[/yellow]")
        self.log_message("")

        try:
            self.running_process = await asyncio.create_subprocess_shell(
                f"uv run k8s-pipeline {cmd}",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=str(PIPELINE_ROOT),
            )

            while True:
                line = await self.running_process.stdout.readline()
                if not line:
                    break
                decoded = line.decode().rstrip()
                if decoded:
                    self.log_message(decoded)

            await self.running_process.wait()

            if self.running_process.returncode == 0:
                self.log_message("[green]✓ Done[/green]")
            else:
                self.log_message(f"[red]✗ Failed ({self.running_process.returncode})[/red]")

            self.running_process = None
            self.query_one("#tree", DataFileTree).refresh_tree()

        except asyncio.CancelledError:
            if self.running_process:
                self.running_process.terminate()
                self.log_message("[yellow]Cancelled[/yellow]")
            raise
        except Exception as e:
            self.log_message(f"[red]Error: {e}[/red]")

    def action_refresh(self) -> None:
        self.query_one("#tree", DataFileTree).refresh_tree()
        self.log_message("[cyan]↻ Refreshed[/cyan]")

    def action_clear_log(self) -> None:
        self.query_one("#log", RichLog).clear()

    def action_cancel(self) -> None:
        if self.running_process:
            self.running_process.terminate()

    def action_show_help(self) -> None:
        self.log_message("")
        self.log_message("[bold]Shortcuts:[/bold]")
        self.log_message("  q - Quit")
        self.log_message("  r - Refresh files")
        self.log_message("  c - Clear log")
        self.log_message("  Esc - Cancel command")


def main():
    app = PipelineTUI()
    app.run()


if __name__ == "__main__":
    main()
