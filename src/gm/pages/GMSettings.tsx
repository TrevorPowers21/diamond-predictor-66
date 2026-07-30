/**
 * GM Settings — the central web home for per-team editable config, organized by
 * page. Every editor here is a SHARED component also reachable from that page's
 * inline "GM Settings" dropdown, so the central page and the popups can never
 * drift. Roster Management is the default tab; destructive one-shots (Finalize
 * Roster / Pay) stay on the Roster page, not here.
 */
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RosterBudgetSettings } from "@/gm/components/settings/RosterBudgetSettings";
import { ActiveRosterPicker } from "@/gm/components/settings/ActiveRosterPicker";
import { ScoutingGradesEditor } from "@/gm/components/settings/ScoutingGradesEditor";
import { RecruitingBudgetEditor } from "@/gm/components/settings/RecruitingBudgetEditor";

const OSWALD = { fontFamily: "'Oswald', sans-serif" } as const;

function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-[15px] font-bold uppercase tracking-[0.15em]" style={OSWALD}>{title}</h2>
      <p className="text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );
}

export default function GMSettings() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-[22px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>GM Settings</h1>

      <Tabs defaultValue="roster" className="space-y-6">
        <TabsList>
          <TabsTrigger value="roster" style={OSWALD} className="uppercase tracking-wide">Roster Management</TabsTrigger>
          <TabsTrigger value="recruiting" style={OSWALD} className="uppercase tracking-wide">Recruiting Board</TabsTrigger>
        </TabsList>

        {/* ROSTER MANAGEMENT — Season Budget on top, Change Active Roster under it. */}
        <TabsContent value="roster" className="space-y-8">
          <section>
            <SectionHeading title="Season Budget" subtitle="The GM's four allotments (Revenue Share, NIL, Scholarships, Other). Save persists the caps; Finalize &amp; Push to the coach lives on the Roster page." />
            <RosterBudgetSettings />
          </section>
          <section>
            <SectionHeading title="Active Roster" subtitle="Pick which saved build is live — it drives every player's profile, projected WAR / market value, and pay across the app." />
            <div className="rounded-md border border-border/60 bg-card/40 p-4">
              <ActiveRosterPicker />
            </div>
          </section>
        </TabsContent>

        {/* RECRUITING BOARD — Scouting Grades + Recruiting Budget by Class. */}
        <TabsContent value="recruiting" className="space-y-8">
          <section>
            <SectionHeading title="Scouting Grades" subtitle="The grade fields + scale your staff grades recruits on — separate per player type. Coaches inherit these on mobile &amp; the web report." />
            <ScoutingGradesEditor />
          </section>
          <section>
            <SectionHeading title="Recruiting Budget by Class" subtitle="Set the NIL budget target and scholarships available for each recruiting class." />
            <div className="rounded-md border border-border/60 bg-card/40 p-4">
              <RecruitingBudgetEditor />
            </div>
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
