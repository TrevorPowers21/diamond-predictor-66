#!/usr/bin/env bash
# Re-grounding after compaction. Wired to TWO events for belt-and-braces:
#
#   SessionStart(matcher: compact)  — the direct path. Fires when a session resumes from a compact.
#   UserPromptSubmit               — the fallback. Fires on the next prompt; only acts if the
#                                    marker from precompact-marker.sh is present, then clears it.
#
# Whichever fires first consumes the marker, so the state file is injected exactly ONCE per
# compaction. Both paths print to stdout, which the tool adds to the model's context.
#
# Why a marker at all: a PreCompact hook cannot inject context into the post-compaction turn, so the
# signal has to survive the boundary as a file. See docs/rstr-agent-plan.md §7b.

set -uo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
STATE_DIR="$PROJECT_DIR/.claude/state"
MARKER="$STATE_DIR/.compacted"
STATE_FILE="$STATE_DIR/current.md"
EVENT="${1:-prompt}"

# SessionStart(compact) is authoritative — it only fires on a real compaction, so it does not need
# the marker to be present. UserPromptSubmit is the fallback and MUST see a marker, otherwise it
# would re-inject the state file on every single prompt.
if [ "$EVENT" != "session" ] && [ ! -f "$MARKER" ]; then
  exit 0
fi

# One-shot: consume the marker before printing, so a crash mid-print cannot cause a re-inject loop.
TRIGGER="unknown"
[ -f "$MARKER" ] && { TRIGGER=$(cat "$MARKER" 2>/dev/null || echo unknown); rm -f "$MARKER" 2>/dev/null || true; }

[ -f "$STATE_FILE" ] || exit 0

cat <<EOF
<system-reminder>
CONTEXT WAS COMPACTED (trigger: ${TRIGGER}). The conversation history above is a lossy summary, not
the real transcript. Re-ground BEFORE continuing — do not infer state from the summary alone.

The current state file is reproduced below. It is the authority on what is in progress. If it
disagrees with the summary, THE STATE FILE WINS.

If the work has moved on since it was written, update .claude/state/current.md (overwrite it, never
append) so the next compaction lands on accurate state.

--- BEGIN .claude/state/current.md ---
$(cat "$STATE_FILE")
--- END .claude/state/current.md ---
</system-reminder>
EOF

exit 0
