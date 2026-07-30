/**
 * Small budget-UI primitives shared by the GM Roster page and the Season Budget
 * settings editor (was defined inline in GMRoster). Kept together so the roster
 * dialog and the central GM Settings page render identical inputs/labels.
 */
import { type CSSProperties, type ReactNode } from "react";
import { CurrencyInput } from "@/components/CurrencyInput";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Whole-dollar display formatter. */
export const money = (n: number | null | undefined) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US"));

/** A label with an on-hover tooltip (falls back to a plain span when no hint). */
export function HintLabel({ hint, className, style, children }: { hint?: string; className?: string; style?: CSSProperties; children: ReactNode }) {
  if (!hint) return <span className={className} style={style}>{children}</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn(className, "cursor-help")} style={style}>{children}</span>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

/** The GM's dollar allotment input (revenue / NIL / other / scholarship $). */
export function DollarInput({ value, onChange }: { value: number | null; onChange: (n: number | null) => void }) {
  return <CurrencyInput value={value} onChange={onChange} placeholder="$0" className="h-8 w-36 text-right text-sm font-mono tabular-nums" />;
}
