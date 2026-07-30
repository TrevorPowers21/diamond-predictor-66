/**
 * Change Active Roster — picks which saved build is LIVE (drives every player's
 * profile, projected WAR / market value, and pay across the whole app). Shared,
 * self-contained: rendered inside the Roster page's "Change Active Roster" dialog
 * AND inline on the central GM Settings → Roster Management tab.
 */
import { useEffect, useState } from "react";
import { useGmRoster } from "@/gm/hooks/useGmRoster";
import { PROJECTION_SEASON } from "@/lib/seasonConstants";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** onApplied lets a dialog host close itself after the change is applied. */
export function ActiveRosterPicker({ onApplied }: { onApplied?: () => void }) {
  const gm = useGmRoster(PROJECTION_SEASON);
  const [pending, setPending] = useState<string>("");
  useEffect(() => { setPending(gm.liveBuildId ?? ""); }, [gm.liveBuildId]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">The <span className="font-semibold text-foreground">active roster</span> is the one build that drives every player's profile, projected WAR / market value, and pay across the whole app. Changing it updates what everyone sees.</p>
      <div className="space-y-1">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Live build</label>
        <Select value={pending} onValueChange={setPending}>
          <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select build" /></SelectTrigger>
          <SelectContent>
            {gm.builds.map((b) => (
              <SelectItem key={b.id} value={b.id} className="text-sm">{b.name}{b.id === gm.liveBuildId ? " · current" : ""}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex justify-end">
        <Button size="sm" disabled={!pending || pending === gm.liveBuildId || gm.isChangingLiveBuild}
          onClick={() => { gm.setLiveBuild(pending); onApplied?.(); }}>
          {gm.isChangingLiveBuild ? "Changing…" : "Change & apply"}
        </Button>
      </div>
    </div>
  );
}
