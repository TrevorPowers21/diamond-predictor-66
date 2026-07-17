import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

/**
 * Currency input that formats "$1,234" while you type WITHOUT the caret jumping
 * to the end when a comma appears. On each keystroke it counts the digits before
 * the caret, reformats, then restores the caret after that same digit — so
 * editing mid-number stays put. Type digits only; the raw number is reported.
 *   onSave   → fires on blur (commit-on-blur inputs)
 *   onChange → fires live on every keystroke (inputs that update immediately)
 */
export function CurrencyInput({ value, onSave, onChange, placeholder = "$0", className }: {
  value: number | null;
  onSave?: (n: number | null) => void;
  onChange?: (n: number | null) => void;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [local, setLocal] = useState<string | null>(null);
  const caret = useRef<number | null>(null);
  // Number committed on blur, held until the parent's value prop catches up.
  const pending = useRef<number | null | undefined>(undefined);
  const display = local != null ? local : value == null ? "" : "$" + Math.round(value).toLocaleString("en-US");

  // Restore the caret after React repaints the reformatted value.
  useLayoutEffect(() => {
    if (caret.current != null && ref.current) {
      ref.current.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  });

  // Once the parent's value prop reflects what we just committed, drop the
  // local edit copy. Holding it until then stops the field from flashing the
  // old number for a beat while the save/refetch is in flight.
  useEffect(() => {
    if (pending.current !== undefined && (value == null ? null : Math.round(value)) === pending.current) {
      pending.current = undefined;
      setLocal(null);
    }
  }, [value]);

  return (
    <Input
      ref={ref}
      value={display}
      inputMode="numeric"
      placeholder={placeholder}
      className={className}
      onChange={(e) => {
        const el = e.currentTarget;
        const digitsBefore = el.value.slice(0, el.selectionStart ?? el.value.length).replace(/[^0-9]/g, "").length;
        const digits = el.value.replace(/[^0-9]/g, "");
        // Group the raw digit string (commas every 3) rather than collapsing
        // through Number() — so deleting the leading digit of e.g. 200,000
        // leaves "00,000" (which you can retype into 300,000) instead of
        // snapping to $0 / empty and wiping the value. onChange/onBlur below
        // still report the clean numeric value, and blur normalizes display.
        const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        const formatted = digits === "" ? "" : "$" + grouped;
        // Caret goes after the same number of digits in the reformatted string.
        let pos = 0, seen = 0;
        while (pos < formatted.length && seen < digitsBefore) { if (/[0-9]/.test(formatted[pos]!)) seen++; pos++; }
        caret.current = pos;
        setLocal(formatted);
        onChange?.(digits === "" ? null : Number(digits));
      }}
      onBlur={() => {
        if (local == null) return;
        const d = local.replace(/[^0-9]/g, "");
        const n = d === "" ? null : Number(d);
        onSave?.(n);
        // If the prop already matches, drop local now; otherwise hold it until
        // the value prop lands (see the effect above) so it doesn't flicker.
        if ((value == null ? null : Math.round(value)) === n) setLocal(null);
        else pending.current = n;
      }}
    />
  );
}
