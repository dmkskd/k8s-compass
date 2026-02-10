# Kubernetes Release Notes Data

Structured release notes for the K8s API Explorer, enabling:
- Per-release summaries and browsing
- Cross-release feature tracking (e.g., "show DRA's journey from alpha → stable")
- Linking features to affected API Kinds and fields

## Data Sources

Kubernetes release documentation follows a consistent structure derived from:

### 1. KEPs (Kubernetes Enhancement Proposals)
Each feature has a `kep.yaml` in [kubernetes/enhancements](https://github.com/kubernetes/enhancements):

```yaml
title: "In-place Update of Pod Resources"
kep-number: 1287
status: implemented
authors: ["@vinaykul"]
owning-sig: sig-node
participating-sigs: ["sig-autoscaling"]
stage: stable                    # alpha | beta | stable
latest-milestone: "v1.35"
milestone:
  alpha: "v1.27"
  beta: "v1.33"
  stable: "v1.35"
feature-gates:
  - name: InPlacePodVerticalScaling
    components: ["kubelet", "kube-apiserver"]
```

### 2. Release Blog Posts
Official announcements at `kubernetes.io/blog/YYYY/MM/DD/kubernetes-vX-YY-release/` follow a template:
- Theme/codename
- Summary stats (X stable, Y beta, Z alpha)
- "Spotlight" features (hand-picked highlights)
- Features graduating to Stable (grouped by SIG)
- New features in Beta
- New features in Alpha
- Deprecations and Removals
- Each feature links to its KEP

### 3. CHANGELOG
Raw changelog at `kubernetes/kubernetes/CHANGELOG/CHANGELOG-X.YY.md`

## Schema

See `schema.json` for the full JSON Schema. Key fields:

```json
{
  "version": "1.35",
  "codename": "Timbernetes",
  "releaseDate": "2025-12-17",
  "summary": { "total": 60, "stable": 17, "beta": 19, "alpha": 22 },
  "features": [
    {
      "kep": "KEP-1287",
      "title": "In-place Update of Pod Resources",
      "stage": "stable",
      "sig": "Node",
      "category": "Resource Management",
      "description": "...",
      "affectedKinds": ["Pod"],
      "affectedFields": ["spec.containers[].resources"],
      "history": { "alpha": "1.27", "beta": "1.33", "stable": "1.35" }
    }
  ],
  "deprecations": [...],
  "removals": [...],
  "references": [...]
}
```

## Cross-Release Queries

The `history` field enables tracking features across releases:

```javascript
// Find all features that graduated to stable in 1.35
features.filter(f => f.history.stable === "1.35")

// Find DRA-related features across all releases
allReleases.flatMap(r => r.features.filter(f => f.title.includes("DRA")))

// Find what changed for Pod kind in 1.34
features.filter(f => f.affectedKinds?.includes("Pod"))
```

## Automation Strategy

### Agent Design (Strands-based)

```python
# Pseudocode for release notes extraction agent

class ReleaseNotesAgent:
    """
    Given a Kubernetes version, extract structured release notes.
    """
    
    tools = [
        WebSearchTool(),      # Find release blog and external articles
        WebFetchTool(),       # Fetch and parse content
        GitHubAPITool(),      # Query kubernetes/enhancements for KEPs
    ]
    
    def extract_release(self, version: str) -> ReleaseNotes:
        # 1. Fetch official release blog
        blog_url = f"https://kubernetes.io/blog/.../kubernetes-v{version}-release/"
        blog_content = self.fetch(blog_url)
        
        # 2. Parse structured sections
        sections = self.parse_release_blog(blog_content)
        # Returns: { spotlight: [...], stable: [...], beta: [...], alpha: [...], deprecations: [...] }
        
        # 3. Enrich each feature with KEP data
        for feature in sections.all_features:
            kep_data = self.fetch_kep(feature.kep_number)
            feature.history = kep_data.milestone
            feature.affected_kinds = self.infer_kinds(kep_data)
            feature.feature_gate = kep_data.feature_gates[0].name
        
        # 4. Find external blog posts
        references = self.search_blogs(f"Kubernetes {version} release")
        
        # 5. Return structured data
        return ReleaseNotes(
            version=version,
            features=sections.all_features,
            references=references
        )
    
    def parse_release_blog(self, content: str) -> Sections:
        """
        Release blogs have consistent structure:
        - "Features graduating to Stable" section
        - "New features in Beta" section  
        - "New features in Alpha" section
        - Each feature has: title, description, KEP link, SIG
        """
        # Use LLM to extract structured data from markdown
        pass
    
    def fetch_kep(self, kep_number: int) -> KEPData:
        """
        Fetch kep.yaml from kubernetes/enhancements repo
        """
        url = f"https://raw.githubusercontent.com/kubernetes/enhancements/master/keps/sig-*/KEP-{kep_number}/kep.yaml"
        # Parse YAML, extract milestone history
        pass
    
    def infer_kinds(self, kep_data: KEPData) -> list[str]:
        """
        Infer affected Kubernetes Kinds from KEP content.
        Look for: API types mentioned, spec/status fields, examples
        """
        pass
```

### Key Patterns in Release Blogs

1. **Feature entries** follow this pattern:
   ```markdown
   ### Feature Title
   
   Description paragraph explaining what it does.
   
   This work was done as part of KEP #NNNN led by SIG Name.
   ```

2. **Stage sections** are clearly labeled:
   - "Features graduating to Stable"
   - "New features in Beta"  
   - "New features in Alpha"

3. **Deprecations** have:
   - Item name
   - Reason
   - Replacement
   - Target removal version

### Linking to API Kinds

To connect features to specific Kinds:

1. **KEP content analysis**: KEPs mention affected API types
2. **Feature gate mapping**: Feature gates often correspond to specific APIs
3. **Field path extraction**: Look for `spec.foo` or `status.bar` patterns
4. **Manual curation**: Some mappings require human review

## Files

- `schema.json` - JSON Schema for release data
- `1.XX.json` - Per-version release notes
- `README.md` - This file
