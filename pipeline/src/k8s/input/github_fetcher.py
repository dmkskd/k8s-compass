"""
Fetch PR and Issue details from GitHub API using githubkit with TTL-based caching.

Uses githubkit (the modern Python GitHub SDK inspired by octokit) for proper
API handling including pagination, rate limits, and typed responses.

Caches responses locally to avoid hitting rate limits and speed up repeated runs.
Cache entries expire after a configurable TTL (default 24 hours).

## Usage

```python
from k8s.input.github_fetcher import GitHubFetcher

fetcher = GitHubFetcher(token="ghp_xxx")  # Optional token for higher rate limits

# Fetch a single PR
pr = fetcher.fetch_pr(133779)
print(pr.title, pr.user_facing_change, pr.related_issues)

# Fetch multiple PRs (batched, respects rate limits)
prs = fetcher.fetch_prs([133779, 134744, 134298])
```

## Cache Structure

```
pipeline/.cache/github/
├── prs/
│   ├── 133779.json
│   └── 134744.json
└── issues/
    └── 106893.json
```

Each cached file contains:
```json
{
  "fetched_at": "2025-01-17T10:30:00Z",
  "data": { ... GitHub API response ... },
  "parsed": { ... extracted fields ... }
}
```
"""

import json
import os
import re
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from githubkit import GitHub
from githubkit.exception import PrimaryRateLimitExceeded, RequestFailed
from rich.console import Console

from ..core.config import CACHE_DIR

console = Console()

# Cache directory for GitHub data
GITHUB_CACHE_DIR = CACHE_DIR / "github"
PR_CACHE_DIR = GITHUB_CACHE_DIR / "prs"
ISSUE_CACHE_DIR = GITHUB_CACHE_DIR / "issues"

# Default TTL: 24 hours
DEFAULT_TTL_HOURS = 24

# Repository
OWNER = "kubernetes"
REPO = "kubernetes"


@dataclass
class PRDetails:
    """Parsed PR details."""
    number: int
    title: str
    author: str
    state: str  # open, closed, merged
    merged: bool
    created_at: str
    merged_at: str | None

    # Milestone (e.g., "v1.35" - tells us which release this PR targets)
    milestone: str | None = None

    # Extracted from PR body
    user_facing_change: str | None = None
    pr_kind: str | None = None  # /kind feature, /kind bug, etc.
    related_issues: list[int] = field(default_factory=list)
    related_keps: list[str] = field(default_factory=list)
    sigs: list[str] = field(default_factory=list)

    # Raw data
    body: str = ""
    labels: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "number": self.number,
            "title": self.title,
            "author": self.author,
            "state": self.state,
            "merged": self.merged,
            "createdAt": self.created_at,
            "mergedAt": self.merged_at,
            "milestone": self.milestone,
            "userFacingChange": self.user_facing_change,
            "prKind": self.pr_kind,
            "relatedIssues": self.related_issues,
            "relatedKeps": self.related_keps,
            "sigs": self.sigs,
            "labels": self.labels,
        }


@dataclass
class IssueDetails:
    """Parsed Issue details."""
    number: int
    title: str
    author: str
    state: str  # open, closed
    created_at: str
    closed_at: str | None

    body: str = ""
    labels: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "number": self.number,
            "title": self.title,
            "author": self.author,
            "state": self.state,
            "createdAt": self.created_at,
            "closedAt": self.closed_at,
            "labels": self.labels,
        }


class GitHubFetcher:
    """Fetch GitHub PR/Issue data using githubkit with TTL-based caching."""

    def __init__(
        self,
        token: str | None = None,
        ttl_hours: int = DEFAULT_TTL_HOURS,
        cache_dir: Path | None = None,
    ):
        """
        Initialize the fetcher.

        Args:
            token: GitHub personal access token (optional, increases rate limit)
            ttl_hours: Cache TTL in hours (default 24)
            cache_dir: Custom cache directory (default: pipeline/.cache/github)
        """
        self.token = token or os.environ.get("GITHUB_TOKEN")
        self.ttl = timedelta(hours=ttl_hours)
        self.cache_dir = cache_dir or GITHUB_CACHE_DIR

        # Ensure cache directories exist
        (self.cache_dir / "prs").mkdir(parents=True, exist_ok=True)
        (self.cache_dir / "issues").mkdir(parents=True, exist_ok=True)

        # Initialize githubkit client
        if self.token:
            self.github = GitHub(self.token)
        else:
            self.github = GitHub()

    def _cache_path(self, kind: str, number: int) -> Path:
        """Get cache file path for a PR or issue."""
        return self.cache_dir / kind / f"{number}.json"

    def _is_cache_valid(self, cache_path: Path) -> bool:
        """Check if cache file exists and is within TTL."""
        if not cache_path.exists():
            return False

        try:
            with open(cache_path) as f:
                data = json.load(f)

            fetched_at = datetime.fromisoformat(data["fetched_at"].replace("Z", "+00:00"))
            age = datetime.now(UTC) - fetched_at
            return age < self.ttl
        except (json.JSONDecodeError, KeyError, ValueError):
            return False

    def _read_cache(self, cache_path: Path) -> dict | None:
        """Read cached data if valid."""
        if not self._is_cache_valid(cache_path):
            return None

        try:
            with open(cache_path) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return None

    def _write_cache(self, cache_path: Path, api_data: dict, parsed: dict) -> None:
        """Write data to cache."""
        cache_data = {
            "fetched_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            "data": api_data,
            "parsed": parsed,
        }
        with open(cache_path, "w") as f:
            json.dump(cache_data, f, indent=2)

    def _parse_pr_body(self, body: str) -> dict:
        """Parse structured fields from PR body."""
        result = {
            "user_facing_change": None,
            "pr_kind": None,
            "related_issues": [],
            "related_keps": [],
            "sigs": [],
        }

        if not body:
            return result

        # Extract /kind labels
        kind_match = re.search(r"/kind\s+(\w+)", body, re.IGNORECASE)
        if kind_match:
            result["pr_kind"] = kind_match.group(1).lower()

        # Extract related issues (Fixes #123, Closes #456, etc.)
        issue_patterns = [
            r"(?:fixes|closes|resolves|fix|close|resolve)\s*#(\d+)",
            r"(?:fixes|closes|resolves|fix|close|resolve)\s+https://github\.com/kubernetes/kubernetes/issues/(\d+)",
        ]
        for pattern in issue_patterns:
            for match in re.finditer(pattern, body, re.IGNORECASE):
                issue_num = int(match.group(1))
                if issue_num not in result["related_issues"]:
                    result["related_issues"].append(issue_num)

        # Extract KEP references
        kep_patterns = [
            r"KEP[- ]?(\d+)",
            r"kubernetes/enhancements.*?/(\d+)",
            r"kep\.k8s\.io/(\d+)",
        ]
        for pattern in kep_patterns:
            for match in re.finditer(pattern, body, re.IGNORECASE):
                kep = f"KEP-{match.group(1)}"
                if kep not in result["related_keps"]:
                    result["related_keps"].append(kep)

        # Extract SIG mentions
        sig_match = re.findall(r"\[SIG\s+([^\]]+)\]", body)
        if sig_match:
            # Last [SIG ...] usually has the list
            sigs_str = sig_match[-1]
            result["sigs"] = [s.strip() for s in re.split(r"[,\s]+and\s+|,\s*", sigs_str)]

        # Extract user-facing change (release note)
        uf_patterns = [
            # Code block with release-note
            r"```release-note\s*\n(.+?)\n```",
            # Code block after user-facing change question
            r"user-facing change\?\s*\n+```\s*\n(.+?)\n```",
            # Plain text after the HTML comment template (skip the comment)
            r"user-facing change\?\s*\n+<!--.*?-->\s*\n+(.+?)(?:\n\n|\nAdditional|\Z)",
        ]
        for pattern in uf_patterns:
            match = re.search(pattern, body, re.IGNORECASE | re.DOTALL)
            if match:
                note = match.group(1).strip()
                # Skip if it's just "NONE" or empty or still contains template text
                if note.upper() in ("NONE", "N/A", "NA", "NO", ""):
                    continue
                if "release-note block below" in note.lower():
                    continue
                result["user_facing_change"] = note
                break

        return result

    def fetch_pr(self, pr_number: int, force: bool = False, retry_on_rate_limit: bool = False) -> PRDetails | None:
        """
        Fetch PR details.

        Args:
            pr_number: PR number to fetch
            force: Force refresh even if cache is valid
            retry_on_rate_limit: If True, wait and retry when rate limited

        Returns:
            PRDetails or None if not found
        """
        cache_path = self._cache_path("prs", pr_number)

        # Check cache first (unless force refresh)
        if not force:
            cached = self._read_cache(cache_path)
            if cached:
                return PRDetails(**cached["parsed"])

        # Fetch from GitHub API using githubkit
        try:
            response = self.github.rest.pulls.get(
                owner=OWNER,
                repo=REPO,
                pull_number=pr_number,
            )
            data = response.parsed_data
        except PrimaryRateLimitExceeded as e:
            wait_seconds = e.retry_after.total_seconds() if e.retry_after else 60
            if retry_on_rate_limit and wait_seconds < 300:  # Only wait if < 5 min
                console.print(f"  [yellow]Rate limited, waiting {wait_seconds:.0f}s...[/yellow]")
                time.sleep(wait_seconds + 1)
                return self.fetch_pr(pr_number, force=force, retry_on_rate_limit=False)
            else:
                console.print(f"  [red]Rate limited! Resets in {wait_seconds/60:.0f} min. Use GITHUB_TOKEN for higher limits.[/red]")
                return None
        except RequestFailed as e:
            if e.response.status_code == 404:
                console.print(f"  [yellow]PR #{pr_number} not found[/yellow]")
            elif e.response.status_code == 403:
                console.print("  [red]Forbidden (rate limit or auth issue)[/red]")
            else:
                console.print(f"  [red]API error {e.response.status_code} for PR #{pr_number}[/red]")
            return None

        # Parse the PR body
        body = data.body or ""
        parsed_body = self._parse_pr_body(body)

        # Extract milestone title (e.g., "v1.35")
        milestone = None
        if data.milestone:
            milestone = data.milestone.title

        pr = PRDetails(
            number=data.number,
            title=data.title,
            author=data.user.login if data.user else "unknown",
            state=data.state.value if hasattr(data.state, 'value') else str(data.state),
            merged=data.merged or False,
            created_at=data.created_at.isoformat() if data.created_at else "",
            merged_at=data.merged_at.isoformat() if data.merged_at else None,
            milestone=milestone,
            body=body,
            labels=[label.name for label in (data.labels or [])],
            user_facing_change=parsed_body["user_facing_change"],
            pr_kind=parsed_body["pr_kind"],
            related_issues=parsed_body["related_issues"],
            related_keps=parsed_body["related_keps"],
            sigs=parsed_body["sigs"],
        )

        # Cache the result (convert to dict for JSON serialization)
        api_data = {
            "number": data.number,
            "title": data.title,
            "user": {"login": data.user.login if data.user else "unknown"},
            "state": pr.state,
            "merged": data.merged,
            "created_at": pr.created_at,
            "merged_at": pr.merged_at,
            "milestone": milestone,
            "body": body,
            "labels": [{"name": lbl.name} for lbl in (data.labels or [])],
        }
        self._write_cache(cache_path, api_data, pr.__dict__)

        return pr

    def fetch_prs(
        self,
        pr_numbers: list[int],
        force: bool = False,
        progress: bool = True,
    ) -> dict[int, PRDetails]:
        """
        Fetch multiple PRs.

        Args:
            pr_numbers: List of PR numbers to fetch
            force: Force refresh even if cache is valid
            progress: Show progress output

        Returns:
            Dict mapping PR number to PRDetails
        """
        results = {}
        total = len(pr_numbers)
        cached_count = 0
        fetched_count = 0
        failed_count = 0

        # Count how many we actually need to fetch
        to_fetch = []
        for pr_num in pr_numbers:
            cache_path = self._cache_path("prs", pr_num)
            if force or not self._is_cache_valid(cache_path):
                to_fetch.append(pr_num)

        # Check rate limit if we need to fetch many
        if len(to_fetch) > 10:
            status = self.get_rate_limit_status()
            remaining = status.get("remaining", 0)
            if remaining < len(to_fetch):
                console.print(f"  [yellow]Warning: Need {len(to_fetch)} API calls but only {remaining} remaining[/yellow]")
                if remaining == 0:
                    console.print(f"  [red]Rate limit exhausted! Resets at {status.get('reset', 'unknown')}[/red]")
                    console.print("  [dim]Set GITHUB_TOKEN env var for 5000 req/hr (vs 60 unauthenticated)[/dim]")
                    # Return what we can from cache
                    for pr_num in pr_numbers:
                        cached = self._read_cache(self._cache_path("prs", pr_num))
                        if cached:
                            results[pr_num] = PRDetails(**cached["parsed"])
                            cached_count += 1
                    if progress:
                        console.print(f"  [yellow]⚠ {cached_count} from cache, {len(to_fetch)} skipped (rate limited)[/yellow]")
                    return results

        for _i, pr_num in enumerate(pr_numbers):
            cache_path = self._cache_path("prs", pr_num)

            # Check if we can use cache
            if not force and self._is_cache_valid(cache_path):
                cached = self._read_cache(cache_path)
                if cached:
                    results[pr_num] = PRDetails(**cached["parsed"])
                    cached_count += 1
                    continue

            # Need to fetch
            if progress and fetched_count > 0 and fetched_count % 10 == 0:
                console.print(f"  [{cached_count + fetched_count}/{total}] Fetching PRs...")

            pr = self.fetch_pr(pr_num, force=True)
            if pr:
                results[pr_num] = pr
                fetched_count += 1
            else:
                failed_count += 1
                # Stop if we hit rate limit
                if failed_count > 3:
                    console.print("  [yellow]Too many failures, stopping early[/yellow]")
                    break

        if progress:
            msg = f"  [green]✓ {cached_count} cached, {fetched_count} fetched[/green]"
            if failed_count:
                msg += f" [yellow]({failed_count} failed)[/yellow]"
            console.print(msg)

        return results

    def fetch_issue(self, issue_number: int, force: bool = False) -> IssueDetails | None:
        """
        Fetch Issue details.

        Args:
            issue_number: Issue number to fetch
            force: Force refresh even if cache is valid

        Returns:
            IssueDetails or None if not found
        """
        cache_path = self._cache_path("issues", issue_number)

        # Check cache first
        if not force:
            cached = self._read_cache(cache_path)
            if cached:
                return IssueDetails(**cached["parsed"])

        # Fetch from GitHub API using githubkit
        try:
            response = self.github.rest.issues.get(
                owner=OWNER,
                repo=REPO,
                issue_number=issue_number,
            )
            data = response.parsed_data
        except PrimaryRateLimitExceeded as e:
            wait_seconds = e.retry_after.total_seconds() if e.retry_after else 60
            console.print(f"  [red]Rate limited! Resets in {wait_seconds/60:.0f} min[/red]")
            return None
        except RequestFailed as e:
            if e.response.status_code == 404:
                console.print(f"  [yellow]Issue #{issue_number} not found[/yellow]")
            elif e.response.status_code == 403:
                console.print("  [red]Rate limited![/red]")
            else:
                console.print(f"  [red]API error {e.response.status_code} for Issue #{issue_number}[/red]")
            return None

        issue = IssueDetails(
            number=data.number,
            title=data.title,
            author=data.user.login if data.user else "unknown",
            state=data.state.value if hasattr(data.state, 'value') else str(data.state),
            created_at=data.created_at.isoformat() if data.created_at else "",
            closed_at=data.closed_at.isoformat() if data.closed_at else None,
            body=data.body or "",
            labels=[label.name for label in (data.labels or []) if hasattr(label, 'name')],
        )

        # Cache the result
        api_data = {
            "number": data.number,
            "title": data.title,
            "user": {"login": data.user.login if data.user else "unknown"},
            "state": issue.state,
            "created_at": issue.created_at,
            "closed_at": issue.closed_at,
            "body": issue.body,
            "labels": [{"name": lbl} for lbl in issue.labels],
        }
        self._write_cache(cache_path, api_data, issue.__dict__)

        return issue

    def get_rate_limit_status(self) -> dict:
        """Get current rate limit status."""
        try:
            response = self.github.rest.rate_limit.get()
            core = response.parsed_data.resources.core
            return {
                "limit": core.limit,
                "remaining": core.remaining,
                "reset": datetime.fromtimestamp(core.reset, tz=UTC).isoformat(),
            }
        except RequestFailed:
            return {}

    def clear_cache(self, kind: str | None = None) -> int:
        """
        Clear cached data.

        Args:
            kind: "prs", "issues", or None for all

        Returns:
            Number of files deleted
        """
        count = 0
        dirs = []

        if kind is None or kind == "prs":
            dirs.append(self.cache_dir / "prs")
        if kind is None or kind == "issues":
            dirs.append(self.cache_dir / "issues")

        for d in dirs:
            if d.exists():
                for f in d.glob("*.json"):
                    f.unlink()
                    count += 1

        return count

    def list_prs(
        self,
        state: str = "closed",
        base: str | None = None,
        per_page: int = 100,
        max_pages: int = 10,
    ) -> list[PRDetails]:
        """
        List PRs with pagination support.

        Args:
            state: PR state filter (open, closed, all)
            base: Base branch filter (e.g., "release-1.35")
            per_page: Results per page (max 100)
            max_pages: Maximum pages to fetch

        Returns:
            List of PRDetails
        """
        results = []
        page = 1

        while page <= max_pages:
            try:
                response = self.github.rest.pulls.list(
                    owner=OWNER,
                    repo=REPO,
                    state=state,  # type: ignore
                    base=base,
                    per_page=per_page,
                    page=page,
                )
                prs = response.parsed_data

                if not prs:
                    break

                for pr_data in prs:
                    body = pr_data.body or ""
                    parsed_body = self._parse_pr_body(body)

                    pr = PRDetails(
                        number=pr_data.number,
                        title=pr_data.title,
                        author=pr_data.user.login if pr_data.user else "unknown",
                        state=pr_data.state.value if hasattr(pr_data.state, 'value') else str(pr_data.state),
                        merged=pr_data.merged_at is not None,
                        created_at=pr_data.created_at.isoformat() if pr_data.created_at else "",
                        merged_at=pr_data.merged_at.isoformat() if pr_data.merged_at else None,
                        body=body,
                        labels=[label.name for label in (pr_data.labels or [])],
                        user_facing_change=parsed_body["user_facing_change"],
                        pr_kind=parsed_body["pr_kind"],
                        related_issues=parsed_body["related_issues"],
                        related_keps=parsed_body["related_keps"],
                        sigs=parsed_body["sigs"],
                    )
                    results.append(pr)

                console.print(f"  [dim]Page {page}: {len(prs)} PRs[/dim]")
                page += 1

            except RequestFailed as e:
                console.print(f"  [red]API error: {e}[/red]")
                break

        return results

    def fetch_issues(
        self,
        issue_numbers: list[int],
        force: bool = False,
        progress: bool = True,
    ) -> dict[int, IssueDetails]:
        """
        Fetch multiple issues.

        Args:
            issue_numbers: List of issue numbers to fetch
            force: Force refresh even if cache is valid
            progress: Show progress output

        Returns:
            Dict mapping issue number to IssueDetails
        """
        results = {}
        cached_count = 0
        fetched_count = 0
        failed_count = 0

        for issue_num in issue_numbers:
            cache_path = self._cache_path("issues", issue_num)

            # Check if we can use cache
            if not force and self._is_cache_valid(cache_path):
                cached = self._read_cache(cache_path)
                if cached:
                    results[issue_num] = IssueDetails(**cached["parsed"])
                    cached_count += 1
                    continue

            # Need to fetch
            issue = self.fetch_issue(issue_num, force=True)
            if issue:
                results[issue_num] = issue
                fetched_count += 1
            else:
                failed_count += 1
                # Stop if we hit too many failures (likely rate limited)
                if failed_count > 3:
                    if progress:
                        console.print("  [yellow]Too many failures, stopping early[/yellow]")
                    break

        if progress:
            msg = f"  [green]✓ {cached_count} cached, {fetched_count} fetched[/green]"
            if failed_count:
                msg += f" [yellow]({failed_count} failed)[/yellow]"
            console.print(msg)

        return results
