import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

// ─── Row types for new master tables ───────────────────────────────────
export type ConferenceNameRow = Tables<"Conference Names">;
export type ConferenceStatsRow = Tables<"Conference Stats">;
export type TeamsTableRow = Tables<"Teams Table">;
export type ParkFactorsRow = Tables<"Park Factors">;
export type HitterMasterRow = Tables<"Hitter Master">;
export type PitchingMasterRow = Tables<"Pitching Master">;
export type EquationWeightsRow = Tables<"Equation Weights">;

// ─── Conference Names ──────────────────────────────────────────────────
export async function fetchConferenceNames(): Promise<ConferenceNameRow[]> {
  const { data, error } = await supabase
    .from("Conference Names")
    .select("*")
    .order("conference abbreviation");
  if (error) throw error;
  return data ?? [];
}

export async function fetchConferenceById(id: string): Promise<ConferenceNameRow | null> {
  const { data, error } = await supabase
    .from("Conference Names")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ─── Conference Stats ──────────────────────────────────────────────────
export async function fetchConferenceStats(season?: number): Promise<ConferenceStatsRow[]> {
  let query = supabase.from("Conference Stats").select("*");
  if (season != null) query = query.eq("season", season);
  const { data, error } = await query.order("conference abbreviation");
  if (error) throw error;
  return data ?? [];
}

export async function fetchConferenceStatsByConferenceId(
  conferenceId: string,
  season?: number
): Promise<ConferenceStatsRow | null> {
  let query = supabase
    .from("Conference Stats")
    .select("*")
    .eq("conference_id", conferenceId);
  if (season != null) query = query.eq("season", season);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

// ─── Teams Table ───────────────────────────────────────────────────────
// NOTE: the underlying column in Postgres is "Season" (capital S). The TS types
// show lowercase `season` which is stale — casting through `any` so the filter
// actually applies the correct column name without TypeScript fighting us.
export async function fetchTeamsTable(season?: number): Promise<TeamsTableRow[]> {
  let query: any = supabase.from("Teams Table").select("*");
  if (season != null) query = query.eq("Season", season);
  const { data, error } = await query.order("full_name");
  if (error) throw error;
  return (data ?? []) as TeamsTableRow[];
}

export async function fetchTeamById(id: string): Promise<TeamsTableRow | null> {
  const { data, error } = await supabase
    .from("Teams Table")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchTeamBySourceId(sourceId: string): Promise<TeamsTableRow | null> {
  const { data, error } = await supabase
    .from("Teams Table")
    .select("*")
    .eq("source_id", sourceId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ─── Park Factors ──────────────────────────────────────────────────────
export async function fetchParkFactors(season?: number): Promise<ParkFactorsRow[]> {
  let query = supabase.from("Park Factors").select("*");
  if (season != null) query = query.eq("season", season);
  const { data, error } = await query.order("team_name");
  if (error) throw error;
  return data ?? [];
}

export async function fetchParkFactorsByTeamId(
  teamId: string,
  season?: number
): Promise<ParkFactorsRow | null> {
  let query = supabase
    .from("Park Factors")
    .select("*")
    .eq("team_id", teamId);
  if (season != null) query = query.eq("season", season);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

// ─── Hitter Master ─────────────────────────────────────────────────────
export async function fetchHitterMaster(season?: number): Promise<HitterMasterRow[]> {
  let query = supabase.from("Hitter Master").select("*");
  if (season != null) query = query.eq("Season", season);
  const { data, error } = await query.order("playerFullName");
  if (error) throw error;
  return data ?? [];
}

export async function fetchHittersByTeamId(
  teamId: string,
  season?: number
): Promise<HitterMasterRow[]> {
  let query = supabase
    .from("Hitter Master")
    .select("*")
    .eq("TeamID", teamId);
  if (season != null) query = query.eq("Season", season);
  const { data, error } = await query.order("playerFullName");
  if (error) throw error;
  return data ?? [];
}

export async function fetchHitterBySourceId(
  sourcePlayerId: string,
  season?: number
): Promise<HitterMasterRow | null> {
  let query = supabase
    .from("Hitter Master")
    .select("*")
    .eq("source_player_id", sourcePlayerId);
  if (season != null) query = query.eq("Season", season);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

// ─── Pitching Master ───────────────────────────────────────────────────
export async function fetchPitchingMaster(season?: number): Promise<PitchingMasterRow[]> {
  let query = supabase.from("Pitching Master").select("*");
  if (season != null) query = query.eq("Season", season);
  const { data, error } = await query.order("playerFullName");
  if (error) throw error;
  return data ?? [];
}

export async function fetchPitchersByTeamId(
  teamId: string,
  season?: number
): Promise<PitchingMasterRow[]> {
  let query = supabase
    .from("Pitching Master")
    .select("*")
    .eq("TeamID", teamId);
  if (season != null) query = query.eq("Season", season);
  const { data, error } = await query.order("playerFullName");
  if (error) throw error;
  return data ?? [];
}

export async function fetchPitcherBySourceId(
  sourcePlayerId: string,
  season?: number
): Promise<PitchingMasterRow | null> {
  let query = supabase
    .from("Pitching Master")
    .select("*")
    .eq("source_player_id", sourcePlayerId);
  if (season != null) query = query.eq("Season", season);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

// ─── Equation Weights ──────────────────────────────────────────────────
export async function fetchEquationWeights(
  category?: string,
  season?: number
): Promise<EquationWeightsRow[]> {
  let query = supabase.from("Equation Weights").select("*");
  if (category != null) query = query.eq("Category", category);
  if (season != null) query = query.eq("Season", season);
  const { data, error } = await query.order("Name");
  if (error) throw error;
  return data ?? [];
}

export async function fetchEquationWeightsByEquation(
  equation: string,
  season?: number
): Promise<EquationWeightsRow[]> {
  let query = supabase
    .from("Equation Weights")
    .select("*")
    .eq("Equation", equation);
  if (season != null) query = query.eq("Season", season);
  const { data, error } = await query.order("Name");
  if (error) throw error;
  return data ?? [];
}

// ─── TeamLookup: UUID-based lookup indexed by name and UUID ────────────
export class TeamLookup {
  private byId: Map<string, TeamsTableRow> = new Map();
  private byName: Map<string, TeamsTableRow> = new Map();
  private bySourceId: Map<string, TeamsTableRow> = new Map();
  private byAbbreviation: Map<string, TeamsTableRow> = new Map();

  constructor(teams: TeamsTableRow[]) {
    for (const team of teams) {
      this.byId.set(team.id, team);
      this.byName.set(team.full_name.toLowerCase(), team);
      if (team.source_id) this.bySourceId.set(team.source_id, team);
      if (team.abbreviation) this.byAbbreviation.set(team.abbreviation.toLowerCase(), team);
    }
  }

  getById(id: string): TeamsTableRow | undefined {
    return this.byId.get(id);
  }

  getByName(name: string): TeamsTableRow | undefined {
    return this.byName.get(name.toLowerCase());
  }

  getBySourceId(sourceId: string): TeamsTableRow | undefined {
    return this.bySourceId.get(sourceId);
  }

  getByAbbreviation(abbr: string): TeamsTableRow | undefined {
    return this.byAbbreviation.get(abbr.toLowerCase());
  }

  /** Resolve a team by UUID first, then source_id, then name */
  resolve(identifier: string): TeamsTableRow | undefined {
    return (
      this.byId.get(identifier) ??
      this.bySourceId.get(identifier) ??
      this.byName.get(identifier.toLowerCase()) ??
      this.byAbbreviation.get(identifier.toLowerCase())
    );
  }

  all(): TeamsTableRow[] {
    return Array.from(this.byId.values());
  }
}

/** Build a TeamLookup for a given season (fetches from Supabase) */
export async function buildTeamLookup(season?: number): Promise<TeamLookup> {
  const teams = await fetchTeamsTable(season);
  return new TeamLookup(teams);
}

// ─── ConferenceLookup: UUID-based conference resolution ────────────────
export class ConferenceLookup {
  private byId: Map<string, ConferenceNameRow> = new Map();
  private byAbbr: Map<string, ConferenceNameRow> = new Map();

  constructor(conferences: ConferenceNameRow[]) {
    for (const conf of conferences) {
      this.byId.set(conf.id, conf);
      this.byAbbr.set(conf["conference abbreviation"].toLowerCase(), conf);
    }
  }

  getById(id: string): ConferenceNameRow | undefined {
    return this.byId.get(id);
  }

  getByAbbreviation(abbr: string): ConferenceNameRow | undefined {
    return this.byAbbr.get(abbr.toLowerCase());
  }

  resolve(identifier: string): ConferenceNameRow | undefined {
    return this.byId.get(identifier) ?? this.byAbbr.get(identifier.toLowerCase());
  }

  all(): ConferenceNameRow[] {
    return Array.from(this.byId.values());
  }
}

export async function buildConferenceLookup(): Promise<ConferenceLookup> {
  const conferences = await fetchConferenceNames();
  return new ConferenceLookup(conferences);
}
