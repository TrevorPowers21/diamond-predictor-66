import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Check, Plus } from "lucide-react";
import type { GmVendor, VendorBucket } from "@/gm/hooks/useGmVendors";

/**
 * Vendor combobox backed by the program's stored vendor directory (gm_vendor).
 * It is a SEARCH field first: type to filter your saved vendors and click one
 * to reuse it (keeps names consistent — no duplicates). If you don't pick an
 * existing match, whatever you typed is saved as a NEW vendor on Save. Outputs
 * the chosen/typed name; the caller runs ensureVendor(name, bucket) to
 * find-or-create and link vendor_id.
 */
export function VendorPicker({ vendors, bucket, value, onChange, label = "vendor" }: {
  vendors: GmVendor[];
  bucket: VendorBucket;
  value: string;
  onChange: (name: string) => void;
  label?: string;
}) {
  const opts = vendors.filter((v) => v.bucket === bucket);
  const [open, setOpen] = useState(false);
  const q = value.trim().toLowerCase();
  const matches = q ? opts.filter((v) => v.name.toLowerCase().includes(q)) : opts;
  const exact = opts.some((v) => v.name.toLowerCase() === q);
  const showList = open && (matches.length > 0 || (q.length > 0 && !exact));

  return (
    <div className="relative">
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        // delay so a suggestion click (mousedown) registers before we close
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder={`Search or add a ${label}`}
        className="h-9 text-sm"
        autoComplete="off"
      />
      {showList && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-56 overflow-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
          {matches.map((v) => {
            const picked = v.name.toLowerCase() === q;
            return (
              <button
                key={v.id}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); onChange(v.name); setOpen(false); }}
                className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <span className="truncate">{v.name}</span>
                {picked && <Check className="h-3.5 w-3.5 shrink-0 text-[#D4AF37]" />}
              </button>
            );
          })}
          {q.length > 0 && !exact && (
            <div className="flex items-center gap-1.5 border-t border-border/60 px-2 py-1.5 text-[11px] text-muted-foreground">
              <Plus className="h-3 w-3 text-[#D4AF37]" />
              <span>Save to add <span className="font-medium text-foreground">“{value.trim()}”</span> as a new {label}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
