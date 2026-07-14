import { useEffect, useState } from "react";
import type { GmPlayerInfo } from "@/gm/hooks/useGmPlayerInfo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const OSWALD = { fontFamily: "Oswald, sans-serif" } as const;

const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[^0-9.]/g, "")) || null);
const strOrNull = (s: string) => (s.trim() === "" ? null : s.trim());

// The marketability questionnaire — every bucket in one place. Saves the
// per-player pieces (social + university connection) to gm_player_info and the
// program-wide community tier to gm_program_marketability.
export default function MarketabilityDialog({
  open, onOpenChange, playerName, info, programTier, onSave, isSaving,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  playerName: string;
  info: GmPlayerInfo | null;
  programTier: number | null;
  onSave: (playerPatch: Partial<GmPlayerInfo>, programTier: number | null, onDone?: () => void) => void;
  isSaving: boolean;
}) {
  const [f, setF] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    const s = (v: unknown) => (v == null ? "" : String(v));
    setF({
      program_tier: s(programTier),
      instagram_followers: s(info?.instagram_followers),
      twitter_followers: s(info?.twitter_followers),
      tiktok_followers: s(info?.tiktok_followers),
      instagram_handle: s(info?.instagram_handle),
      twitter_handle: s(info?.twitter_handle),
      tiktok_handle: s(info?.tiktok_handle),
      university_connection_tier: s(info?.university_connection_tier) || "none",
      university_connection_note: s(info?.university_connection_note),
    });
  }, [open, info, programTier]);

  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  const save = () => {
    onSave(
      {
        instagram_followers: numOrNull(f.instagram_followers),
        twitter_followers: numOrNull(f.twitter_followers),
        tiktok_followers: numOrNull(f.tiktok_followers),
        instagram_handle: strOrNull(f.instagram_handle),
        twitter_handle: strOrNull(f.twitter_handle),
        tiktok_handle: strOrNull(f.tiktok_handle),
        university_connection_tier: f.university_connection_tier && f.university_connection_tier !== "none" ? f.university_connection_tier : null,
        university_connection_note: strOrNull(f.university_connection_note),
      },
      f.program_tier ? Number(f.program_tier) : null,
      () => onOpenChange(false),
    );
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
        <DialogHeader><DialogTitle style={OSWALD}>Edit Marketability — {playerName}</DialogTitle></DialogHeader>

        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Program &amp; Community</div>
        {field("Community tier (applies to your whole program)", (
          <Select value={f.program_tier || undefined} onValueChange={(v) => set("program_tier", v)}>
            <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Set your program's tier" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="5" className="text-sm">Elite — rabid fanbase / community</SelectItem>
              <SelectItem value="4" className="text-sm">Strong — big brand or state pull</SelectItem>
              <SelectItem value="3" className="text-sm">Solid — regional draw</SelectItem>
              <SelectItem value="2" className="text-sm">Modest</SelectItem>
              <SelectItem value="1" className="text-sm">Minimal — low following</SelectItem>
            </SelectContent>
          </Select>
        ))}

        <div className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Social Following</div>
        <div className="grid grid-cols-2 gap-3">
          {field("Instagram followers", text("instagram_followers", "followers"))}
          {field("Instagram handle", text("instagram_handle", "@handle"))}
          {field("X / Twitter followers", text("twitter_followers", "followers"))}
          {field("X / Twitter handle", text("twitter_handle", "@handle"))}
          {field("TikTok followers", text("tiktok_followers", "followers"))}
          {field("TikTok handle", text("tiktok_handle", "@handle"))}
        </div>

        <div className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">University Connection</div>
        {field("Tie to the school", (
          <Select value={f.university_connection_tier || "none"} onValueChange={(v) => set("university_connection_tier", v)}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none" className="text-sm">None</SelectItem>
              <SelectItem value="local" className="text-sm">In-state / local hometown</SelectItem>
              <SelectItem value="family_alum" className="text-sm">Immediate family alum</SelectItem>
              <SelectItem value="family_notable" className="text-sm">Family notable athlete / figure (school or in-state)</SelectItem>
            </SelectContent>
          </Select>
        ))}
        {field("Detail", text("university_connection_note", "e.g. aunt = UGA basketball star"))}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={isSaving} onClick={save}>{isSaving ? "Saving…" : "Save Marketability"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
