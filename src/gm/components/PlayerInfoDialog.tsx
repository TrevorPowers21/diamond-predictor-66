import { useEffect, useState } from "react";
import type { GmPlayerInfo } from "@/gm/hooks/useGmPlayerInfo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const OSWALD = { fontFamily: "Oswald, sans-serif" } as const;

// Scraped fallbacks (from the players record) shown as placeholders when the
// program hasn't entered its own value.
export interface InfoScraped {
  bats?: string | null;
  throws?: string | null;
  height_inches?: number | null;
  weight_lbs?: number | null;
  hometown?: string | null;
  high_school?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
}

const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[^0-9.]/g, "")) || null);
const strOrNull = (s: string) => (s.trim() === "" ? null : s.trim());

export default function PlayerInfoDialog({
  open, onOpenChange, playerName, info, scraped, draftYearDefault, eligRemainingDefault, onSave, isSaving,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  playerName: string;
  info: GmPlayerInfo | null;
  scraped: InfoScraped;
  draftYearDefault: number | null;
  eligRemainingDefault: number | null;
  onSave: (patch: Partial<GmPlayerInfo>, onDone?: () => void) => void;
  isSaving: boolean;
}) {
  const [f, setF] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    const s = (v: unknown) => (v == null ? "" : String(v));
    setF({
      jersey_number: s(info?.jersey_number),
      draft_eligible_year: s(info?.draft_eligible_year),
      eligibility_remaining: s(info?.eligibility_remaining),
      dob: s(info?.dob),
      bats: s(info?.bats ?? scraped.bats),
      throws: s(info?.throws ?? scraped.throws),
      height_inches: s(info?.height_inches ?? scraped.height_inches),
      weight_lbs: s(info?.weight_lbs ?? scraped.weight_lbs),
      hometown: s(info?.hometown ?? scraped.hometown),
      high_school: s(info?.high_school ?? scraped.high_school),
      contact_phone: s(info?.contact_phone ?? scraped.contact_phone),
      contact_email: s(info?.contact_email ?? scraped.contact_email),
      instagram_followers: s(info?.instagram_followers),
      twitter_followers: s(info?.twitter_followers),
      tiktok_followers: s(info?.tiktok_followers),
    });
  }, [open, info, scraped]);

  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  const save = () => {
    onSave({
      jersey_number: strOrNull(f.jersey_number),
      draft_eligible_year: numOrNull(f.draft_eligible_year),
      eligibility_remaining: numOrNull(f.eligibility_remaining),
      dob: strOrNull(f.dob),
      bats: strOrNull(f.bats),
      throws: strOrNull(f.throws),
      height_inches: numOrNull(f.height_inches),
      weight_lbs: numOrNull(f.weight_lbs),
      hometown: strOrNull(f.hometown),
      high_school: strOrNull(f.high_school),
      contact_phone: strOrNull(f.contact_phone),
      contact_email: strOrNull(f.contact_email),
      instagram_followers: numOrNull(f.instagram_followers),
      twitter_followers: numOrNull(f.twitter_followers),
      tiktok_followers: numOrNull(f.tiktok_followers),
    }, () => onOpenChange(false));
  };

  const field = (label: string, node: React.ReactNode) => (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
      {node}
    </div>
  );
  const text = (k: string, ph = "") => <Input value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} placeholder={ph} className="h-9 text-sm" />;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-md overflow-y-auto">
        <DialogHeader><DialogTitle style={OSWALD}>Edit Player Info — {playerName}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {field("Jersey #", text("jersey_number", "e.g. 12"))}
          {field("Birthday", <Input type="date" value={f.dob ?? ""} onChange={(e) => set("dob", e.target.value)} className="h-9 text-sm" />)}
          {field("Draft Eligible Year", text("draft_eligible_year", draftYearDefault ? String(draftYearDefault) : "e.g. 2026"))}
          {field("Eligibility Remaining (yrs)", text("eligibility_remaining", eligRemainingDefault != null ? String(eligRemainingDefault) : "e.g. 2"))}
          {field("Bats", (
            <Select value={f.bats || undefined} onValueChange={(v) => set("bats", v)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{["L", "R", "S"].map((x) => <SelectItem key={x} value={x} className="text-sm">{x}</SelectItem>)}</SelectContent>
            </Select>
          ))}
          {field("Throws", (
            <Select value={f.throws || undefined} onValueChange={(v) => set("throws", v)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{["L", "R"].map((x) => <SelectItem key={x} value={x} className="text-sm">{x}</SelectItem>)}</SelectContent>
            </Select>
          ))}
          {field("Height (in)", text("height_inches", "e.g. 74"))}
          {field("Weight (lbs)", text("weight_lbs", "e.g. 195"))}
          <div className="col-span-2">{field("Hometown", text("hometown", "City, ST"))}</div>
          <div className="col-span-2">{field("High School", text("high_school"))}</div>
          {field("Phone", text("contact_phone"))}
          {field("Email", text("contact_email"))}
          <div className="col-span-2 mt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Social Following</div>
          {field("Instagram", text("instagram_followers", "followers"))}
          {field("X / Twitter", text("twitter_followers", "followers"))}
          {field("TikTok", text("tiktok_followers", "followers"))}
        </div>
        <p className="text-[10px] text-muted-foreground">Draft eligibility auto-fills from class/birthday when blank; type a year to override. GPA &amp; academics coming later.</p>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={isSaving} onClick={save}>{isSaving ? "Saving…" : "Save Info"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
