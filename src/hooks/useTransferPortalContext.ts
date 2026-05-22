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
  const isTransferPortal = !!(
    player?.transfer_portal && predictions.some((p) => p.model_type === "transfer")
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
