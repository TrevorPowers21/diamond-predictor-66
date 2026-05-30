/**
 * Body-only renderer for an AI-generated scouting report. The hosting card
 * (with its title/border) is provided by the profile page so this slots into
 * the existing "Scouting Report" card on PlayerProfile / PitcherProfile.
 *
 * Splits the body into paragraphs, bolds the lead banner sentence, and
 * converts inline **bold** markdown to <strong>. Renders nothing when body
 * is empty — the caller is responsible for falling back to whatever else.
 */

function renderInline(text: string, keyBase: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    const m = part.match(/^\*\*([^*]+)\*\*$/);
    if (m) return <strong key={`${keyBase}-${i}`} className="text-slate-100 font-semibold">{m[1]}</strong>;
    return <span key={`${keyBase}-${i}`}>{part}</span>;
  });
}

export function AiScoutingReportBody({
  body,
  generatedAt,
}: {
  body: string | null | undefined;
  generatedAt?: string | null;
}) {
  if (!body) return null;
  const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return null;
  const generated = generatedAt
    ? new Date(generatedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : null;

  return (
    <div>
      <div className="space-y-2.5">
        {paragraphs.map((para, i) => (
          <p
            key={i}
            className={
              i === 0
                ? "text-xs text-slate-100 leading-relaxed font-medium"
                : "text-xs text-slate-300 leading-relaxed"
            }
          >
            {renderInline(para, `p${i}`)}
          </p>
        ))}
      </div>
      {generated && <p className="mt-3 text-[10px] text-slate-500">Generated {generated}</p>}
    </div>
  );
}
