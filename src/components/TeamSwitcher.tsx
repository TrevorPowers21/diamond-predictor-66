import { useAuth } from "@/hooks/useAuth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const CROSS_TEAM_VALUE = "__cross_team__";

export default function TeamSwitcher({ className = "" }: { className?: string }) {
  const { isSuperadmin, availableTeams, impersonatedTeamId, impersonateTeam, userTeamId } = useAuth();

  // Non-superadmins don't get a switcher — they're locked to their own team.
  if (!isSuperadmin) return null;

  const value = impersonatedTeamId ?? CROSS_TEAM_VALUE;
  const isImpersonating = impersonatedTeamId !== null;

  const handleChange = (next: string) => {
    impersonateTeam(next === CROSS_TEAM_VALUE ? null : next);
  };

  return (
    <Select value={value} onValueChange={handleChange}>
      <SelectTrigger
        className={cn(
          "h-8 min-w-[180px] text-xs gap-2",
          isImpersonating && "border-[#D4AF37]/60 bg-[#D4AF37]/8 text-[#D4AF37]",
          className,
        )}
        aria-label="Switch customer team"
      >
        {isImpersonating && (
          <span className="text-[9px] uppercase tracking-[0.15em] text-[#D4AF37]/80 font-semibold">Viewing as</span>
        )}
        <SelectValue placeholder="Cross-team view" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={CROSS_TEAM_VALUE} className="text-xs">
          Cross-team view (no impersonation)
        </SelectItem>
        {availableTeams.length > 0 && (
          <div className="px-2 pt-2 pb-1 text-[9px] uppercase tracking-[0.15em] text-muted-foreground/70">
            Customer teams
          </div>
        )}
        {availableTeams.map((team) => (
          <SelectItem key={team.id} value={team.id} className="text-xs">
            {team.name}
            {team.id === userTeamId && (
              <span className="ml-2 text-[9px] uppercase tracking-wider text-muted-foreground/60">your team</span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
