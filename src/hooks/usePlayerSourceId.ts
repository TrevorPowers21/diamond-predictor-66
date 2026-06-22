import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Resolves a URL :id (which is normally `players.id` UUID, but historically
 * could also be a raw `source_player_id` for legacy-only players) into the
 * canonical `source_player_id` text used by the pitch log aggregation tables.
 *
 * Returns:
 *   - source_player_id when found
 *   - null when player exists but has no source_player_id (untracked / D2 etc.)
 *   - undefined while loading
 */
export interface PlayerSourceIdResult {
  sourcePlayerId: string | null;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  teamId: string | null;
  schoolName: string | null;
  conference: string | null;
  portalStatus: string | null;
  isPitcher: boolean;
  isTwp: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function usePlayerSourceId(id: string | undefined) {
  return useQuery({
    queryKey: ["player-source-id", id],
    enabled: !!id,
    queryFn: async (): Promise<PlayerSourceIdResult | null> => {
      if (!id) return null;
      const lookupColumn = UUID_RE.test(id) ? "id" : "source_player_id";
      const { data, error } = await supabase
        .from("players")
        .select(
          "source_player_id, first_name, last_name, position, team_id, is_twp, portal_status, team, conference",
        )
        .eq(lookupColumn, id)
        .maybeSingle();
      if (error || !data) return null;
      const pos = (data as any).position as string | null;
      const isPitcher = !!pos && /^(P|SP|RP|RHP|LHP|CL)$/i.test(pos);

      // School name preference: join Teams Table if team_id present;
      // fall back to denormalized players.team text column.
      let schoolName = (data as any).team ?? null;
      const teamId = (data as any).team_id ?? null;
      if (teamId) {
        const { data: teamRow } = await supabase
          .from("Teams Table")
          .select("abbreviation, Conference")
          .eq("team_id", teamId)
          .maybeSingle();
        if (teamRow?.abbreviation) schoolName = teamRow.abbreviation;
      }

      // Conference: players.conference is the cheap lookup. When it's null
      // (most legacy rows), fall back to Hitter/Pitching Master's most recent
      // season's Conference column, which is reliably populated by the
      // master-table imports.
      let conference = (data as any).conference ?? null;
      const sourceId = (data as any).source_player_id ?? null;
      if (!conference && sourceId) {
        const tbl = isPitcher ? "Pitching Master" : "Hitter Master";
        const { data: mRow } = await (supabase as any)
          .from(tbl)
          .select("Conference")
          .eq("source_player_id", sourceId)
          .not("Conference", "is", null)
          .order("Season", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (mRow?.Conference) conference = mRow.Conference;
      }

      return {
        sourcePlayerId: sourceId,
        firstName: (data as any).first_name ?? null,
        lastName: (data as any).last_name ?? null,
        position: pos,
        teamId,
        schoolName,
        conference,
        portalStatus: (data as any).portal_status ?? null,
        isPitcher,
        isTwp: !!(data as any).is_twp,
      };
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
