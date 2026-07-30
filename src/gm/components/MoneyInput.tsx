/**
 * Dollar text input with live `$` + comma formatting. Stores the formatted
 * string; `parseMoney()` strips it back to a number on save. Shared by the
 * recruiting budget editor and GMRecruits (was duplicated in-page).
 */
import { Input } from "@/components/ui/input";

export const parseMoney = (s: string): number | null => {
  const t = s.replace(/[^0-9.]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isNaN(n) ? null : n;
};

export const fmtMoneyInput = (s: string): string => {
  const d = String(s).replace(/[^0-9]/g, "");
  return d ? `$${Number(d).toLocaleString()}` : "";
};

export function MoneyInput({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return <Input value={fmtMoneyInput(value)} onChange={(e) => onChange(fmtMoneyInput(e.target.value))} placeholder={placeholder} inputMode="numeric" className={className} />;
}
