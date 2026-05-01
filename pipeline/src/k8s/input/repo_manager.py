"""Manage local clones of upstream Kubernetes repositories."""

import shutil
import subprocess
from pathlib import Path

from rich.console import Console

from ..core.config import REPOS_DIR

console = Console()

# Repository configurations
REPOS = {
    "kubernetes": {
        "url": "https://github.com/kubernetes/kubernetes.git",
        "description": "Main K8s repo (CHANGELOGs, API specs, source)",
        "default_branch": "master",
    },
    "enhancements": {
        "url": "https://github.com/kubernetes/enhancements.git",
        "description": "KEPs (Kubernetes Enhancement Proposals)",
        "default_branch": "master",
    },
    "sig-release": {
        "url": "https://github.com/kubernetes/sig-release.git",
        "description": "Release schedules and notes",
        "default_branch": "master",
    },
    "website": {
        "url": "https://github.com/kubernetes/website.git",
        "description": "Official documentation",
        "default_branch": "main",
    },
    "lwkd": {
        "url": "https://github.com/kubernetes-sigs/lwkd.git",
        "description": "Last Week in Kubernetes Development - curated weekly summaries",
        "default_branch": "main",
        # Posts are in _posts/ directory as markdown files
        # Format: YYYY-MM-DD-update.md
        # Website: https://lwkd.info
        #
        # FUTURE USE: Aggregate weekly development updates to:
        # - Enrich release notes with context/narrative
        # - Track feature progress between releases
        # - Surface community discussions and decisions
        # - Link KEPs to weekly mentions for timeline view
    },
}

# Default repos to sync (most commonly needed)
DEFAULT_REPOS = ["kubernetes", "enhancements"]


def get_repos_dir() -> Path:
    """Get the repos directory path (pipeline/data/repos/)."""
    return REPOS_DIR


def get_repo_path(repo_name: str) -> Path:
    """Get the path to a specific repo."""
    return get_repos_dir() / repo_name


def run_git(
    args: list[str],
    cwd: Path | None = None,
    timeout: int = 600,
    show_output: bool = False,
) -> tuple[bool, str]:
    """Run a git command and return (success, output)."""
    cmd = ["git", *args]

    try:
        if show_output:
            # Stream output in real-time
            result = subprocess.run(
                cmd,
                cwd=cwd,
                timeout=timeout,
            )
            return result.returncode == 0, ""
        else:
            result = subprocess.run(
                cmd,
                cwd=cwd,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
            output = result.stdout + result.stderr
            return result.returncode == 0, output.strip()
    except subprocess.TimeoutExpired:
        return False, f"Command timed out after {timeout}s"
    except FileNotFoundError:
        return False, "git not found - please install git"
    except Exception as e:
        return False, str(e)


def ensure_full_checkout(repo_path: Path) -> bool:
    """Ensure sparse checkout is disabled for full repo access."""
    sparse_checkout_file = repo_path / ".git" / "info" / "sparse-checkout"

    if sparse_checkout_file.exists():
        console.print("  [dim]Disabling sparse checkout for full repo access...[/dim]")
        success, output = run_git(["sparse-checkout", "disable"], cwd=repo_path)
        if not success:
            console.print(
                f"  [yellow]Warning: Could not disable sparse checkout: {output}[/yellow]"
            )
            return False
        console.print("  [green]✓ Sparse checkout disabled[/green]")

    return True


def clone_repo(repo_name: str) -> bool:
    """Clone a repository (full clone with history)."""
    if repo_name not in REPOS:
        console.print(f"[red]Unknown repo: {repo_name}[/red]")
        console.print(f"Available repos: {', '.join(REPOS.keys())}")
        return False

    repo_config = REPOS[repo_name]
    repo_path = get_repo_path(repo_name)
    repos_dir = get_repos_dir()

    # Create repos directory if needed
    repos_dir.mkdir(parents=True, exist_ok=True)

    # Check if already exists
    if repo_path.exists():
        # Verify it's a valid git repo
        git_dir = repo_path / ".git"
        if git_dir.exists():
            console.print(f"[yellow]Repo already exists: {repo_path}[/yellow]")
            console.print("Use 'sync-repos --pull' to update")
            return True
        else:
            # Directory exists but not a git repo - remove it
            console.print(f"[yellow]Removing invalid repo directory: {repo_path}[/yellow]")
            shutil.rmtree(repo_path)

    console.print(f"\n[bold]Cloning {repo_name}...[/bold]")
    console.print(f"  URL: {repo_config['url']}")
    console.print("  [dim]This may take a few minutes for large repos...[/dim]\n")

    # Full clone (no --depth, no --sparse) to get full history
    # This allows checking out any release branch/tag later
    clone_args = ["clone", repo_config["url"], str(repo_path)]

    success, output = run_git(clone_args, cwd=repos_dir, timeout=1800, show_output=True)

    if not success:
        console.print("\n[red]Clone failed![/red]")
        if output:
            console.print(f"[red]{output}[/red]")
        # Clean up partial clone
        if repo_path.exists():
            shutil.rmtree(repo_path)
        return False

    # Verify clone succeeded
    if not (repo_path / ".git").exists():
        console.print("[red]Clone appeared to succeed but .git directory not found[/red]")
        return False

    # Ensure full checkout (no sparse)
    ensure_full_checkout(repo_path)

    console.print(f"\n[green]✓ Cloned {repo_name}[/green]")
    return True


def pull_repo(repo_name: str) -> bool:
    """Pull latest changes for a repository."""
    repo_path = get_repo_path(repo_name)

    if not repo_path.exists():
        console.print(f"[yellow]Repo not found: {repo_name}[/yellow]")
        console.print("Use 'sync-repos' to clone it first")
        return False

    if not (repo_path / ".git").exists():
        console.print(f"[red]Not a git repo: {repo_path}[/red]")
        return False

    console.print(f"[bold]Pulling {repo_name}...[/bold]")

    # First fetch
    success, output = run_git(["fetch", "--all", "--tags"], cwd=repo_path, timeout=300)
    if not success:
        console.print(f"[red]Fetch failed: {output}[/red]")
        return False

    # Check if we're on a detached HEAD (e.g. checked out at a tag)
    on_branch, ref_output = run_git(["symbolic-ref", "--short", "HEAD"], cwd=repo_path)

    if not on_branch:
        # Detached HEAD — fetch is enough, don't pull or reset
        describe_ok, describe = run_git(["describe", "--tags", "--always"], cwd=repo_path)
        ref_label = describe.strip() if describe_ok else "unknown"
        ensure_full_checkout(repo_path)
        console.print(f"[green]✓ Updated {repo_name}[/green]")
        console.print(f"  [dim]Detached HEAD at {ref_label} (fetch only)[/dim]")
        return True

    # On a branch — pull
    success, output = run_git(["pull", "--ff-only"], cwd=repo_path, timeout=300)

    if not success:
        console.print(f"  [yellow]Pull failed: {output.strip()}[/yellow]")

        repo_config = REPOS.get(repo_name, {})
        branch = repo_config.get("default_branch", "master")

        console.print(f"  [dim]Resetting to origin/{branch}...[/dim]")
        success, output = run_git(["reset", "--hard", f"origin/{branch}"], cwd=repo_path)

    if success:
        ensure_full_checkout(repo_path)
        console.print(f"[green]✓ Updated {repo_name}[/green]")
    else:
        console.print(f"[red]Failed to update {repo_name}: {output}[/red]")

    return success


# Track current checkout state per repo
_repo_checkout_state: dict[str, str | None] = {}
_repo_fetched: set[str] = set()  # Track which repos have been fetched this session


def get_current_checkout(repo_name: str) -> str | None:
    """Get the currently checked out version for a repo."""
    return _repo_checkout_state.get(repo_name)


def fetch_repo(repo_name: str, quiet: bool = False) -> bool:
    """Fetch all branches, tags, and their commits from remote. Only fetches once per session."""
    if repo_name in _repo_fetched:
        return True

    repo_path = get_repo_path(repo_name)
    if not repo_path.exists():
        return False

    if not quiet:
        console.print(f"  [dim]Fetching latest from {repo_name}...[/dim]")

    # Fetch all branches and tags with their commit objects
    # --tags: fetch all tags
    # --prune: remove deleted remote refs
    # --prune-tags: remove deleted remote tags
    success, _ = run_git(
        ["fetch", "--all", "--tags", "--prune", "--prune-tags"], cwd=repo_path, timeout=120
    )
    if success:
        _repo_fetched.add(repo_name)
    return success


def find_latest_tag_for_version(repo_path: Path, version: str) -> str | None:
    """Find the latest stable tag for a K8s version (e.g., v1.34.3 for version 1.34)."""
    success, output = run_git(["tag", "-l", f"v{version}.*"], cwd=repo_path)
    if not success or not output:
        return None

    tags = output.strip().split("\n")

    # Filter to stable tags only (exclude alpha, beta, rc)
    import re

    stable_tags = [t for t in tags if re.match(rf"^v{re.escape(version)}\.\d+$", t)]

    if stable_tags:
        # Sort by patch version and return latest
        stable_tags.sort(key=lambda t: int(t.split(".")[-1]))
        return stable_tags[-1]

    # No stable tags - try rc, beta, alpha in that order (for unreleased versions)
    for suffix in ["-rc", "-beta", "-alpha"]:
        prerelease = [t for t in tags if suffix in t]
        if prerelease:
            prerelease.sort(
                key=lambda t: int(re.search(r"(\d+)$", t).group(1))
                if re.search(r"(\d+)$", t)
                else 0
            )
            return prerelease[-1]

    return None


def checkout_version(repo_name: str, version: str, quiet: bool = False) -> bool:
    """Checkout a specific K8s release version (latest patch tag).

    Strategy:
    1. Fetch latest tags from remote (once per session)
    2. Find latest stable patch tag (e.g., v1.34.3 for version 1.34)
    3. Fall back to prerelease tags (rc > beta > alpha) for unreleased versions
    4. Fall back to release branch if no tags found
    """
    global _repo_checkout_state

    # Skip if already on this version
    if _repo_checkout_state.get(repo_name) == version:
        if not quiet:
            console.print(f"  [dim]Already on {version}[/dim]")
        return True

    repo_path = get_repo_path(repo_name)

    if not repo_path.exists():
        console.print(f"[red]Repo not found: {repo_name}[/red]")
        return False

    # Fetch latest tags before discovering available versions
    fetch_repo(repo_name, quiet=quiet)

    # Find the best tag for this version
    tag = find_latest_tag_for_version(repo_path, version)

    if tag:
        success, _ = run_git(["checkout", tag], cwd=repo_path)
        if success:
            _repo_checkout_state[repo_name] = version
            if not quiet:
                console.print(f"  [green]✓ Checked out {tag}[/green]")
            return True

    # Fall back to release branch
    branch_name = f"release-{version}"
    success, _ = run_git(["checkout", branch_name], cwd=repo_path)

    if success:
        _repo_checkout_state[repo_name] = version
        if not quiet:
            console.print(f"  [green]✓ Checked out {branch_name}[/green]")
        return True

    # Last resort: v{version}.0 tag
    tag_name = f"v{version}.0"
    success, _ = run_git(["checkout", tag_name], cwd=repo_path)

    if success:
        _repo_checkout_state[repo_name] = version
        if not quiet:
            console.print(f"  [green]✓ Checked out {tag_name}[/green]")
        return True

    console.print(f"[red]Could not checkout version {version}[/red]")
    return False


def reset_to_default_branch(repo_name: str) -> bool:
    """Reset repo to its default branch (master/main)."""
    global _repo_checkout_state

    repo_path = get_repo_path(repo_name)
    if not repo_path.exists():
        return False

    repo_config = REPOS.get(repo_name, {})
    branch = repo_config.get("default_branch", "master")

    success, _ = run_git(["checkout", branch], cwd=repo_path)
    if success:
        _repo_checkout_state[repo_name] = None
    return success


def get_repo_status(repo_name: str) -> dict:
    """Get status info for a repository."""
    repo_path = get_repo_path(repo_name)

    status = {
        "name": repo_name,
        "exists": False,
        "path": str(repo_path),
    }

    if not repo_path.exists():
        return status

    git_dir = repo_path / ".git"
    if not git_dir.exists():
        status["error"] = "Not a git repository"
        return status

    status["exists"] = True

    # Get current branch/tag
    success, output = run_git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=repo_path)
    if success:
        status["branch"] = output if output != "HEAD" else None

    # Get current commit
    success, output = run_git(["rev-parse", "--short", "HEAD"], cwd=repo_path)
    if success:
        status["commit"] = output

    # Get commit date
    success, output = run_git(["log", "-1", "--format=%ci"], cwd=repo_path)
    if success:
        status["commit_date"] = output

    # Check if shallow
    shallow_file = git_dir / "shallow"
    status["shallow"] = shallow_file.exists()

    # Get repo size (approximate)
    try:
        size_bytes = sum(f.stat().st_size for f in repo_path.rglob("*") if f.is_file())
        status["size_mb"] = round(size_bytes / (1024 * 1024), 1)
    except OSError:
        pass

    return status


def get_current_ref(repo_name: str) -> str:
    """Get a human-readable description of the current git ref (tag, branch, or commit).

    Returns a string like:
    - "v1.35.0" (if on a tag)
    - "master" (if on a branch)
    - "abc1234 (detached)" (if detached HEAD with no tag)
    """
    repo_path = get_repo_path(repo_name)

    if not repo_path.exists():
        return "(repo not found)"

    # First, try to get exact tag at HEAD
    success, tag = run_git(["describe", "--tags", "--exact-match", "HEAD"], cwd=repo_path)
    if success and tag:
        return tag

    # Check if on a branch
    success, branch = run_git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=repo_path)
    if success and branch and branch != "HEAD":
        # Get short commit for context
        _, commit = run_git(["rev-parse", "--short", "HEAD"], cwd=repo_path)
        return f"{branch} ({commit})"

    # Detached HEAD - try to describe relative to nearest tag
    success, desc = run_git(["describe", "--tags", "--always"], cwd=repo_path)
    if success and desc:
        return f"{desc} (detached)"

    # Last resort: just the commit
    success, commit = run_git(["rev-parse", "--short", "HEAD"], cwd=repo_path)
    if success:
        return f"{commit} (detached)"

    return "(unknown)"


def sync_repos(
    repos: list[str] | None = None,
    pull: bool = False,
) -> dict[str, bool]:
    """Sync (clone or pull) repositories."""
    if repos is None:
        repos = DEFAULT_REPOS

    results = {}

    for repo_name in repos:
        repo_path = get_repo_path(repo_name)

        if repo_path.exists() and (repo_path / ".git").exists():
            if pull:
                results[repo_name] = pull_repo(repo_name)
            else:
                console.print(f"[dim]Skipping {repo_name} (already exists)[/dim]")
                results[repo_name] = True
        else:
            results[repo_name] = clone_repo(repo_name)

    return results


def list_repos() -> list[dict]:
    """List all configured repos and their status."""
    statuses = []
    for repo_name in REPOS:
        status = get_repo_status(repo_name)
        status["description"] = REPOS[repo_name]["description"]
        status["url"] = REPOS[repo_name]["url"]
        statuses.append(status)
    return statuses
