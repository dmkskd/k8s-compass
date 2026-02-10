"""
Label suggestion for KEPs using embeddings and/or LLM.

This module provides two approaches to suggest labels for KEPs:
1. Embedding-based: Fast, local, uses sentence-transformers
2. LLM-based: More accurate, uses the same taxonomy as context

Both approaches use a curated taxonomy of K8s-specific labels.

Usage:
    from k8s.transform.label_suggester import suggest_labels_embedding, suggest_labels_llm

    # Embedding approach (fast, local)
    labels = suggest_labels_embedding("Pod Level Resource Specifications", top_k=5)

    # LLM approach (more accurate)
    labels = suggest_labels_llm("Pod Level Resource Specifications", kep_summary="...")

    # Compare both
    comparison = compare_labelers("KEP-2837", title, summary)
"""

import json
from dataclasses import dataclass
from pathlib import Path

from ...core.config import CURATED_KEPS_DIR

TAXONOMY_PATH = CURATED_KEPS_DIR / "label_taxonomy.json"


@dataclass
class LabelSuggestion:
    """A suggested label with confidence score."""
    label: str
    score: float
    method: str  # "embedding" or "llm"
    reason: str | None = None


def load_taxonomy() -> dict:
    """Load the curated label taxonomy."""
    if not TAXONOMY_PATH.exists():
        return {"categories": {}}
    with open(TAXONOMY_PATH) as f:
        return json.load(f)


def get_all_labels() -> list[str]:
    """Get all label names from taxonomy."""
    taxonomy = load_taxonomy()
    return list(taxonomy.get("categories", {}).keys())


def get_label_text_for_embedding(label: str, taxonomy: dict) -> str:
    """Build a text representation of a label for embedding comparison."""
    cat = taxonomy.get("categories", {}).get(label, {})
    parts = [label]
    if cat.get("description"):
        parts.append(cat["description"])
    if cat.get("aliases"):
        parts.extend(cat["aliases"])
    if cat.get("related_terms"):
        parts.extend(cat["related_terms"])
    return " ".join(parts)


# ============================================================================
# Embedding-based labeling
# ============================================================================

_embedding_model = None
_label_embeddings = None


def _get_embedding_model():
    """Lazy-load the sentence transformer model."""
    global _embedding_model
    if _embedding_model is None:
        try:
            from sentence_transformers import SentenceTransformer
            # all-MiniLM-L6-v2 is small (80MB) and fast
            _embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
        except ImportError:
            raise ImportError(
                "sentence-transformers not installed. "
                "Run: pip install sentence-transformers"
            )
    return _embedding_model


def _get_label_embeddings():
    """Get or compute embeddings for all labels in taxonomy."""
    global _label_embeddings
    if _label_embeddings is None:
        model = _get_embedding_model()
        taxonomy = load_taxonomy()

        _label_embeddings = {}
        for label in taxonomy.get("categories", {}).keys():
            text = get_label_text_for_embedding(label, taxonomy)
            _label_embeddings[label] = model.encode(text, convert_to_tensor=True)

    return _label_embeddings


def suggest_labels_embedding(
    text: str,
    top_k: int = 5,
    min_score: float = 0.3,
) -> list[LabelSuggestion]:
    """
    Suggest labels using sentence embeddings.

    Args:
        text: KEP title, summary, or combined text
        top_k: Maximum number of labels to return
        min_score: Minimum similarity score (0-1)

    Returns:
        List of LabelSuggestion sorted by score descending
    """
    try:
        from sentence_transformers import util
    except ImportError:
        raise ImportError(
            "sentence-transformers not installed. "
            "Run: pip install sentence-transformers"
        )

    model = _get_embedding_model()
    label_embeddings = _get_label_embeddings()

    # Embed the input text
    text_embedding = model.encode(text, convert_to_tensor=True)

    # Compute similarity with each label
    suggestions = []
    for label, label_emb in label_embeddings.items():
        score = util.cos_sim(text_embedding, label_emb).item()
        if score >= min_score:
            suggestions.append(LabelSuggestion(
                label=label,
                score=round(score, 3),
                method="embedding",
            ))

    # Sort by score and take top_k
    suggestions.sort(key=lambda x: x.score, reverse=True)
    return suggestions[:top_k]


# ============================================================================
# LLM-based labeling
# ============================================================================

def suggest_labels_llm(
    title: str,
    summary: str | None = None,
    top_k: int = 5,
    provider: str | None = None,
) -> list[LabelSuggestion]:
    """
    Suggest labels using LLM with taxonomy as context.

    Args:
        title: KEP title
        summary: Optional KEP summary/description
        top_k: Maximum number of labels to return
        provider: LLM provider ("bedrock" or "anthropic")

    Returns:
        List of LabelSuggestion sorted by score descending
    """
    from ..llm_utils import (
        UsageTracker,
        create_agent,
        get_provider_config,
        get_result_usage,
        load_config,
    )

    taxonomy = load_taxonomy()

    # Build taxonomy context for the prompt
    taxonomy_text = "Available labels and their meanings:\n\n"
    for label, info in taxonomy.get("categories", {}).items():
        taxonomy_text += f"- **{label}**: {info.get('description', '')}\n"
        if info.get("related_terms"):
            taxonomy_text += f"  Related: {', '.join(info['related_terms'][:5])}\n"

    # Build the prompt
    kep_text = f"Title: {title}"
    if summary:
        kep_text += f"\n\nSummary: {summary}"

    system_prompt = f"""You are labeling Kubernetes Enhancement Proposals (KEPs) with standardized labels.

{taxonomy_text}

Instructions:
- Select the {top_k} most relevant labels from the taxonomy above
- Only use labels from the provided taxonomy
- Be precise with scores - use high scores (>0.8) only for strong matches
- Respond ONLY with valid JSON, no other text"""

    user_prompt = f"""KEP to label:
{kep_text}

Respond in JSON format:
{{
  "labels": [
    {{"label": "label-name", "score": 0.85, "reason": "brief explanation"}},
    ...
  ]
}}"""

    try:
        config = load_config()
        provider_name, provider_config = get_provider_config(config, provider)

        agent = create_agent(
            provider_name,  # type: ignore
            provider_config,
            system_prompt,
        )

        result = agent(user_prompt)
        response = str(result)

        # Track usage
        in_tokens, out_tokens = get_result_usage(result)
        if in_tokens or out_tokens:
            tracker = UsageTracker(provider_config.get("model_id", "unknown"))
            print(f"  LLM usage:{tracker.format_call(in_tokens, out_tokens)}")

        # Parse JSON response
        # Handle markdown code blocks
        if "```json" in response:
            response = response.split("```json")[1].split("```")[0]
        elif "```" in response:
            response = response.split("```")[1].split("```")[0]

        data = json.loads(response.strip())

        suggestions = []
        valid_labels = set(taxonomy.get("categories", {}).keys())

        for item in data.get("labels", [])[:top_k]:
            label = item.get("label", "").lower().replace(" ", "-")
            if label in valid_labels:
                suggestions.append(LabelSuggestion(
                    label=label,
                    score=round(float(item.get("score", 0.5)), 3),
                    method="llm",
                    reason=item.get("reason"),
                ))

        suggestions.sort(key=lambda x: x.score, reverse=True)
        return suggestions

    except Exception as e:
        print(f"LLM labeling failed: {e}")
        return []


# ============================================================================
# Comparison utilities
# ============================================================================

@dataclass
class LabelComparison:
    """Comparison of embedding vs LLM label suggestions."""
    kep: str
    title: str
    embedding_labels: list[LabelSuggestion]
    llm_labels: list[LabelSuggestion]
    agreement: list[str]  # Labels suggested by both
    embedding_only: list[str]  # Labels only from embedding
    llm_only: list[str]  # Labels only from LLM


def compare_labelers(
    kep: str,
    title: str,
    summary: str | None = None,
    top_k: int = 5,
    provider: str | None = None,
) -> LabelComparison:
    """
    Compare embedding and LLM label suggestions for a KEP.

    Args:
        kep: KEP identifier (e.g., "KEP-2837")
        title: KEP title
        summary: Optional KEP summary
        top_k: Number of labels to suggest from each method
        provider: LLM provider

    Returns:
        LabelComparison with results from both methods
    """
    # Combine title and summary for embedding
    text = title
    if summary:
        text = f"{title}. {summary}"

    # Get suggestions from both methods
    embedding_labels = suggest_labels_embedding(text, top_k=top_k)
    llm_labels = suggest_labels_llm(title, summary, top_k=top_k, provider=provider)

    # Compute agreement
    emb_set = {s.label for s in embedding_labels}
    llm_set = {s.label for s in llm_labels}

    return LabelComparison(
        kep=kep,
        title=title,
        embedding_labels=embedding_labels,
        llm_labels=llm_labels,
        agreement=list(emb_set & llm_set),
        embedding_only=list(emb_set - llm_set),
        llm_only=list(llm_set - emb_set),
    )


def print_comparison(comp: LabelComparison) -> None:
    """Pretty-print a label comparison."""
    print(f"\n{'='*60}")
    print(f"{comp.kep}: {comp.title}")
    print(f"{'='*60}\n")

    print("EMBEDDING LABELS:")
    for s in comp.embedding_labels:
        print(f"  {s.label:25} {s.score:.3f}")

    print("\nLLM LABELS:")
    for s in comp.llm_labels:
        reason = f" - {s.reason}" if s.reason else ""
        print(f"  {s.label:25} {s.score:.3f}{reason}")

    print(f"\nAGREEMENT ({len(comp.agreement)}):", ", ".join(comp.agreement) or "none")
    print("EMBEDDING ONLY:", ", ".join(comp.embedding_only) or "none")
    print("LLM ONLY:", ", ".join(comp.llm_only) or "none")
