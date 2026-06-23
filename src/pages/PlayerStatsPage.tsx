import { useParams } from "react-router-dom";
import DashboardLayout from "@/components/DashboardLayout";
import PlayerPageTabs from "@/components/PlayerPageTabs";
import { PlayerStatsHeader } from "@/components/PlayerStatsHeader";
import { usePlayerSourceId } from "@/hooks/usePlayerSourceId";
import { HitterPitchLog } from "@/savant/components/PitchLogSection";

const SEASON = 2026;

/**
 * /dashboard/player/:id/stats — 2026 pitch-log analysis for a hitter.
 *
 * Sibling route to /dashboard/player/:id (PlayerProfile). Same identity
 * strip layout (badges row + action button row) as Profile so coaches
 * can do research here without switching tabs.
 *
 * Export Report PDF lives on Profile — the View Full Report button
 * routes there.
 */
export default function PlayerStatsPage() {
  const { id } = useParams<{ id: string }>();
  const { data: player, isLoading } = usePlayerSourceId(id);

  return (
    <DashboardLayout>
      <div className="space-y-5 p-4 md:p-6">
        {id && <PlayerPageTabs playerId={id} kind="player" />}

        {player && id && (
          <PlayerStatsHeader
            player={player}
            kind="hitter"
            playerName={`${player.firstName ?? ""} ${player.lastName ?? ""}`.trim()}
            profileHref={`/dashboard/player/${id}`}
          />
        )}

        {isLoading && (
          <div className="py-10 text-sm text-white/50">Loading player…</div>
        )}

        {!isLoading && !player?.sourcePlayerId && (
          <div className="rounded border border-white/10 bg-white/[0.02] p-6 text-sm text-white/60">
            No pitch-log data linked for this player. (Player record may be
            missing a <code>source_player_id</code>, or the player wasn&apos;t
            tracked in 2026.)
          </div>
        )}

        {player?.sourcePlayerId && (
          <HitterPitchLog batterId={player.sourcePlayerId} season={SEASON} />
        )}
      </div>
    </DashboardLayout>
  );
}
