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

interface PortalTeamCardsPlayer {
  team?: string | null;
  conference?: string | null;
  portal_status?: string | null;
  commit_school?: string | null;
  commit_date?: string | null;
}

const BORDER = "#162241";
const BG = "#0d1a30";

export function PortalTeamCards({ player }: { player: PortalTeamCardsPlayer }) {
  const status = (player.portal_status || "").toUpperCase();
  const isCommitted = status === "COMMITTED" && !!player.commit_school;
  const isWithdrawn = status === "WITHDRAWN";

  const rightValue = isCommitted ? (player.commit_school as string) : isWithdrawn ? (player.team || "Returning") : "In Portal";
  const rightSub = isCommitted
    ? (player.commit_date ? `Committed ${new Date(player.commit_date).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}` : null)
    : isWithdrawn
      ? "Withdrew — returning"
      : null;
  const rightTextColor = isCommitted || isWithdrawn ? "#ffffff" : "hsl(142,71%,45%)";

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-lg border p-4 text-center" style={{ borderColor: BORDER, backgroundColor: BG }}>
        <div className="text-[11px] uppercase tracking-wider font-semibold text-[#8a94a6]">2026 Team</div>
        <div className="text-base font-bold tracking-tight mt-1 leading-tight text-white">{player.team || "Unknown"}</div>
        {player.conference && <div className="text-[10px] text-[#5a6478] mt-1">{player.conference}</div>}
      </div>
      <div className="rounded-lg border p-4 text-center" style={{ borderColor: BORDER, backgroundColor: BG }}>
        <div className="text-[11px] uppercase tracking-wider font-semibold text-[#8a94a6]">2027 Team</div>
        <div className="text-base font-bold tracking-tight mt-1 leading-tight" style={{ color: rightTextColor }}>{rightValue}</div>
        {rightSub && <div className="text-[10px] text-[#5a6478] mt-1">{rightSub}</div>}
      </div>
    </div>
  );
}
