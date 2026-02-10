#!/usr/bin/env bash
# Pipeline integration test script
# Run from pipeline/ directory: ./scripts/test-pipeline.sh
#
# Options:
#   --quick     Quick smoke test (default)
#   --full      Full integration test
#   --no-llm    Skip LLM-dependent tests
#   --no-api    Skip tests requiring API keys

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse args
MODE="quick"
SKIP_LLM=false
SKIP_API=false

for arg in "$@"; do
    case $arg in
        --quick) MODE="quick" ;;
        --full) MODE="full" ;;
        --no-llm) SKIP_LLM=true ;;
        --no-api) SKIP_API=true ;;
        --help|-h)
            echo "Usage: $0 [--quick|--full] [--no-llm] [--no-api]"
            echo ""
            echo "Options:"
            echo "  --quick   Quick smoke test (default)"
            echo "  --full    Full integration test"
            echo "  --no-llm  Skip LLM-dependent tests"
            echo "  --no-api  Skip tests requiring API keys"
            exit 0
            ;;
    esac
done

# Track results
PASSED=0
FAILED=0
SKIPPED=0

run_test() {
    local name="$1"
    local cmd="$2"
    local skip_reason="$3"

    if [[ -n "$skip_reason" ]]; then
        echo -e "${YELLOW}SKIP${NC} $name ($skip_reason)"
        SKIPPED=$((SKIPPED + 1))
        return 0
    fi

    echo -e "${BLUE}TEST${NC} $name"
    echo "     $ $cmd"
    
    if eval "$cmd" > /tmp/test-output.txt 2>&1; then
        echo -e "${GREEN}PASS${NC} $name"
        PASSED=$((PASSED + 1))
    else
        echo -e "${RED}FAIL${NC} $name"
        echo "     Output:"
        tail -10 /tmp/test-output.txt | sed 's/^/     /'
        FAILED=$((FAILED + 1))
    fi
    echo ""
}

echo "========================================"
echo "Pipeline Integration Tests"
echo "Mode: $MODE"
echo "Skip LLM: $SKIP_LLM"
echo "Skip API: $SKIP_API"
echo "========================================"
echo ""

# ============================================
# Phase 0: Unit Tests (always run)
# ============================================
echo -e "${BLUE}=== Phase 0: Unit Tests ===${NC}"
run_test "pytest" "uv run pytest -q"

# ============================================
# Phase 1: No Dependencies (read-only)
# ============================================
echo -e "${BLUE}=== Phase 1: No Dependencies ===${NC}"
run_test "release versions" "uv run k8s-pipeline release versions"
run_test "repo list" "uv run k8s-pipeline repo list"
run_test "release status" "uv run k8s-pipeline release status"
run_test "content list" "uv run k8s-pipeline content list"
run_test "kep list-labels" "uv run k8s-pipeline kep list-labels"

if [[ "$MODE" == "quick" ]]; then
    echo -e "${BLUE}=== Quick Mode Complete ===${NC}"
    echo ""
    echo "========================================"
    echo -e "Results: ${GREEN}$PASSED passed${NC}, ${RED}$FAILED failed${NC}, ${YELLOW}$SKIPPED skipped${NC}"
    echo "========================================"
    exit $FAILED
fi

# ============================================
# Phase 2: Internet (No API Keys)
# ============================================
echo -e "${BLUE}=== Phase 2: Internet (No API Keys) ===${NC}"

# Check if repos exist, sync if not
if [[ ! -d "data/repos/kubernetes" ]]; then
    run_test "repo sync" "uv run k8s-pipeline repo sync kubernetes enhancements website"
fi

run_test "content fetch-sched-dry" "uv run k8s-pipeline content fetch-sched kubecon-eu-2025 --max 3 --no-enrich --dry-run"

# ============================================
# Phase 3: Core Pipeline (uses cached data)
# ============================================
echo -e "${BLUE}=== Phase 3: Core Pipeline ===${NC}"

# Use --skip-sync to avoid network, --no-enrich to skip LLM
ENRICH_FLAG=""
if [[ "$SKIP_LLM" == "true" ]]; then
    ENRICH_FLAG="--no-enrich"
fi

run_test "release process" "uv run k8s-pipeline release process 1.35 --skip-sync --skip-stage $ENRICH_FLAG"

# ============================================
# Phase 4: LLM Tests
# ============================================
echo -e "${BLUE}=== Phase 4: LLM Tests ===${NC}"

SKIP_REASON=""
if [[ "$SKIP_LLM" == "true" ]]; then
    SKIP_REASON="--no-llm flag"
fi

run_test "kep suggest-labels-embedding" "uv run k8s-pipeline kep suggest-labels KEP-1287 --method embedding"
run_test "kep suggest-labels-llm" "uv run k8s-pipeline kep suggest-labels KEP-1287 --method llm --top 3" "$SKIP_REASON"

# ============================================
# Phase 5: API Key Tests
# ============================================
echo -e "${BLUE}=== Phase 5: API Key Tests ===${NC}"

SKIP_REASON=""
if [[ "$SKIP_API" == "true" ]]; then
    SKIP_REASON="--no-api flag"
elif [[ -z "$YOUTUBE_API_KEY" ]]; then
    SKIP_REASON="YOUTUBE_API_KEY not set"
fi

run_test "content fetch-youtube" "uv run k8s-pipeline content fetch-youtube kubecon-na-2024 --max 3 --dry-run" "$SKIP_REASON"

# ============================================
# Phase 6: Export & Build
# ============================================
echo -e "${BLUE}=== Phase 6: Export ===${NC}"
run_test "export parquet" "uv run k8s-pipeline export parquet"
run_test "export docs" "uv run k8s-pipeline export docs"

# ============================================
# Summary
# ============================================
echo ""
echo "========================================"
echo -e "Results: ${GREEN}$PASSED passed${NC}, ${RED}$FAILED failed${NC}, ${YELLOW}$SKIPPED skipped${NC}"
echo "========================================"

exit $FAILED
