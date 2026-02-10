"""
Shared utilities for LLM enrichment: config, model creation, pricing, usage tracking.

All LLM enrichers should import from this module instead of duplicating code.
"""

import sys
from typing import Any, Literal

import yaml

from ..core.config import PIPELINE_ROOT

CONFIG_PATH = PIPELINE_ROOT / "llm_config.yaml"

# Supported providers
ProviderType = Literal["ollama", "bedrock", "anthropic", "openai", "gemini"]

# Default model ID (used when not specified in config)
DEFAULT_MODEL_ID = "us.amazon.nova-2-lite-v1:0"

# Pricing per 1M tokens (input, output) in USD
# NOTE: AWS doesn't provide a pricing API for Bedrock models
# Update from: https://aws.amazon.com/bedrock/pricing/
# Last updated: Jan 2025
MODEL_PRICING: dict[str, tuple[float, float]] = {
    # Bedrock - Mistral (per 1M tokens)
    "mistral.mistral-large-3-675b-instruct": (2.00, 6.00),
    # Bedrock - MiniMax (per 1M tokens)
    "minimax.minimax-m2": (0.24, 0.96),  # 8% of Claude Sonnet cost
    # Bedrock - DeepSeek (per 1M tokens)
    "deepseek.r1-v1:0": (1.35, 5.40),
    "us.deepseek.r1-v1:0": (1.35, 5.40),  # cross-region inference
    # Bedrock - Amazon Nova 2
    "us.amazon.nova-2-lite-v1:0": (0.30, 2.50),
    "us.amazon.nova-2-pro-v1:0": (1.00, 4.00),  # estimate
    # Bedrock - Amazon Nova 1
    "amazon.nova-micro-v1:0": (0.035, 0.14),
    "amazon.nova-lite-v1:0": (0.06, 0.24),
    "amazon.nova-pro-v1:0": (0.80, 3.20),
    # Bedrock - Anthropic
    "us.anthropic.claude-sonnet-4-20250514-v1:0": (3.00, 15.00),
    "anthropic.claude-sonnet-4-20250514-v1:0": (3.00, 15.00),
    "anthropic.claude-3-5-sonnet-20241022-v2:0": (3.00, 15.00),
    "anthropic.claude-3-haiku-20240307-v1:0": (0.25, 1.25),
    # Anthropic direct
    "claude-sonnet-4-20250514": (3.00, 15.00),
    "claude-3-5-sonnet-20241022": (3.00, 15.00),
    "claude-3-haiku-20240307": (0.25, 1.25),
    # OpenAI
    "gpt-4o": (2.50, 10.00),
    "gpt-4o-mini": (0.15, 0.60),
    # OpenAI on Bedrock
    "openai.gpt-oss-120b-1:0": (0.15, 0.60),
    "openai.gpt-oss-20b-1:0": (0.07, 0.30),
    "gpt-4-turbo": (10.00, 30.00),
    # Google Gemini
    "gemini-2.0-flash": (0.10, 0.40),
    "gemini-1.5-pro": (1.25, 5.00),
    "gemini-1.5-flash": (0.075, 0.30),
    # Ollama (free/local)
    "llama3.2": (0.0, 0.0),
    "qwen3:8b": (0.0, 0.0),
    "qwen3:32b": (0.0, 0.0),
}


def log(msg: str) -> None:
    """Log to stderr."""
    print(msg, file=sys.stderr, flush=True)


def load_config() -> dict:
    """Load LLM configuration from yaml file."""
    if not CONFIG_PATH.exists():
        log(f"  [WARN] Config file not found: {CONFIG_PATH}")
        return {"provider": "bedrock"}

    try:
        with open(CONFIG_PATH) as f:
            return yaml.safe_load(f) or {}
    except Exception as e:
        log(f"  [WARN] Failed to load config: {e}")
        return {"provider": "bedrock"}


def get_provider_config(config: dict, provider: str | None = None) -> tuple[str, dict]:
    """Get provider name and its configuration."""
    provider_name = provider or config.get("provider", "bedrock")
    provider_config = config.get(provider_name, {})
    return provider_name, provider_config


def get_effective_model_id(provider_config: dict, model_id_override: str | None = None) -> str:
    """Get the effective model ID from override or config."""
    return model_id_override or provider_config.get("model_id", DEFAULT_MODEL_ID)


def create_model(
    provider: ProviderType,
    provider_config: dict,
    model_id_override: str | None = None,
    max_tokens: int | None = None,
):
    """
    Create a Strands model instance based on provider configuration.

    Args:
        provider: Provider name (ollama, bedrock, anthropic, openai, gemini)
        provider_config: Provider-specific config from yaml
        model_id_override: Optional model ID override
        max_tokens: Optional max tokens override (uses config or default 4096)

    Returns:
        Configured model instance
    """
    try:
        import strands  # noqa: F401
    except ImportError:
        raise ImportError(
            "strands-agents is required for LLM enrichment. "
            "Install with: uv pip install 'strands-agents[anthropic]'"
        )

    effective_max_tokens = max_tokens or provider_config.get("max_tokens", 4096)

    if provider == "ollama":
        from strands.models.ollama import OllamaModel

        host = provider_config.get("host", "http://localhost:11434")
        model_id = model_id_override or provider_config.get("model_id", "llama3.2")
        keep_alive = provider_config.get("keep_alive", "5m")
        temperature = provider_config.get("temperature")

        log(f"  Using Ollama: {host} / {model_id}" + (f" (temp={temperature})" if temperature else ""))

        return OllamaModel(
            host=host,
            model_id=model_id,
            keep_alive=keep_alive,
            temperature=temperature,
        )

    elif provider == "anthropic":
        from strands.models.anthropic import AnthropicModel

        model_id = model_id_override or provider_config.get("model_id", "claude-sonnet-4-20250514")

        log(f"  Using Anthropic: {model_id}")

        return AnthropicModel(model_id=model_id, max_tokens=effective_max_tokens)

    elif provider == "openai":
        from strands.models.openai import OpenAIModel

        model_id = model_id_override or provider_config.get("model_id", "gpt-4o")

        log(f"  Using OpenAI: {model_id}")

        return OpenAIModel(model_id=model_id, max_tokens=effective_max_tokens)

    elif provider == "gemini":
        from strands.models.gemini import GeminiModel

        model_id = model_id_override or provider_config.get("model_id", "gemini-2.0-flash")

        log(f"  Using Gemini: {model_id}")

        return GeminiModel(model_id=model_id)

    else:  # bedrock (default)
        from strands.models.bedrock import BedrockModel

        model_id = model_id_override or provider_config.get("model_id", DEFAULT_MODEL_ID)

        log(f"  Using Bedrock: {model_id}")

        # Some models don't support tool use in streaming mode
        # Disable streaming for these models
        use_streaming = not (
            model_id.startswith("us.deepseek") or
            model_id.startswith("minimax") or
            model_id.startswith("openai.gpt-oss")
        )

        return BedrockModel(
            model_id=model_id,
            max_tokens=effective_max_tokens,
            streaming=use_streaming,
        )


def create_agent(
    provider: ProviderType,
    provider_config: dict,
    system_prompt: str,
    model_id_override: str | None = None,
):
    """
    Create a Strands Agent with the specified configuration.

    Args:
        provider: Provider name
        provider_config: Provider-specific config
        system_prompt: System prompt for the agent
        model_id_override: Optional model ID override

    Returns:
        Configured Agent instance
    """
    from strands import Agent

    model = create_model(provider, provider_config, model_id_override)

    return Agent(
        model=model,
        system_prompt=system_prompt,
        callback_handler=None,
    )


def get_agent_usage(agent: Any) -> tuple[int, int]:
    """
    Extract token usage from an agent's metrics.

    Returns:
        Tuple of (input_tokens, output_tokens)
    """
    try:
        metrics = agent.event_loop_metrics
        usage = metrics.accumulated_usage
        return usage["inputTokens"], usage["outputTokens"]
    except Exception:
        return 0, 0


def get_result_usage(result: Any) -> tuple[int, int]:
    """
    Extract token usage from an AgentResult.

    The new Strands API returns an AgentResult from agent invocations,
    which contains metrics for that specific call.

    Returns:
        Tuple of (input_tokens, output_tokens)
    """
    try:
        # AgentResult has metrics attribute which is EventLoopMetrics
        metrics = result.metrics

        # Try to get usage from the latest agent invocation (most accurate for single call)
        if hasattr(metrics, 'latest_agent_invocation') and metrics.latest_agent_invocation:
            usage = metrics.latest_agent_invocation.usage
            return usage.get("inputTokens", 0), usage.get("outputTokens", 0)

        # Fallback to accumulated_usage
        usage = metrics.accumulated_usage
        return usage.get("inputTokens", 0), usage.get("outputTokens", 0)
    except Exception:
        pass

    return 0, 0


# ============================================================================
# Usage Tracking
# ============================================================================


class UsageTracker:
    """Track token usage and costs across LLM calls (for single-use agents)."""

    def __init__(self, model_id: str):
        self.model_id = model_id
        self.total_input = 0
        self.total_output = 0
        # Get pricing (per 1M tokens)
        self.input_price, self.output_price = MODEL_PRICING.get(model_id, (0.0, 0.0))

    def add(self, input_tokens: int, output_tokens: int) -> None:
        """Add token counts from a call."""
        self.total_input += input_tokens
        self.total_output += output_tokens

    def add_from_agent(self, agent: Any) -> tuple[int, int]:
        """Extract and add usage from an agent's metrics. Returns (input, output)."""
        in_tokens, out_tokens = get_agent_usage(agent)
        self.add(in_tokens, out_tokens)
        return in_tokens, out_tokens

    def calc_cost(self, input_tokens: int, output_tokens: int) -> float:
        """Calculate cost in USD for given token counts."""
        return (input_tokens * self.input_price + output_tokens * self.output_price) / 1_000_000

    def format_call(self, input_tokens: int, output_tokens: int) -> str:
        """Format a single call's usage."""
        if not input_tokens and not output_tokens:
            return ""
        cost = self.calc_cost(input_tokens, output_tokens)
        if cost > 0:
            return f" [{input_tokens}→{output_tokens} ${cost:.4f}]"
        return f" [{input_tokens}→{output_tokens}]"

    def get_total_cost(self) -> float:
        """Get total cost so far."""
        return self.calc_cost(self.total_input, self.total_output)

    def format_total(self) -> str:
        """Get formatted total usage with cost."""
        total = self.total_input + self.total_output
        if not total:
            return ""
        cost = self.get_total_cost()
        if cost > 0:
            return f"{self.total_input:,} input, {self.total_output:,} output, {total:,} total (${cost:.4f})"
        return f"{self.total_input:,} input, {self.total_output:,} output, {total:,} total"


class AgentUsageTracker(UsageTracker):
    """Track usage for a reusable agent (tracks deltas between calls)."""

    def __init__(self, agent: Any, model_id: str):
        super().__init__(model_id)
        self.agent = agent
        self.prev_input = 0
        self.prev_output = 0

    def get_delta(self) -> tuple[int, int]:
        """Get token usage since last call. Returns (input_tokens, output_tokens)."""
        try:
            metrics = self.agent.event_loop_metrics
            usage = metrics.accumulated_usage
            delta_in = usage.inputTokens - self.prev_input
            delta_out = usage.outputTokens - self.prev_output
            self.prev_input = usage.inputTokens
            self.prev_output = usage.outputTokens
            self.total_input += delta_in
            self.total_output += delta_out
            return delta_in, delta_out
        except Exception:
            return 0, 0

    def format_delta(self) -> str:
        """Get formatted token usage string for last call."""
        delta_in, delta_out = self.get_delta()
        return self.format_call(delta_in, delta_out)
