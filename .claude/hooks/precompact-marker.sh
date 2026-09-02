#!/usr/bin/env bash
# PreCompact — fires immediately BEFORE context is compacted.
#
# Compaction replaces real conversation history with a lossy summary, and nothing in the tool itself
# forces the agent to re-ground afterwards. That is the "off voice for a while" problem
# (docs/rstr-agent-plan.md §7b).
#
# This hook does exactly one thing: drop a one-shot marker. The re-grounding is done by
# postcompact-reground.sh, because a PreCompact hook cannot inject context into the *post*-compaction
# turn. Keep it that way — this script must stay fast and side-effect-free.

set -uo pipefail

STATE_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}/.claude/state"
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0

# stdin carries the hook payload as JSON; "manual" (/compact) vs "auto" (context full).
TRIGGER=$(cat 2>/dev/null | sed -n 's/.*"trigger"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
printf '%s\n' "${TRIGGER:-unknown}" > "$STATE_DIR/.compacted" 2>/dev/null || true

exit 0
