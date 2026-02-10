"""
Build a data-driven label taxonomy from KEP titles and summaries.

This module extracts common themes/topics from all KEPs using:
1. TF-IDF to find important terms
2. Clustering to group related terms
3. Optional LLM refinement to create human-readable labels

Usage:
    from k8s.transform.taxonomy_builder import build_taxonomy_from_keps

    # Extract raw terms
    terms = extract_key_terms()

    # Build taxonomy with LLM
    taxonomy = build_taxonomy_from_keps()
"""

import json
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from ...core.config import CURATED_KEPS_DIR, PIPELINE_ROOT

KEPS_DIR = PIPELINE_ROOT / "data" / "repos" / "enhancements" / "keps"
TAXONOMY_PATH = CURATED_KEPS_DIR / "label_taxonomy.json"


@dataclass
class KepText:
    """KEP text data for analysis."""
    kep_number: int
    title: str
    sig: str
    summary: str  # First ~1000 tokens of README


def load_all_kep_texts() -> list[KepText]:
    """Load title + summary for all KEPs."""
    from ..kep.parser import scan_all_keps

    keps = scan_all_keps()
    results = []

    for kep in keps:
        readme_path = KEPS_DIR / kep.kep_path / "README.md"
        summary = ""

        if readme_path.exists():
            try:
                with open(readme_path) as f:
                    content = f.read()

                # Extract Summary and Motivation sections (most informative)
                extracted_sections = []

                for section_name in ["## Summary", "## Motivation"]:
                    if section_name in content:
                        start = content.find(section_name)
                        # Find next section
                        end = content.find("\n## ", start + 10)
                        if end == -1:
                            end = start + 1500
                        section_text = content[start:end]
                        extracted_sections.append(section_text)

                if extracted_sections:
                    summary = "\n".join(extracted_sections)
                else:
                    # Fallback: take first 1500 chars after title
                    lines = content.split('\n')
                    # Skip title line
                    summary = '\n'.join(lines[1:])[:1500]

                # Clean up
                summary = re.sub(r'\[.*?\]\(.*?\)', '', summary)  # Remove links
                summary = re.sub(r'```.*?```', '', summary, flags=re.DOTALL)  # Remove code blocks
                summary = re.sub(r'<!--.*?-->', '', summary, flags=re.DOTALL)  # Remove HTML comments
                summary = re.sub(r'\s+', ' ', summary).strip()
                summary = summary[:1500]  # ~375 tokens

            except Exception:
                pass

        results.append(KepText(
            kep_number=kep.kep_number,
            title=kep.title,
            sig=kep.owning_sig,
            summary=summary,
        ))

    return results


def extract_key_terms(min_df: int = 3, max_df: float = 0.5, top_n: int = 100) -> list[tuple[str, float]]:
    """
    Extract key terms from all KEPs using TF-IDF.

    Args:
        min_df: Minimum document frequency (term must appear in at least this many KEPs)
        max_df: Maximum document frequency ratio (ignore terms in more than this % of KEPs)
        top_n: Number of top terms to return

    Returns:
        List of (term, score) tuples sorted by importance
    """
    try:
        from sklearn.feature_extraction.text import TfidfVectorizer
    except ImportError:
        raise ImportError("scikit-learn required: pip install scikit-learn")

    keps = load_all_kep_texts()

    # Combine title and summary for each KEP
    documents = [f"{k.title} {k.summary}" for k in keps]

    # Custom tokenizer to handle K8s terms
    def tokenize(text):
        # Lowercase and split on non-alphanumeric
        tokens = re.findall(r'[a-z][a-z0-9]*(?:-[a-z0-9]+)*', text.lower())
        # Filter short tokens and common words
        stopwords = {
            # English stopwords
            'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
            'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
            'would', 'could', 'should', 'may', 'might', 'must', 'shall',
            'can', 'need', 'to', 'of', 'in', 'for', 'on', 'with', 'at',
            'by', 'from', 'as', 'into', 'through', 'during', 'before',
            'after', 'above', 'below', 'between', 'under', 'again',
            'further', 'then', 'once', 'here', 'there', 'when', 'where',
            'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other',
            'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same',
            'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or',
            'because', 'until', 'while', 'this', 'that', 'these', 'those',
            'it', 'its', 'they', 'them', 'their', 'what', 'which', 'who',
            'whom', 'we', 'us', 'our', 'you', 'your', 'he', 'him', 'his',
            'she', 'her', 'any', 'every', 'many', 'much', 'either', 'neither',
            'both', 'whether', 'however', 'therefore', 'thus', 'hence',
            # Generic verbs
            'kep', 'kubernetes', 'k8s', 'feature', 'support',
            'add', 'new', 'use', 'using', 'used', 'allow', 'allows',
            'enable', 'enables', 'provide', 'provides', 'implement',
            'implementation', 'change', 'changes', 'update', 'updates',
            'make', 'makes', 'made', 'get', 'gets', 'set', 'sets',
            'create', 'creates', 'delete', 'deletes', 'run', 'runs',
            'start', 'starts', 'stop', 'stops', 'want', 'wants',
            'work', 'works', 'working', 'ensure', 'ensures',
            # README template boilerplate
            'section', 'documentation', 'guide', 'style', 'release',
            'notes', 'summary', 'proposal', 'proposes', 'length',
            'https', 'github', 'com', 'information', 'way',
            'community', 'order', 'document',
            'specific', 'possible', 'also', 'see', 'following',
            'example', 'examples', 'currently', 'current', 'default',
            'based', 'well', 'like', 'existing', 'already', 'without',
            'within', 'across', 'per', 'via', 'etc', 'e-g', 'i-e',
            'note', 'please', 'details', 'detail', 'described',
            'describe', 'description',
        }
        return [t for t in tokens if len(t) > 2 and t not in stopwords]

    vectorizer = TfidfVectorizer(
        tokenizer=tokenize,
        min_df=min_df,
        max_df=max_df,
        ngram_range=(1, 2),  # Include bigrams like "pod-security"
    )

    tfidf_matrix = vectorizer.fit_transform(documents)
    feature_names = vectorizer.get_feature_names_out()

    # Sum TF-IDF scores across all documents
    scores = tfidf_matrix.sum(axis=0).A1
    term_scores = list(zip(feature_names, scores, strict=False))
    term_scores.sort(key=lambda x: -x[1])

    return term_scores[:top_n]


def extract_term_clusters(n_clusters: int = 25) -> dict[str, list[str]]:
    """
    Cluster related terms together using embeddings.

    Returns dict mapping cluster label to list of terms.
    """
    try:
        from sentence_transformers import SentenceTransformer
        from sklearn.cluster import KMeans
    except ImportError:
        raise ImportError("Required: pip install sentence-transformers scikit-learn")

    # Get top terms
    terms = extract_key_terms(top_n=200)
    term_names = [t[0] for t in terms]

    # Embed terms
    model = SentenceTransformer("all-MiniLM-L6-v2")
    embeddings = model.encode(term_names)

    # Cluster
    kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
    labels = kmeans.fit_predict(embeddings)

    # Group terms by cluster
    clusters: dict[int, list[tuple[str, float]]] = {}
    for i, (term, score) in enumerate(terms):
        cluster_id = labels[i]
        if cluster_id not in clusters:
            clusters[cluster_id] = []
        clusters[cluster_id].append((term, score))

    # Name clusters by their top term
    result = {}
    for _cluster_id, cluster_terms in clusters.items():
        cluster_terms.sort(key=lambda x: -x[1])
        label = cluster_terms[0][0]
        result[label] = [t[0] for t in cluster_terms[:10]]

    return result


def build_taxonomy(provider: str | None = None) -> dict:
    """
    Build a refined taxonomy using LLM to group and name categories.

    Takes the raw TF-IDF terms and asks LLM to:
    1. Group related terms into categories
    2. Name each category
    3. Write descriptions
    """
    from ..llm_utils import create_agent, get_provider_config, load_config

    # Get raw terms
    terms = extract_key_terms(top_n=150)
    term_list = [t[0] for t in terms]

    # Get KEP counts by SIG for context
    keps = load_all_kep_texts()
    sig_counts = Counter(k.sig for k in keps)

    system_prompt = """You are an expert in Kubernetes architecture and the KEP (Kubernetes Enhancement Proposal) process.

Your task is to create a taxonomy of labels for categorizing KEPs based on the most common terms found in KEP titles and summaries.

Guidelines:
- Create 15-25 categories that cover the major areas of Kubernetes development
- Each category should have a clear, lowercase, hyphenated name (e.g., "resource-management", "pod-security")
- Include related terms that should map to each category
- Write a brief description for each category
- Categories should be mutually exclusive where possible
- Consider the Kubernetes SIG structure but don't be limited by it"""

    user_prompt = f"""Here are the most important terms extracted from {len(keps)} KEPs using TF-IDF analysis:

{', '.join(term_list)}

KEPs by SIG:
{', '.join(f'{sig}: {count}' for sig, count in sig_counts.most_common(15))}

Create a taxonomy with 15-25 categories. Respond in JSON format:
{{
  "categories": {{
    "category-name": {{
      "description": "Brief description of what this category covers",
      "related_terms": ["term1", "term2", "term3", ...]
    }},
    ...
  }}
}}"""

    config = load_config()
    provider_name, provider_config = get_provider_config(config, provider)

    agent = create_agent(
        provider_name,  # type: ignore
        provider_config,
        system_prompt,
    )

    result = agent(user_prompt)
    response = str(result)

    # Parse JSON
    if "```json" in response:
        response = response.split("```json")[1].split("```")[0]
    elif "```" in response:
        response = response.split("```")[1].split("```")[0]

    taxonomy = json.loads(response.strip())

    # Add metadata
    taxonomy["version"] = "2.0"
    taxonomy["description"] = f"Data-driven taxonomy built from {len(keps)} KEPs"
    taxonomy["source"] = "TF-IDF extraction + LLM refinement"

    return taxonomy


def save_taxonomy(taxonomy: dict, path: Path | None = None) -> Path:
    """Save taxonomy to JSON file."""
    output_path = path or TAXONOMY_PATH
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, "w") as f:
        json.dump(taxonomy, f, indent=2)

    return output_path


def load_taxonomy() -> dict:
    """Load taxonomy from JSON file."""
    if not TAXONOMY_PATH.exists():
        return {"categories": {}}
    with open(TAXONOMY_PATH) as f:
        return json.load(f)


def get_taxonomy() -> dict:
    """Get taxonomy, loading from file if exists."""
    return load_taxonomy()
