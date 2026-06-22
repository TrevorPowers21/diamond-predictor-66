import { useParams } from "react-router-dom";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { PortalStatusBadge } from "@/components/PortalStatus";
import PlayerPageTabs from "@/components/PlayerPageTabs";
import { usePlayerSourceId } from "@/hooks/usePlayerSourceId";
import { HitterPitchLog } from "@/savant/components/PitchLogSection";

const SEASON = 2026;

/**
 * /dashboard/player/:id/stats — 2026 pitch-log analysis for a hitter.
 *
 * Sibling route to /dashboard/player/:id (PlayerProfile, the projection-
 * focused view). Same URL :id (UUID), but this page surfaces the
 * actual-season aggregated splits from the pitch_log pipeline.
 *
 * Pitcher counterpart: /dashboard/pitcher/:id/stats (PitcherStatsPage).
 */
export default function PlayerStatsPage() {
  const { id } = useParams<{ id: string }>();
  const { data: player, isLoading } = usePlayerSourceId(id);

  return (
    <DashboardLayout>
      <div className="space-y-5 p-4 md:p-6">
        {id && <PlayerPageTabs playerId={id} kind="player" />}

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
