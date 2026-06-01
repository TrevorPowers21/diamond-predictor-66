import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Player = {
  from_team?: string | null;
  transfer_portal?: boolean | null;
  [k: string]: any;
};

type Prediction = {
  model_type: string | null;
  [k: string]: any;
};

/**
 * Encapsulates transfer portal state derivation and the lazy fromTeam query.
 * Replaces scattered isTransferPortal/isReturner/fromTeamData logic in PlayerProfile.
 */
export function useTransferPortalContext(
  player: Player | null | undefined,
  predictions: Prediction[],
  effectiveTeamId: string | null,
) {
  // A player is "in the portal" as soon as their players.transfer_portal flag
  // is set OR the dashboard portal feed picks them up via portal_status. The
  // old check ALSO required a transfer-model prediction, but the precompute
  // doesn't fire instantly for new portal entries — so freshly imported
  // portal players had transfer_portal=true but no transfer prediction yet,
  // and the dual-team cards never rendered.
  const portalStatus = (player as any)?.portal_status as string | null | undefined;
  const isTransferPortal = !!(
    player?.transfer_portal ||
    portalStatus === "IN PORTAL" ||
    portalStatus === "COMMITTED"
  );
  const isReturner = predictions.some((p) => p.model_type === "returner");

  const { data: fromTeamData } = useQuery({
    queryKey: ["from-team-conference", player?.from_team, effectiveTeamId],
    queryFn: async () => {
      const fromTeam = player!.from_team!;
      const unknownMatch = fromTeam.match(/^Unknown \((.+)\)$/);
      if (unknownMatch) return { conference: unknownMatch[1] };
      let { data } = await supabase
        .from("Teams Table")
        .select("conference")
        .eq("full_name", fromTeam)
        .maybeSingle();
      if (data) return data;
      const { data: byAbbr } = await supabase
        .from("Teams Table")
        .select("conference")
        .eq("abbreviation", fromTeam)
        .maybeSingle();
      if (byAbbr) return byAbbr;
      const { data: fuzzy } = await supabase
        .from("Teams Table")
        .select("conference")
        .ilike("full_name", `%${fromTeam}%`)
        .limit(1)
        .maybeSingle();
      return fuzzy;
    },
    enabled: !!player?.from_team && !!isTransferPortal,
  });

  return { isTransferPortal, isReturner, fromTeamData };
}
