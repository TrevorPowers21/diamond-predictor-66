import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, ChevronLeft } from "lucide-react";
import type { GmVendor, VendorBucket } from "@/gm/hooks/useGmVendors";

const NEW = "__new_vendor__";

/**
 * Vendor selector backed by the program's stored vendor directory (gm_vendor).
 * Pick an existing vendor to REUSE it — keeps names consistent, no accidental
 * duplicates from re-typing — or choose "New <label>…" to add a brand-new one.
 * Outputs the chosen/typed name; the caller runs ensureVendor(name, bucket) to
 * find-or-create and link vendor_id. If a new name is typed (nothing picked),
 * it saves as a new vendor.
 */
export function VendorPicker({ vendors, bucket, value, onChange, label = "vendor" }: {
  vendors: GmVendor[];
  bucket: VendorBucket;
  value: string;
  onChange: (name: string) => void;
  label?: string;
}) {
  const opts = vendors.filter((v) => v.bucket === bucket);
  const knownNames = new Set(opts.map((v) => v.name));
  // Start typing a new one when there's nothing to pick, or when the current
  // value isn't a stored vendor (e.g. editing an older free-text name).
  const [adding, setAdding] = useState(value.trim() !== "" && !knownNames.has(value));
  const showAdd = adding || opts.length === 0;

  if (showAdd) {
    return (
      <div className="space-y-1">
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={`New ${label} name`} className="h-9 text-sm" autoFocus />
        {opts.length > 0 && (
          <button type="button" onClick={() => { setAdding(false); onChange(""); }}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
            <ChevronLeft className="h-3 w-3" /> pick a saved {label}
          </button>
        )}
      </div>
    );
  }

  return (
    <Select
      value={knownNames.has(value) ? value : ""}
      onValueChange={(v) => { if (v === NEW) { setAdding(true); onChange(""); } else onChange(v); }}
    >
      <SelectTrigger className="h-9 text-sm"><SelectValue placeholder={`Select a ${label}`} /></SelectTrigger>
      <SelectContent>
        {opts.map((v) => <SelectItem key={v.id} value={v.name} className="text-sm">{v.name}</SelectItem>)}
        <SelectItem value={NEW} className="text-sm text-[#D4AF37] focus:text-[#D4AF37]">
          <span className="inline-flex items-center gap-1"><Plus className="h-3 w-3" /> New {label}…</span>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
