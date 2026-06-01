/**
 * Dual-team cards for portal-active players. Shown on both PlayerProfile
 * (hitters) and PitcherProfile (pitchers). Left = where they played in 2026,
 * right = where they're going for 2027 based on portal_status:
 *   IN PORTAL  → "In Portal" (emerald)
 *   COMMITTED  → commit_school + commit_date
 *   WITHDRAWN  → same as 2026 team, labeled "Returning"
 */

import { Card, CardContent } from "@/components/ui/card";

interface PortalTeamCardsPlayer {
  team?: string | null;
  conference?: string | null;
  portal_status?: string | null;
  commit_school?: string | null;
  commit_date?: string | null;
}

export function PortalTeamCards({ player }: { player: PortalTeamCardsPlayer }) {
  const status = (player.portal_status || "").toUpperCase();
  const isCommitted = status === "COMMITTED" && !!player.commit_school;
  const isWithdrawn = status === "WITHDRAWN";

  return (
    <div className="grid grid-cols-2 gap-3">
      <Card>
        <CardContent className="pt-3 pb-2.5">
          <div className="text-xs font-medium text-muted-foreground">2026 Team</div>
          <div className="text-lg font-bold mt-1">{player.team || "Unknown"}</div>
          {player.conference && <div className="text-xs text-muted-foreground">{player.conference}</div>}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-3 pb-2.5">
          <div className="text-xs font-medium text-muted-foreground">2027 Team</div>
          {isCommitted ? (
            <>
              <div className="text-lg font-bold mt-1">{player.commit_school}</div>
              {player.commit_date && (
                <div className="text-xs text-muted-foreground">
                  Committed {new Date(player.commit_date).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}
                </div>
              )}
            </>
          ) : isWithdrawn ? (
            <>
              <div className="text-lg font-bold mt-1">{player.team || "Returning"}</div>
              <div className="text-xs text-muted-foreground">Withdrew — returning</div>
            </>
          ) : (
            <div className="text-lg font-bold mt-1 text-emerald-600">In Portal</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
