/**
 * Compact portal-move display for the left sidebar of player profiles.
 * Two rows stacked inside one card, matching the Career Stats / Internal
 * Power Ratings card style (navy bg, gold title, Inter/Oswald).
 *
 *   2026 Team line  → player.team + conference
 *   2027 Team line  → COMMITTED  = commit_school + commit_date
 *                     IN PORTAL  = "In Portal" (emerald)
 *                     WITHDRAWN  = player.team + "Withdrew — returning"
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

  const next = isCommitted
    ? { label: player.commit_school as string, sub: player.commit_date ? `Committed ${new Date(player.commit_date).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}` : null, color: "text-white" }
    : isWithdrawn
      ? { label: player.team || "Returning", sub: "Withdrew — returning", color: "text-white" }
      : { label: "In Portal", sub: null as string | null, color: "text-emerald-600" };

  return (
    <Card className="border-[#162241] bg-[#0a1428]">
      <CardHeader className="pb-1 pt-3 px-4">
        <CardTitle className="text-sm font-semibold tracking-wide uppercase text-[#D4AF37]" style={{ fontFamily: "Oswald, sans-serif" }}>
          Portal Move
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 space-y-2.5" style={{ fontFamily: "Inter, sans-serif" }}>
        <div>
          <div className="text-[10px] uppercase tracking-wider font-semibold text-[#8a94a6]">2026 Team</div>
          <div className="text-sm font-semibold text-white mt-0.5">{player.team || "Unknown"}</div>
          {player.conference && <div className="text-[10px] text-[#8a94a6]">{player.conference}</div>}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider font-semibold text-[#8a94a6]">2027 Team</div>
          <div className={`text-sm font-semibold mt-0.5 ${next.color}`}>{next.label}</div>
          {next.sub && <div className="text-[10px] text-[#8a94a6]">{next.sub}</div>}
        </div>
      </CardContent>
    </Card>
  );
}
