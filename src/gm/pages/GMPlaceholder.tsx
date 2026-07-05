import { GOLD, NAVY_CARD, NAVY_BORDER } from "@/gm/lib/theme";

// Generic "coming soon" tab body for GM sections not yet built (Money, Notes,
// Eligibility). Each gets its real page as its phase lands.
export default function GMPlaceholder({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="space-y-4">
      <div className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: GOLD }}>
        {title}
      </div>
      <div
        className="rounded-lg border px-5 py-8 text-center"
        style={{ borderColor: NAVY_BORDER, backgroundColor: NAVY_CARD }}
      >
        <div className="text-sm font-semibold text-white/80">{title} — coming soon</div>
        <p className="mx-auto mt-2 max-w-lg text-xs leading-relaxed text-white/45">{blurb}</p>
      </div>
    </div>
  );
}
