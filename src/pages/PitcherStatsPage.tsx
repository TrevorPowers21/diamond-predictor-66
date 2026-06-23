import { useParams } from "react-router-dom";
import DashboardLayout from "@/components/DashboardLayout";
import PlayerPageTabs from "@/components/PlayerPageTabs";
import { PlayerStatsHeader } from "@/components/PlayerStatsHeader";
import { usePlayerSourceId } from "@/hooks/usePlayerSourceId";
import { usePitcherMaster } from "@/savant/hooks/usePitcherMaster";
import { PitcherPitchLog } from "@/savant/components/PitchLogSection";

const SEASON = 2026;

/**
 * /dashboard/pitcher/:id/stats — 2026 pitch-log analysis for a pitcher.
 *
 * Mirrors PitcherProfile's identity strip. Export Report PDF lives on
 * Profile — View Full Report routes there.
 */
export default function PitcherStatsPage() {
  const { id } = useParams<{ id: string }>();
  const { data: player, isLoading } = usePlayerSourceId(id);
  const { data: pm } = usePitcherMaster(player?.sourcePlayerId ?? null, SEASON);

  return (
    <DashboardLayout>
      <div className="space-y-5 p-4 md:p-6">
        {id && <PlayerPageTabs playerId={id} kind="pitcher" />}

        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            {player?.firstName} {player?.lastName}
          </h2>
          {player && id && (
            <PlayerStatsHeader
              player={player}
              kind="pitcher"
              pitcherRole={pm?.Role ?? null}
              profileHref={`/dashboard/pitcher/${id}`}
            />
          )}
        </div>

        {isLoading && (
          <div className="py-10 text-sm text-white/50">Loading player…</div>
        )}

        {!isLoading && !player?.sourcePlayerId && (
          <div className="rounded border border-white/10 bg-white/[0.02] p-6 text-sm text-white/60">
            No pitch-log data linked for this player.
          </div>
        )}

        {player?.sourcePlayerId && (
          <PitcherPitchLog pitcherId={player.sourcePlayerId} season={SEASON} />
        )}
      </div>
    </DashboardLayout>
  );
}
