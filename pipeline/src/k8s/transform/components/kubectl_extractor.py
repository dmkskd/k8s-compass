"""
Extract kubectl command documentation from the kubernetes/website repo.

This module parses the generated kubectl reference docs to extract:
- Command names and hierarchy (e.g., kubectl apply, kubectl apply edit-last-applied)
- Synopsis/description
- Usage examples
- Command-specific options (flags)
- Subcommands

Data source:
- kubernetes/website repo
- content/en/docs/reference/kubectl/generated/kubectl_*/

The website repo uses tags like `snapshot-final-v1.32` for each K8s release.
"""

import json
import re
from pathlib import Path
from typing import Any

from rich.console import Console

from ...input.repo_manager import get_repo_path
from .component_extractor import checkout_website_version

console = Console()

# Path to kubectl generated docs in website repo
KUBECTL_DOCS_PATH = "content/en/docs/reference/kubectl/generated"


def parse_synopsis(content: str) -> str | None:
    """Extract the synopsis section from markdown content."""
    # Look for {{% heading "synopsis" %}} section - more flexible pattern
    match = re.search(
        r'heading\s+"synopsis"\s*%\}\}\s*\n+(.+?)(?:\n```|\n\n##)',
        content,
        re.DOTALL,
    )
    if match:
        synopsis = match.group(1).strip()
        # Clean up any remaining markdown
        synopsis = re.sub(r'\s+', ' ', synopsis)
        return synopsis
    return None


def parse_usage(content: str) -> str | None:
    """Extract the usage pattern from the synopsis section."""
    # Look for code block after synopsis - more flexible pattern
    match = re.search(
        r'heading\s+"synopsis"\s*%\}\}.*?```\n(.+?)\n```',
        content,
        re.DOTALL,
    )
    if match:
        return match.group(1).strip()
    return None


def parse_examples(content: str) -> list[dict[str, str]]:
    """Extract examples from the examples section."""
    examples = []

    # Find the examples section - more flexible pattern
    match = re.search(
        r'heading\s+"examples"\s*%\}\}\s*\n+```\n(.+?)\n```',
        content,
        re.DOTALL,
    )
    if not match:
        return examples

    examples_text = match.group(1)

    # Parse individual examples
    # Format can be:
    # 1. Comment on one line, command on next
    # 2. Comment and command on same line (separated by spaces)
    lines = examples_text.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i].strip()

        if line.startswith("#"):
            # This is a comment - check if command is on same line or next
            comment_part = line.lstrip("# ").strip()

            # Check if there's a command after the comment on the same line
            # Pattern: # comment text    kubectl command
            cmd_match = re.search(r'(kubectl\s+.+)$', line)
            if cmd_match:
                # Command is on same line after comment
                command = cmd_match.group(1).strip()
                # Extract just the comment part (before kubectl)
                comment_idx = line.find("kubectl")
                comment_part = line[1:comment_idx].strip()  # Skip the #
                examples.append({
                    "description": comment_part,
                    "command": command,
                })
            else:
                # Command might be on next line
                if i + 1 < len(lines):
                    next_line = lines[i + 1].strip()
                    if next_line.startswith("kubectl") or next_line.startswith("cat "):
                        examples.append({
                            "description": comment_part,
                            "command": next_line,
                        })
                        i += 1  # Skip the command line
        elif line.startswith("kubectl"):
            # Standalone command without comment
            examples.append({
                "description": "",
                "command": line,
            })

        i += 1

    return examples


def parse_options_table(content: str, section_name: str = "options") -> list[dict[str, Any]]:
    """
    Parse options from an HTML table in the markdown.

    The format is:
    <tr>
    <td colspan="2">--flag-name type     Default: value</td>
    </tr>
    <tr>
    <td></td><td>Description text</td>
    </tr>
    """
    options = []

    # Find the section - more flexible pattern
    section_pattern = rf'heading\s+"{section_name}"\s*%\}}\}}.*?<table[^>]*>(.+?)</table>'
    match = re.search(section_pattern, content, re.DOTALL | re.IGNORECASE)
    if not match:
        return options

    table_content = match.group(1)

    # Parse table rows - each option spans two <tr> elements
    # First row: flag name, type, default
    # Second row: description (wrapped in <p> tags)
    row_pattern = r'<tr>\s*<td colspan="2">([^<]+)</td>\s*</tr>\s*<tr>\s*<td></td><td[^>]*>(?:<p>)?(.+?)(?:</p>)?</td>\s*</tr>'

    for row_match in re.finditer(row_pattern, table_content, re.DOTALL):
        flag_line = row_match.group(1).strip()
        desc_html = row_match.group(2).strip()

        option = parse_flag_line(flag_line)
        if option:
            # Clean description HTML
            description = clean_html(desc_html)
            option["description"] = description

            options.append(option)

    return options


def parse_flag_line(flag_line: str) -> dict[str, Any] | None:
    """
    Parse a flag definition line.

    Examples:
    - "--all"
    - "-f, --filename strings"
    - "--dry-run string[=\"unchanged\"]     Default: \"none\""
    - "--grace-period int     Default: -1"
    """
    option: dict[str, Any] = {}

    # Clean up HTML entities
    flag_line = flag_line.replace("&nbsp;", " ")

    # Extract short flag if present (e.g., "-f, --filename")
    short_match = re.match(r'-([a-zA-Z]),\s*', flag_line)
    if short_match:
        option["short"] = f"-{short_match.group(1)}"
        flag_line = flag_line[short_match.end():]

    # Extract main flag name
    flag_match = re.match(r'--([a-zA-Z0-9_-]+)', flag_line)
    if not flag_match:
        return None

    option["name"] = f"--{flag_match.group(1)}"
    flag_line = flag_line[flag_match.end():].strip()

    # Extract type if present
    type_match = re.match(r'(\w+)(?:\[.*?\])?', flag_line)
    if type_match and type_match.group(1).lower() not in ["default"]:
        option["type"] = type_match.group(1)
        flag_line = flag_line[type_match.end():].strip()

    # Extract default value
    default_match = re.search(r'Default:\s*["\']?([^"\'<\n]+)["\']?', flag_line)
    if default_match:
        default_val = default_match.group(1).strip()
        if default_val:
            option["default"] = default_val

    return option


def clean_html(html: str) -> str:
    """Remove HTML tags and clean up text."""
    # Remove HTML tags
    text = re.sub(r'<[^>]+>', ' ', html)
    # Clean up entities
    text = text.replace("&nbsp;", " ")
    text = text.replace("&lt;", "<")
    text = text.replace("&gt;", ">")
    text = text.replace("&quot;", '"')
    text = text.replace("&amp;", "&")
    # Clean up whitespace
    text = " ".join(text.split())
    # Limit length
    return text[:500] if len(text) > 500 else text


def parse_subcommands(content: str) -> list[str]:
    """Extract subcommand references from the 'see also' section."""
    subcommands = []

    # Find the seealso section
    match = re.search(
        r'\{%\s*heading\s+"seealso"\s*%\}\s*\}\}\s*\n\n(.+?)(?:\n\n##|\Z)',
        content,
        re.DOTALL,
    )
    if not match:
        return subcommands

    seealso_text = match.group(1)

    # Parse links to subcommands
    # Format: * [kubectl apply edit-last-applied](kubectl_apply_edit-last-applied/)
    for line_match in re.finditer(r'\*\s*\[([^\]]+)\]\(([^)]+)\)', seealso_text):
        cmd_name = line_match.group(1)
        cmd_path = line_match.group(2)

        # Skip parent command reference
        if cmd_path == "../kubectl/" or cmd_name == "kubectl":
            continue

        # Extract just the subcommand name
        if cmd_name.startswith("kubectl "):
            subcommands.append(cmd_name)

    return subcommands


def parse_kubectl_command(file_path: Path) -> dict[str, Any] | None:
    """
    Parse a kubectl command markdown file.

    Returns a dict with:
    - name: Command name (e.g., "kubectl apply")
    - synopsis: Brief description
    - usage: Usage pattern
    - examples: List of example commands
    - options: Command-specific options
    - subcommands: List of subcommand names
    """
    if not file_path.exists():
        return None

    content = file_path.read_text(encoding="utf-8")

    # Extract command name from frontmatter
    title_match = re.search(r'^title:\s*(.+)$', content, re.MULTILINE)
    if not title_match:
        return None

    name = title_match.group(1).strip()

    command: dict[str, Any] = {
        "name": name,
        "synopsis": parse_synopsis(content),
        "usage": parse_usage(content),
        "examples": parse_examples(content),
        "options": parse_options_table(content, "options"),
        "subcommands": parse_subcommands(content),
    }

    return command


def extract_all_kubectl_commands(
    version: str | None = None,
    quiet: bool = False,
) -> dict[str, Any]:
    """
    Extract all kubectl commands from the website repo.

    Args:
        version: K8s version like "1.32" (optional, uses current checkout if not specified)
        quiet: Suppress output

    Returns:
        Dict with version and list of commands
    """
    repo_path = get_repo_path("website")
    if not repo_path.exists():
        if not quiet:
            console.print("[red]Website repo not found. Run: uv run k8s-pipeline sync-repos website[/red]")
        return {"version": version, "commands": []}

    # Checkout specific version if requested
    if version:
        if not checkout_website_version(version, quiet=quiet):
            if not quiet:
                console.print(f"[yellow]Could not checkout version {version}, using current[/yellow]")

    kubectl_path = repo_path / KUBECTL_DOCS_PATH

    if not kubectl_path.exists():
        if not quiet:
            console.print(f"[red]kubectl docs not found at {kubectl_path}[/red]")
        return {"version": version, "commands": []}

    if not quiet:
        console.print(f"\n[bold]Extracting kubectl commands{f' for {version}' if version else ''}[/bold]")

    commands = []

    # Find all kubectl command directories
    for cmd_dir in sorted(kubectl_path.iterdir()):
        if not cmd_dir.is_dir():
            continue
        if not cmd_dir.name.startswith("kubectl_"):
            continue

        # Parse the _index.md file
        index_file = cmd_dir / "_index.md"
        if not index_file.exists():
            continue

        command = parse_kubectl_command(index_file)
        if command:
            commands.append(command)

            if not quiet:
                opt_count = len(command.get("options", []))
                sub_count = len(command.get("subcommands", []))
                console.print(f"  [green]✓[/green] {command['name']} ({opt_count} options, {sub_count} subcommands)")

    # Also parse the main kubectl.md
    main_kubectl = kubectl_path / "kubectl.md"
    if main_kubectl.exists():
        main_cmd = parse_kubectl_command(main_kubectl)
        if main_cmd:
            # Insert at beginning
            commands.insert(0, main_cmd)

    result = {
        "version": version,
        "command_count": len(commands),
        "commands": commands,
    }

    if not quiet:
        console.print(f"\n[bold]Extracted {len(commands)} kubectl commands[/bold]")

    return result


def compare_kubectl_versions(
    version1: str,
    version2: str,
    quiet: bool = False,
) -> dict[str, Any]:
    """
    Compare kubectl commands between two K8s versions.

    Returns dict with added, removed, and changed commands.
    """
    if not quiet:
        console.print(f"\n[bold]Comparing kubectl {version1} → {version2}[/bold]")

    # Extract commands for both versions
    data1 = extract_all_kubectl_commands(version=version1, quiet=True)
    data2 = extract_all_kubectl_commands(version=version2, quiet=True)

    cmds1 = {c["name"]: c for c in data1.get("commands", [])}
    cmds2 = {c["name"]: c for c in data2.get("commands", [])}

    added_cmds = set(cmds2.keys()) - set(cmds1.keys())
    removed_cmds = set(cmds1.keys()) - set(cmds2.keys())

    # Check for option changes in common commands
    option_changes = {}
    for name in set(cmds1.keys()) & set(cmds2.keys()):
        opts1 = {o["name"]: o for o in cmds1[name].get("options", [])}
        opts2 = {o["name"]: o for o in cmds2[name].get("options", [])}

        added_opts = set(opts2.keys()) - set(opts1.keys())
        removed_opts = set(opts1.keys()) - set(opts2.keys())

        if added_opts or removed_opts:
            option_changes[name] = {
                "added": [opts2[n] for n in sorted(added_opts)],
                "removed": [opts1[n] for n in sorted(removed_opts)],
            }

    diff = {
        "from_version": version1,
        "to_version": version2,
        "commands_added": [cmds2[n] for n in sorted(added_cmds)],
        "commands_removed": [cmds1[n] for n in sorted(removed_cmds)],
        "option_changes": option_changes,
    }

    if not quiet:
        if added_cmds:
            console.print(f"  [green]+{len(added_cmds)} commands added[/green]")
            for name in sorted(added_cmds):
                console.print(f"    [green]+[/green] {name}")
        if removed_cmds:
            console.print(f"  [red]-{len(removed_cmds)} commands removed[/red]")
            for name in sorted(removed_cmds):
                console.print(f"    [red]-[/red] {name}")
        if option_changes:
            console.print(f"  [yellow]{len(option_changes)} commands with option changes[/yellow]")

    return diff


def save_kubectl_data(output_path: Path, data: dict[str, Any]) -> None:
    """Save extracted kubectl data to JSON."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(data, f, indent=2)
    console.print(f"[green]✓ Saved to {output_path}[/green]")


def extract_and_save_kubectl(
    version: str,
    output_path: Path | None = None,
    quiet: bool = False,
) -> dict[str, Any]:
    """
    Extract kubectl commands for a version and save to JSON.

    Args:
        version: K8s version like "1.32"
        output_path: Output file path (default: curated/kubectl/kubectl_commands_{version}.json)
        quiet: Suppress output

    Returns:
        Extracted kubectl data
    """
    from ...core.config import CURATED_KUBECTL_DIR

    if output_path is None:
        output_path = CURATED_KUBECTL_DIR / f"kubectl_commands_{version}.json"

    data = extract_all_kubectl_commands(version=version, quiet=quiet)
    save_kubectl_data(output_path, data)

    return data


def extract_all_versions(
    quiet: bool = False,
) -> dict[str, dict[str, Any]]:
    """
    Extract kubectl commands for all K8s versions.

    Args:
        quiet: Suppress output

    Returns:
        Dict mapping version -> kubectl data
    """
    from ...core.config import CURATED_KUBECTL_DIR, K8S_VERSIONS

    if not quiet:
        console.print("\n[bold]Extracting kubectl commands for all versions[/bold]")

    results = {}

    for version in K8S_VERSIONS:
        if not quiet:
            console.print(f"\n[bold cyan]═══ Version {version} ═══[/bold cyan]")

        output_path = CURATED_KUBECTL_DIR / f"kubectl_commands_{version}.json"
        data = extract_all_kubectl_commands(version=version, quiet=quiet)

        if data.get("commands"):
            save_kubectl_data(output_path, data)
            results[version] = data
        else:
            if not quiet:
                console.print(f"  [yellow]No kubectl data found for {version}[/yellow]")

    if not quiet:
        console.print(f"\n[bold green]✓ Extracted kubectl commands for {len(results)} versions[/bold green]")

    return results


def get_command_summary(commands: list[dict[str, Any]]) -> list[dict[str, str]]:
    """
    Get a simplified summary of commands for UI display.

    Returns list of {name, description} dicts.
    """
    summary = []
    for cmd in commands:
        name = cmd.get("name", "")
        synopsis = cmd.get("synopsis", "")

        # Shorten synopsis for display
        if synopsis and len(synopsis) > 100:
            synopsis = synopsis[:97] + "..."

        summary.append({
            "name": name,
            "description": synopsis or "",
        })

    return summary
