import { useParams } from "react-router-dom";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { PortalStatusBadge } from "@/components/PortalStatus";
import PlayerPageTabs from "@/components/PlayerPageTabs";
import { usePlayerSourceId } from "@/hooks/usePlayerSourceId";
import { usePitcherMaster } from "@/savant/hooks/usePitcherMaster";
import { PitcherPitchLog } from "@/savant/components/PitchLogSection";

const SEASON = 2026;

/**
 * /dashboard/pitcher/:id/stats — 2026 pitch-log analysis for a pitcher.
 *
 * Sibling route to /dashboard/pitcher/:id (PitcherProfile, the projection-
 * focused view). Same URL :id (UUID), but this page surfaces the
 * actual-season aggregated splits + per-pitch-type breakdown from the
 * pitch_log pipeline.
 *
 * Hitter counterpart: /dashboard/player/:id/stats (PlayerStatsPage).
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
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {player?.position && (
              <Badge variant="secondary" className="text-xs uppercase tracking-wider">
                {player.position}
              </Badge>
            )}
            {pm?.Role && (
              <Badge variant="outline" className="text-xs uppercase tracking-wider border-[#D4AF37]/40 text-[#D4AF37]">
                {pm.Role}
              </Badge>
            )}
            {player?.schoolName && (
              <Badge variant="outline" className="text-xs">{player.schoolName}</Badge>
            )}
            {player?.conference && (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                {player.conference}
              </Badge>
            )}
            {player && (player.portalStatus === null || player.portalStatus === "NOT IN PORTAL") ? (
              <Badge className="bg-muted text-muted-foreground border-0 text-[10px] font-semibold uppercase tracking-wider">
                Not In Portal
              </Badge>
            ) : (
              player && (
                <PortalStatusBadge
                  player={{ portal_status: player.portalStatus }}
                  isAdmin={false}
                />
              )
            )}
          </div>
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
