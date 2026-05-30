import { FileText } from "lucide-react";
import { useScoutingReport } from "@/hooks/useScoutingReport";

/**
 * Read-only display of the bulk-generated AI scouting report for a (player, side).
 * Reports are stable until the next bulk run, so there is no refresh control.
 * Renders nothing when there is no report (e.g., player below the sample floor).
 */
function renderInline(text: string, keyBase: string) {
  // Convert **bold** spans to <strong>; leave the rest as plain text.
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    const m = part.match(/^\*\*([^*]+)\*\*$/);
    if (m) return <strong key={`${keyBase}-${i}`} className="text-slate-100 font-semibold">{m[1]}</strong>;
    return <span key={`${keyBase}-${i}`}>{part}</span>;
  });
}

export function AiScoutingReport({
  playerId,
  side,
}: {
  playerId: string | null | undefined;
  side: "hitter" | "pitcher";
}) {
  const { data } = useScoutingReport(playerId, side);
  if (!data?.body) return null;

  const paragraphs = data.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const generated = new Date(data.generated_at).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="border-[#162241] bg-[#0a1428] rounded-lg border">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <h3
          className="text-sm font-semibold tracking-wide uppercase text-[#D4AF37] flex items-center gap-2"
          style={{ fontFamily: "Oswald, sans-serif" }}
        >
          <FileText className="h-4 w-4 text-[#D4AF37]" />
          Scouting Report
        </h3>
      </div>
      <div className="px-4 pb-3 space-y-3">
        {paragraphs.map((para, i) => (
          <p
            key={i}
            className={
              i === 0
                ? "text-[13px] text-slate-100 leading-relaxed font-medium"
                : "text-[13px] text-slate-300 leading-relaxed"
            }
          >
            {renderInline(para, `p${i}`)}
          </p>
        ))}
      </div>
      <div className="px-4 pb-3">
        <p className="text-[10px] text-slate-500">Generated {generated}</p>
      </div>
    </div>
  );
}
