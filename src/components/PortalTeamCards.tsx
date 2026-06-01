/**
 * Two-box portal-move card matching the Stuff+ Overview pattern.
 * Container Card with gold title, inner grid-cols-2 of bordered boxes.
 *
 *   Left box:  "2026 Team" — player.team + conference
 *   Right box: "2027 Team" — based on portal_status:
 *                COMMITTED  = commit_school + commit_date
 *                IN PORTAL  = "In Portal" (emerald-tier styling)
 *                WITHDRAWN  = player.team + "Withdrew — returning"
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface PortalTeamCardsPlayer {
  team?: string | null;
  conference?: string | null;
  portal_status?: string | null;
  commit_school?: string | null;
  commit_date?: string | null;
}

const NEUTRAL = { border: "#162241", bg: "#0d1a30", text: "#ffffff" };
const PORTAL_EMERALD = { border: "hsl(142,71%,45%,0.3)", bg: "hsl(142,71%,45%,0.12)", text: "hsl(142,71%,45%)" };

export function PortalTeamCards({ player }: { player: PortalTeamCardsPlayer }) {
  const status = (player.portal_status || "").toUpperCase();
  const isCommitted = status === "COMMITTED" && !!player.commit_school;
  const isWithdrawn = status === "WITHDRAWN";

  const rightBox = isCommitted
    ? {
        value: player.commit_school as string,
        sub: player.commit_date
          ? `Committed ${new Date(player.commit_date).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}`
          : null,
        style: NEUTRAL,
      }
    : isWithdrawn
      ? {
          value: player.team || "Returning",
          sub: "Withdrew — returning",
          style: NEUTRAL,
        }
      : {
          value: "In Portal",
          sub: null as string | null,
          style: PORTAL_EMERALD,
        };

  return (
    <Card className="border-[#162241] bg-[#0a1428]">
      <CardHeader className="pb-1 pt-3 px-4">
        <CardTitle className="text-sm font-semibold tracking-wide uppercase text-[#D4AF37]" style={{ fontFamily: "Oswald, sans-serif" }}>
          Portal Move
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border p-4 text-center" style={{ borderColor: NEUTRAL.border, backgroundColor: NEUTRAL.bg }}>
            <div className="text-[11px] uppercase tracking-wider font-semibold text-[#8a94a6]">2026 Team</div>
            <div className="text-base font-bold tracking-tight mt-1 leading-tight" style={{ color: NEUTRAL.text }}>{player.team || "Unknown"}</div>
            {player.conference && <div className="text-[10px] text-[#5a6478] mt-1">{player.conference}</div>}
          </div>
          <div className="rounded-lg border p-4 text-center" style={{ borderColor: rightBox.style.border, backgroundColor: rightBox.style.bg }}>
            <div className="text-[11px] uppercase tracking-wider font-semibold text-[#8a94a6]">2027 Team</div>
            <div className="text-base font-bold tracking-tight mt-1 leading-tight" style={{ color: rightBox.style.text }}>{rightBox.value}</div>
            {rightBox.sub && <div className="text-[10px] text-[#5a6478] mt-1">{rightBox.sub}</div>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
