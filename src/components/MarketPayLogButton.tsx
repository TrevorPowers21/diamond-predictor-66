import { useEffect, useMemo, useState } from "react";
import { DollarSign, Pencil, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useMarketPayLog, type MarketPayLogRow } from "@/hooks/useMarketPayLog";
import { CURRENT_SEASON, PROJECTION_SEASON } from "@/lib/seasonConstants";

interface MarketPayLogButtonProps {
  playerId: string | null | undefined;
}

const SEASON_OPTIONS = [
  PROJECTION_SEASON,
  CURRENT_SEASON,
  CURRENT_SEASON - 1,
];

const formatDollarsDisplay = (n: number | null | undefined): string =>
  n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`;

/**
 * Live-format the typed amount as "$50,000" / "$1,234,567". Strips any
 * non-digit, then re-inserts thousands commas and the leading $. Returns
 * `""` for empty input so the field can be blanked.
 */
const formatAmountInput = (raw: string): string => {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return "";
  const n = Number(digits);
  if (!Number.isFinite(n)) return "";
  return `$${n.toLocaleString("en-US")}`;
};

const parseAmountInput = (formatted: string): number | null => {
  const digits = formatted.replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
};

export function MarketPayLogButton({ playerId }: MarketPayLogButtonProps) {
  const { isSuperadmin } = useAuth();
  const { featureEnabled, entries, isLoading, upsert, isSaving, remove } =
    useMarketPayLog(playerId);

  const [open, setOpen] = useState(false);
  const [season, setSeason] = useState<number>(PROJECTION_SEASON);
  const [amountStr, setAmountStr] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  const existingForSeason = useMemo(
    () => entries.find((e) => e.season === season) ?? null,
    [entries, season],
  );

  // Pre-fill form from existing entry when popover opens or season changes.
  useEffect(() => {
    if (!open) return;
    setAmountStr(formatAmountInput(String(existingForSeason?.market_pay_amount ?? "")));
    setNotes(existingForSeason?.notes ?? "");
  }, [open, season, existingForSeason]);

  if (!playerId) return null;
  if (!featureEnabled && !isSuperadmin) return null;

  const handleSave = async () => {
    await upsert({
      season,
      amount: parseAmountInput(amountStr),
      notes: notes.trim() || null,
    });
    setOpen(false);
  };

  const handleDelete = async (row: MarketPayLogRow) => {
    await remove(row.id);
  };

  const isEmpty = !amountStr && !notes.trim();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider cursor-pointer transition-colors duration-200 bg-[#0D1B3E] text-[#D4AF37] hover:brightness-110"
        >
          <DollarSign className="w-2.5 h-2.5" />
          Market Pay
          <Pencil className="w-2.5 h-2.5 opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[280px] p-0 overflow-hidden border-l-[3px] border-l-[#D4AF37]"
      >
        <div className="bg-[#0D1B3E] px-4 py-2.5">
          <span
            className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#D4AF37]"
            style={{ fontFamily: "Oswald, sans-serif" }}
          >
            Market Pay Log
          </span>
        </div>

        <div className="px-4 py-3 space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Season
            </Label>
            <Select value={String(season)} onValueChange={(v) => setSeason(Number(v))}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEASON_OPTIONS.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Reported pay
            </Label>
            <Input
              type="text"
              inputMode="numeric"
              placeholder="$50,000"
              value={amountStr}
              onChange={(e) => setAmountStr(formatAmountInput(e.target.value))}
              className="h-8 text-xs font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Notes
            </Label>
            <Textarea
              placeholder="Hearsay context — source, school, terms…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="text-xs resize-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              className="h-7 text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaving || isEmpty}
              className="h-7 text-xs bg-[#D4AF37] text-[#070e1f] hover:bg-[#A08820]"
            >
              {isSaving ? "Saving…" : existingForSeason ? "Update" : "Save"}
            </Button>
          </div>
        </div>

        {entries.length > 0 && (
          <div className="border-t border-border bg-muted/30 px-4 py-2.5 space-y-1.5 max-h-[200px] overflow-y-auto">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Logged Entries
            </Label>
            {isLoading && (
              <p className="text-[11px] text-muted-foreground">Loading…</p>
            )}
            {entries.map((row) => (
              <div
                key={row.id}
                className="flex items-start justify-between gap-2 rounded border border-border/50 bg-background px-2 py-1.5"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[11px] font-semibold">{row.season}</span>
                    <span className="text-[11px] font-mono">
                      {formatDollarsDisplay(row.market_pay_amount)}
                    </span>
                  </div>
                  {row.notes && (
                    <p className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">
                      {row.notes}
                    </p>
                  )}
                  <p className="text-[9px] text-muted-foreground/70 mt-0.5">
                    Updated {new Date(row.updated_at).toLocaleDateString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(row)}
                  className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                  aria-label="Delete entry"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
