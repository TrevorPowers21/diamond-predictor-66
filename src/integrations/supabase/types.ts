export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      coach_notes: {
        Row: {
          content: string
          created_at: string | null
          customer_team_id: string | null
          id: string
          player_id: string
          tag: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          customer_team_id?: string | null
          id?: string
          player_id: string
          tag?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          customer_team_id?: string | null
          id?: string
          player_id?: string
          tag?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_notes_customer_team_id_fkey"
            columns: ["customer_team_id"]
            isOneToOne: false
            referencedRelation: "customer_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_notes_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      "Conference Names": {
        Row: {
          "conference abbreviation": string | null
          id: string
          name: string
        }
        Insert: {
          "conference abbreviation"?: string | null
          id?: string
          name: string
        }
        Update: {
          "conference abbreviation"?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      "Conference Stats": {
        Row: {
          AVG: number | null
          ba_plus: number | null
          BB9: number | null
          "conference abbreviation": string | null
          conference_id: string | null
          ERA: number | null
          FIP: number | null
          hitter_avg_ev: number | null
          hitter_avg_ev_score: number | null
          hitter_barrel_pct: number | null
          hitter_barrel_score: number | null
          hitter_bb_pct: number | null
          hitter_bb_score: number | null
          hitter_chase_pct: number | null
          hitter_chase_score: number | null
          hitter_contact_pct: number | null
          hitter_contact_score: number | null
          hitter_ev90: number | null
          hitter_ev90_score: number | null
          hitter_gb_pct: number | null
          hitter_gb_score: number | null
          hitter_la_10_30_pct: number | null
          hitter_la_score: number | null
          hitter_line_drive_pct: number | null
          hitter_line_drive_score: number | null
          hitter_pop_up_pct: number | null
          hitter_pop_up_score: number | null
          hitter_pull_pct: number | null
          hitter_pull_score: number | null
          HR9: number | null
          ISO: number | null
          iso_plus: number | null
          K9: number | null
          OBP: number | null
          obp_plus: number | null
          offensive_power_rating: number | null
          OPS: number | null
          Overall_Power_Rating: number | null
          pitcher_barrel_pct: number | null
          pitcher_barrel_score: number | null
          pitcher_bb_pct: number | null
          pitcher_bb_score: number | null
          pitcher_chase_pct: number | null
          pitcher_chase_score: number | null
          pitcher_ev_score: number | null
          pitcher_ev90: number | null
          pitcher_ev90_score: number | null
          pitcher_exit_velo: number | null
          pitcher_gb_score: number | null
          pitcher_ground_pct: number | null
          pitcher_hard_hit_pct: number | null
          pitcher_hh_score: number | null
          pitcher_in_zone_pct: number | null
          pitcher_iz_score: number | null
          pitcher_iz_whiff_pct: number | null
          pitcher_iz_whiff_score: number | null
          pitcher_la_10_30_pct: number | null
          pitcher_la_score: number | null
          pitcher_ld_score: number | null
          pitcher_line_drive_pct: number | null
          pitcher_pull_pct: number | null
          pitcher_pull_score: number | null
          pitcher_whiff_pct: number | null
          pitcher_whiff_score: number | null
          season: number | null
          SLG: number | null
          Stuff_plus: number | null
          WHIP: number | null
          WRC_plus: number | null
        }
        Insert: {
          AVG?: number | null
          ba_plus?: number | null
          BB9?: number | null
          "conference abbreviation"?: string | null
          conference_id?: string | null
          ERA?: number | null
          FIP?: number | null
          hitter_avg_ev?: number | null
          hitter_avg_ev_score?: number | null
          hitter_barrel_pct?: number | null
          hitter_barrel_score?: number | null
          hitter_bb_pct?: number | null
          hitter_bb_score?: number | null
          hitter_chase_pct?: number | null
          hitter_chase_score?: number | null
          hitter_contact_pct?: number | null
          hitter_contact_score?: number | null
          hitter_ev90?: number | null
          hitter_ev90_score?: number | null
          hitter_gb_pct?: number | null
          hitter_gb_score?: number | null
          hitter_la_10_30_pct?: number | null
          hitter_la_score?: number | null
          hitter_line_drive_pct?: number | null
          hitter_line_drive_score?: number | null
          hitter_pop_up_pct?: number | null
          hitter_pop_up_score?: number | null
          hitter_pull_pct?: number | null
          hitter_pull_score?: number | null
          HR9?: number | null
          ISO?: number | null
          iso_plus?: number | null
          K9?: number | null
          OBP?: number | null
          obp_plus?: number | null
          offensive_power_rating?: number | null
          OPS?: number | null
          Overall_Power_Rating?: number | null
          pitcher_barrel_pct?: number | null
          pitcher_barrel_score?: number | null
          pitcher_bb_pct?: number | null
          pitcher_bb_score?: number | null
          pitcher_chase_pct?: number | null
          pitcher_chase_score?: number | null
          pitcher_ev_score?: number | null
          pitcher_ev90?: number | null
          pitcher_ev90_score?: number | null
          pitcher_exit_velo?: number | null
          pitcher_gb_score?: number | null
          pitcher_ground_pct?: number | null
          pitcher_hard_hit_pct?: number | null
          pitcher_hh_score?: number | null
          pitcher_in_zone_pct?: number | null
          pitcher_iz_score?: number | null
          pitcher_iz_whiff_pct?: number | null
          pitcher_iz_whiff_score?: number | null
          pitcher_la_10_30_pct?: number | null
          pitcher_la_score?: number | null
          pitcher_ld_score?: number | null
          pitcher_line_drive_pct?: number | null
          pitcher_pull_pct?: number | null
          pitcher_pull_score?: number | null
          pitcher_whiff_pct?: number | null
          pitcher_whiff_score?: number | null
          season?: number | null
          SLG?: number | null
          Stuff_plus?: number | null
          WHIP?: number | null
          WRC_plus?: number | null
        }
        Update: {
          AVG?: number | null
          ba_plus?: number | null
          BB9?: number | null
          "conference abbreviation"?: string | null
          conference_id?: string | null
          ERA?: number | null
          FIP?: number | null
          hitter_avg_ev?: number | null
          hitter_avg_ev_score?: number | null
          hitter_barrel_pct?: number | null
          hitter_barrel_score?: number | null
          hitter_bb_pct?: number | null
          hitter_bb_score?: number | null
          hitter_chase_pct?: number | null
          hitter_chase_score?: number | null
          hitter_contact_pct?: number | null
          hitter_contact_score?: number | null
          hitter_ev90?: number | null
          hitter_ev90_score?: number | null
          hitter_gb_pct?: number | null
          hitter_gb_score?: number | null
          hitter_la_10_30_pct?: number | null
          hitter_la_score?: number | null
          hitter_line_drive_pct?: number | null
          hitter_line_drive_score?: number | null
          hitter_pop_up_pct?: number | null
          hitter_pop_up_score?: number | null
          hitter_pull_pct?: number | null
          hitter_pull_score?: number | null
          HR9?: number | null
          ISO?: number | null
          iso_plus?: number | null
          K9?: number | null
          OBP?: number | null
          obp_plus?: number | null
          offensive_power_rating?: number | null
          OPS?: number | null
          Overall_Power_Rating?: number | null
          pitcher_barrel_pct?: number | null
          pitcher_barrel_score?: number | null
          pitcher_bb_pct?: number | null
          pitcher_bb_score?: number | null
          pitcher_chase_pct?: number | null
          pitcher_chase_score?: number | null
          pitcher_ev_score?: number | null
          pitcher_ev90?: number | null
          pitcher_ev90_score?: number | null
          pitcher_exit_velo?: number | null
          pitcher_gb_score?: number | null
          pitcher_ground_pct?: number | null
          pitcher_hard_hit_pct?: number | null
          pitcher_hh_score?: number | null
          pitcher_in_zone_pct?: number | null
          pitcher_iz_score?: number | null
          pitcher_iz_whiff_pct?: number | null
          pitcher_iz_whiff_score?: number | null
          pitcher_la_10_30_pct?: number | null
          pitcher_la_score?: number | null
          pitcher_ld_score?: number | null
          pitcher_line_drive_pct?: number | null
          pitcher_pull_pct?: number | null
          pitcher_pull_score?: number | null
          pitcher_whiff_pct?: number | null
          pitcher_whiff_score?: number | null
          season?: number | null
          SLG?: number | null
          Stuff_plus?: number | null
          WHIP?: number | null
          WRC_plus?: number | null
        }
        Relationships: []
      }
      conference_adjusted_stats: {
        Row: {
          adj_batting_avg: number | null
          adj_era: number | null
          adj_on_base_pct: number | null
          adj_ops: number | null
          adj_slugging_pct: number | null
          adj_whip: number | null
          created_at: string
          id: string
          park_factor_applied: number | null
          player_id: string
          power_rating_applied: number | null
          season: number
          updated_at: string
        }
        Insert: {
          adj_batting_avg?: number | null
          adj_era?: number | null
          adj_on_base_pct?: number | null
          adj_ops?: number | null
          adj_slugging_pct?: number | null
          adj_whip?: number | null
          created_at?: string
          id?: string
          park_factor_applied?: number | null
          player_id: string
          power_rating_applied?: number | null
          season: number
          updated_at?: string
        }
        Update: {
          adj_batting_avg?: number | null
          adj_era?: number | null
          adj_on_base_pct?: number | null
          adj_ops?: number | null
          adj_slugging_pct?: number | null
          adj_whip?: number | null
          created_at?: string
          id?: string
          park_factor_applied?: number | null
          player_id?: string
          power_rating_applied?: number | null
          season?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conference_adjusted_stats_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_teams: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          name: string
          savant_enabled: boolean
          school_team_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          savant_enabled?: boolean
          school_team_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          savant_enabled?: boolean
          school_team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_teams_school_team_id_fkey"
            columns: ["school_team_id"]
            isOneToOne: false
            referencedRelation: "Teams Table"
            referencedColumns: ["id"]
          },
        ]
      }
      developmental_weights: {
        Row: {
          created_at: string
          from_class: string
          id: string
          notes: string | null
          position: string
          stat_category: string
          to_class: string
          updated_at: string
          weight: number
        }
        Insert: {
          created_at?: string
          from_class: string
          id?: string
          notes?: string | null
          position: string
          stat_category?: string
          to_class: string
          updated_at?: string
          weight?: number
        }
        Update: {
          created_at?: string
          from_class?: string
          id?: string
          notes?: string | null
          position?: string
          stat_category?: string
          to_class?: string
          updated_at?: string
          weight?: number
        }
        Relationships: []
      }
      "Equation Weights": {
        Row: {
          Category: string | null
          Description: string | null
          Equation: string | null
          id: string
          Name: string
          Season: number | null
          sub_metric: string | null
          Value: number | null
        }
        Insert: {
          Category?: string | null
          Description?: string | null
          Equation?: string | null
          id?: string
          Name: string
          Season?: number | null
          sub_metric?: string | null
          Value?: number | null
        }
        Update: {
          Category?: string | null
          Description?: string | null
          Equation?: string | null
          id?: string
          Name?: string
          Season?: number | null
          sub_metric?: string | null
          Value?: number | null
        }
        Relationships: []
      }
      high_follow: {
        Row: {
          added_at: string | null
          id: string
          notes: string | null
          player_id: string
          player_type: string
          user_id: string
        }
        Insert: {
          added_at?: string | null
          id?: string
          notes?: string | null
          player_id: string
          player_type?: string
          user_id: string
        }
        Update: {
          added_at?: string | null
          id?: string
          notes?: string | null
          player_id?: string
          player_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "high_follow_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      "Hitter Master": {
        Row: {
          ab: number | null
          AVG: number | null
          avg_ev_score: number | null
          avg_exit_velo: number | null
          ba_plus: number | null
          barrel: number | null
          barrel_score: number | null
          BatHand: string | null
          bb: number | null
          bb_score: number | null
          blended_avg: number | null
          blended_avg_exit_velo: number | null
          blended_barrel: number | null
          blended_bb: number | null
          blended_chase: number | null
          blended_contact: number | null
          blended_ev90: number | null
          blended_from_team: string | null
          blended_from_team_id: string | null
          blended_gb: number | null
          blended_iso: number | null
          blended_la_10_30: number | null
          blended_line_drive: number | null
          blended_obp: number | null
          blended_pop_up: number | null
          blended_pull: number | null
          blended_slg: number | null
          chase: number | null
          chase_score: number | null
          combined_pa: number | null
          combined_seasons: string | null
          combined_used: boolean
          Conference: string | null
          conference_id: string | null
          contact: number | null
          contact_score: number | null
          ev90: number | null
          ev90_score: number | null
          gb: number | null
          gb_score: number | null
          id: string
          ISO: number | null
          iso_plus: number | null
          la_10_30: number | null
          la_score: number | null
          line_drive: number | null
          line_drive_score: number | null
          OBP: number | null
          obp_plus: number | null
          overall_plus: number | null
          pa: number | null
          playerFullName: string | null
          pop_up: number | null
          pop_up_score: number | null
          Pos: string | null
          pull: number | null
          pull_score: number | null
          Season: number | null
          SLG: number | null
          source_player_id: string
          Team: string | null
          TeamID: string | null
          ThrowHand: string | null
        }
        Insert: {
          ab?: number | null
          AVG?: number | null
          avg_ev_score?: number | null
          avg_exit_velo?: number | null
          ba_plus?: number | null
          barrel?: number | null
          barrel_score?: number | null
          BatHand?: string | null
          bb?: number | null
          bb_score?: number | null
          blended_avg?: number | null
          blended_avg_exit_velo?: number | null
          blended_barrel?: number | null
          blended_bb?: number | null
          blended_chase?: number | null
          blended_contact?: number | null
          blended_ev90?: number | null
          blended_from_team?: string | null
          blended_from_team_id?: string | null
          blended_gb?: number | null
          blended_iso?: number | null
          blended_la_10_30?: number | null
          blended_line_drive?: number | null
          blended_obp?: number | null
          blended_pop_up?: number | null
          blended_pull?: number | null
          blended_slg?: number | null
          chase?: number | null
          chase_score?: number | null
          combined_pa?: number | null
          combined_seasons?: string | null
          combined_used?: boolean
          Conference?: string | null
          conference_id?: string | null
          contact?: number | null
          contact_score?: number | null
          ev90?: number | null
          ev90_score?: number | null
          gb?: number | null
          gb_score?: number | null
          id?: string
          ISO?: number | null
          iso_plus?: number | null
          la_10_30?: number | null
          la_score?: number | null
          line_drive?: number | null
          line_drive_score?: number | null
          OBP?: number | null
          obp_plus?: number | null
          overall_plus?: number | null
          pa?: number | null
          playerFullName?: string | null
          pop_up?: number | null
          pop_up_score?: number | null
          Pos?: string | null
          pull?: number | null
          pull_score?: number | null
          Season?: number | null
          SLG?: number | null
          source_player_id: string
          Team?: string | null
          TeamID?: string | null
          ThrowHand?: string | null
        }
        Update: {
          ab?: number | null
          AVG?: number | null
          avg_ev_score?: number | null
          avg_exit_velo?: number | null
          ba_plus?: number | null
          barrel?: number | null
          barrel_score?: number | null
          BatHand?: string | null
          bb?: number | null
          bb_score?: number | null
          blended_avg?: number | null
          blended_avg_exit_velo?: number | null
          blended_barrel?: number | null
          blended_bb?: number | null
          blended_chase?: number | null
          blended_contact?: number | null
          blended_ev90?: number | null
          blended_from_team?: string | null
          blended_from_team_id?: string | null
          blended_gb?: number | null
          blended_iso?: number | null
          blended_la_10_30?: number | null
          blended_line_drive?: number | null
          blended_obp?: number | null
          blended_pop_up?: number | null
          blended_pull?: number | null
          blended_slg?: number | null
          chase?: number | null
          chase_score?: number | null
          combined_pa?: number | null
          combined_seasons?: string | null
          combined_used?: boolean
          Conference?: string | null
          conference_id?: string | null
          contact?: number | null
          contact_score?: number | null
          ev90?: number | null
          ev90_score?: number | null
          gb?: number | null
          gb_score?: number | null
          id?: string
          ISO?: number | null
          iso_plus?: number | null
          la_10_30?: number | null
          la_score?: number | null
          line_drive?: number | null
          line_drive_score?: number | null
          OBP?: number | null
          obp_plus?: number | null
          overall_plus?: number | null
          pa?: number | null
          playerFullName?: string | null
          pop_up?: number | null
          pop_up_score?: number | null
          Pos?: string | null
          pull?: number | null
          pull_score?: number | null
          Season?: number | null
          SLG?: number | null
          source_player_id?: string
          Team?: string | null
          TeamID?: string | null
          ThrowHand?: string | null
        }
        Relationships: []
      }
      model_config: {
        Row: {
          config_key: string
          config_value: number
          created_at: string
          id: string
          model_type: string
          season: number
          updated_at: string
        }
        Insert: {
          config_key: string
          config_value: number
          created_at?: string
          id?: string
          model_type: string
          season?: number
          updated_at?: string
        }
        Update: {
          config_key?: string
          config_value?: number
          created_at?: string
          id?: string
          model_type?: string
          season?: number
          updated_at?: string
        }
        Relationships: []
      }
      ncaa_averages: {
        Row: {
          avg: number | null
          avg_sd: number | null
          barrel_pct: number | null
          barrel_pct_sd: number | null
          bb_pct: number | null
          bb_pct_sd: number | null
          bb9: number | null
          bb9_sd: number | null
          chase_pct: number | null
          chase_pct_sd: number | null
          contact_pct: number | null
          contact_pct_sd: number | null
          era: number | null
          era_sd: number | null
          ev90: number | null
          ev90_sd: number | null
          exit_velo: number | null
          exit_velo_sd: number | null
          fip: number | null
          fip_sd: number | null
          ground_pct: number | null
          ground_pct_sd: number | null
          hr9: number | null
          hr9_sd: number | null
          iso: number | null
          iso_sd: number | null
          k9: number | null
          k9_sd: number | null
          la_10_30_pct: number | null
          la_10_30_pct_sd: number | null
          line_drive_pct: number | null
          line_drive_pct_sd: number | null
          obp: number | null
          obp_sd: number | null
          ops: number | null
          ops_sd: number | null
          pitcher_barrel_pct: number | null
          pitcher_barrel_pct_sd: number | null
          pitcher_bb_pct: number | null
          pitcher_bb_pct_sd: number | null
          pitcher_chase_pct: number | null
          pitcher_chase_pct_sd: number | null
          pitcher_ev90: number | null
          pitcher_ev90_sd: number | null
          pitcher_exit_velo: number | null
          pitcher_exit_velo_sd: number | null
          pitcher_ground_pct: number | null
          pitcher_ground_pct_sd: number | null
          pitcher_hard_hit_pct: number | null
          pitcher_hard_hit_pct_sd: number | null
          pitcher_in_zone_pct: number | null
          pitcher_in_zone_pct_sd: number | null
          pitcher_iz_whiff_pct: number | null
          pitcher_iz_whiff_pct_sd: number | null
          pitcher_la_10_30_pct: number | null
          pitcher_la_10_30_pct_sd: number | null
          pitcher_line_drive_pct: number | null
          pitcher_line_drive_pct_sd: number | null
          pitcher_pull_pct: number | null
          pitcher_pull_pct_sd: number | null
          pitcher_whiff_pct: number | null
          pitcher_whiff_pct_sd: number | null
          pop_up_pct: number | null
          pop_up_pct_sd: number | null
          pull_pct: number | null
          pull_pct_sd: number | null
          season: number
          slg: number | null
          slg_sd: number | null
          stuff_plus: number | null
          stuff_plus_sd: number | null
          updated_at: string | null
          whip: number | null
          whip_sd: number | null
          wrc: number | null
          wrc_sd: number | null
        }
        Insert: {
          avg?: number | null
          avg_sd?: number | null
          barrel_pct?: number | null
          barrel_pct_sd?: number | null
          bb_pct?: number | null
          bb_pct_sd?: number | null
          bb9?: number | null
          bb9_sd?: number | null
          chase_pct?: number | null
          chase_pct_sd?: number | null
          contact_pct?: number | null
          contact_pct_sd?: number | null
          era?: number | null
          era_sd?: number | null
          ev90?: number | null
          ev90_sd?: number | null
          exit_velo?: number | null
          exit_velo_sd?: number | null
          fip?: number | null
          fip_sd?: number | null
          ground_pct?: number | null
          ground_pct_sd?: number | null
          hr9?: number | null
          hr9_sd?: number | null
          iso?: number | null
          iso_sd?: number | null
          k9?: number | null
          k9_sd?: number | null
          la_10_30_pct?: number | null
          la_10_30_pct_sd?: number | null
          line_drive_pct?: number | null
          line_drive_pct_sd?: number | null
          obp?: number | null
          obp_sd?: number | null
          ops?: number | null
          ops_sd?: number | null
          pitcher_barrel_pct?: number | null
          pitcher_barrel_pct_sd?: number | null
          pitcher_bb_pct?: number | null
          pitcher_bb_pct_sd?: number | null
          pitcher_chase_pct?: number | null
          pitcher_chase_pct_sd?: number | null
          pitcher_ev90?: number | null
          pitcher_ev90_sd?: number | null
          pitcher_exit_velo?: number | null
          pitcher_exit_velo_sd?: number | null
          pitcher_ground_pct?: number | null
          pitcher_ground_pct_sd?: number | null
          pitcher_hard_hit_pct?: number | null
          pitcher_hard_hit_pct_sd?: number | null
          pitcher_in_zone_pct?: number | null
          pitcher_in_zone_pct_sd?: number | null
          pitcher_iz_whiff_pct?: number | null
          pitcher_iz_whiff_pct_sd?: number | null
          pitcher_la_10_30_pct?: number | null
          pitcher_la_10_30_pct_sd?: number | null
          pitcher_line_drive_pct?: number | null
          pitcher_line_drive_pct_sd?: number | null
          pitcher_pull_pct?: number | null
          pitcher_pull_pct_sd?: number | null
          pitcher_whiff_pct?: number | null
          pitcher_whiff_pct_sd?: number | null
          pop_up_pct?: number | null
          pop_up_pct_sd?: number | null
          pull_pct?: number | null
          pull_pct_sd?: number | null
          season: number
          slg?: number | null
          slg_sd?: number | null
          stuff_plus?: number | null
          stuff_plus_sd?: number | null
          updated_at?: string | null
          whip?: number | null
          whip_sd?: number | null
          wrc?: number | null
          wrc_sd?: number | null
        }
        Update: {
          avg?: number | null
          avg_sd?: number | null
          barrel_pct?: number | null
          barrel_pct_sd?: number | null
          bb_pct?: number | null
          bb_pct_sd?: number | null
          bb9?: number | null
          bb9_sd?: number | null
          chase_pct?: number | null
          chase_pct_sd?: number | null
          contact_pct?: number | null
          contact_pct_sd?: number | null
          era?: number | null
          era_sd?: number | null
          ev90?: number | null
          ev90_sd?: number | null
          exit_velo?: number | null
          exit_velo_sd?: number | null
          fip?: number | null
          fip_sd?: number | null
          ground_pct?: number | null
          ground_pct_sd?: number | null
          hr9?: number | null
          hr9_sd?: number | null
          iso?: number | null
          iso_sd?: number | null
          k9?: number | null
          k9_sd?: number | null
          la_10_30_pct?: number | null
          la_10_30_pct_sd?: number | null
          line_drive_pct?: number | null
          line_drive_pct_sd?: number | null
          obp?: number | null
          obp_sd?: number | null
          ops?: number | null
          ops_sd?: number | null
          pitcher_barrel_pct?: number | null
          pitcher_barrel_pct_sd?: number | null
          pitcher_bb_pct?: number | null
          pitcher_bb_pct_sd?: number | null
          pitcher_chase_pct?: number | null
          pitcher_chase_pct_sd?: number | null
          pitcher_ev90?: number | null
          pitcher_ev90_sd?: number | null
          pitcher_exit_velo?: number | null
          pitcher_exit_velo_sd?: number | null
          pitcher_ground_pct?: number | null
          pitcher_ground_pct_sd?: number | null
          pitcher_hard_hit_pct?: number | null
          pitcher_hard_hit_pct_sd?: number | null
          pitcher_in_zone_pct?: number | null
          pitcher_in_zone_pct_sd?: number | null
          pitcher_iz_whiff_pct?: number | null
          pitcher_iz_whiff_pct_sd?: number | null
          pitcher_la_10_30_pct?: number | null
          pitcher_la_10_30_pct_sd?: number | null
          pitcher_line_drive_pct?: number | null
          pitcher_line_drive_pct_sd?: number | null
          pitcher_pull_pct?: number | null
          pitcher_pull_pct_sd?: number | null
          pitcher_whiff_pct?: number | null
          pitcher_whiff_pct_sd?: number | null
          pop_up_pct?: number | null
          pop_up_pct_sd?: number | null
          pull_pct?: number | null
          pull_pct_sd?: number | null
          season?: number
          slg?: number | null
          slg_sd?: number | null
          stuff_plus?: number | null
          stuff_plus_sd?: number | null
          updated_at?: string | null
          whip?: number | null
          whip_sd?: number | null
          wrc?: number | null
          wrc_sd?: number | null
        }
        Relationships: []
      }
      nil_valuations: {
        Row: {
          component_breakdown: Json | null
          created_at: string
          estimated_value: number | null
          id: string
          model_version: string | null
          offensive_effectiveness: number | null
          player_id: string
          season: number
          updated_at: string
          war: number | null
        }
        Insert: {
          component_breakdown?: Json | null
          created_at?: string
          estimated_value?: number | null
          id?: string
          model_version?: string | null
          offensive_effectiveness?: number | null
          player_id: string
          season: number
          updated_at?: string
          war?: number | null
        }
        Update: {
          component_breakdown?: Json | null
          created_at?: string
          estimated_value?: number | null
          id?: string
          model_version?: string | null
          offensive_effectiveness?: number | null
          player_id?: string
          season?: number
          updated_at?: string
          war?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "nil_valuations_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      "Park Factors": {
        Row: {
          avg_factor: number | null
          hr9_factor: number | null
          id: string
          iso_factor: number | null
          obp_factor: number | null
          rg_factor: number | null
          season: number | null
          team_id: string | null
          team_name: string
          whip_factor: number | null
        }
        Insert: {
          avg_factor?: number | null
          hr9_factor?: number | null
          id?: string
          iso_factor?: number | null
          obp_factor?: number | null
          rg_factor?: number | null
          season?: number | null
          team_id?: string | null
          team_name: string
          whip_factor?: number | null
        }
        Update: {
          avg_factor?: number | null
          hr9_factor?: number | null
          id?: string
          iso_factor?: number | null
          obp_factor?: number | null
          rg_factor?: number | null
          season?: number | null
          team_id?: string | null
          team_name?: string
          whip_factor?: number | null
        }
        Relationships: []
      }
      park_factors: {
        Row: {
          bb_factor: number | null
          created_at: string
          doubles_factor: number | null
          hits_factor: number | null
          hr_factor: number | null
          id: string
          overall_factor: number
          runs_factor: number | null
          season: number
          team: string
          updated_at: string
          venue_name: string | null
        }
        Insert: {
          bb_factor?: number | null
          created_at?: string
          doubles_factor?: number | null
          hits_factor?: number | null
          hr_factor?: number | null
          id?: string
          overall_factor?: number
          runs_factor?: number | null
          season: number
          team: string
          updated_at?: string
          venue_name?: string | null
        }
        Update: {
          bb_factor?: number | null
          created_at?: string
          doubles_factor?: number | null
          hits_factor?: number | null
          hr_factor?: number | null
          id?: string
          overall_factor?: number
          runs_factor?: number | null
          season?: number
          team?: string
          updated_at?: string
          venue_name?: string | null
        }
        Relationships: []
      }
      "Pitch Arsenal": {
        Row: {
          hand: string | null
          id: string
          overall_stuff_plus: number | null
          pitch_type: string
          player_name: string
          season: number
          source_player_id: string | null
          stuff_plus: number | null
          total_pitches: number | null
          total_pitches_all: number | null
          whiff_pct: number | null
        }
        Insert: {
          hand?: string | null
          id?: string
          overall_stuff_plus?: number | null
          pitch_type: string
          player_name: string
          season?: number
          source_player_id?: string | null
          stuff_plus?: number | null
          total_pitches?: number | null
          total_pitches_all?: number | null
          whiff_pct?: number | null
        }
        Update: {
          hand?: string | null
          id?: string
          overall_stuff_plus?: number | null
          pitch_type?: string
          player_name?: string
          season?: number
          source_player_id?: string | null
          stuff_plus?: number | null
          total_pitches?: number | null
          total_pitches_all?: number | null
          whiff_pct?: number | null
        }
        Relationships: []
      }
      pitch_arsenal: {
        Row: {
          created_at: string
          hand: string | null
          id: string
          overall_stuff_plus: number | null
          pitch_count: number | null
          pitch_type: string
          player_id: string | null
          player_name: string
          season: number
          source_file: string | null
          stuff_plus: number | null
          total_pitches: number | null
          updated_at: string
          usage_pct: number | null
          whiff_pct: number | null
        }
        Insert: {
          created_at?: string
          hand?: string | null
          id?: string
          overall_stuff_plus?: number | null
          pitch_count?: number | null
          pitch_type: string
          player_id?: string | null
          player_name: string
          season: number
          source_file?: string | null
          stuff_plus?: number | null
          total_pitches?: number | null
          updated_at?: string
          usage_pct?: number | null
          whiff_pct?: number | null
        }
        Update: {
          created_at?: string
          hand?: string | null
          id?: string
          overall_stuff_plus?: number | null
          pitch_count?: number | null
          pitch_type?: string
          player_id?: string | null
          player_name?: string
          season?: number
          source_file?: string | null
          stuff_plus?: number | null
          total_pitches?: number | null
          updated_at?: string
          usage_pct?: number | null
          whiff_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pitch_arsenal_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      pitcher_role_overrides: {
        Row: {
          id: string
          player_id: string
          role: string
          updated_at: string | null
        }
        Insert: {
          id?: string
          player_id: string
          role: string
          updated_at?: string | null
        }
        Update: {
          id?: string
          player_id?: string
          role?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pitcher_role_overrides_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      pitcher_stuff_plus_inputs: {
        Row: {
          boundary_case: boolean | null
          conference: string | null
          conference_id: string | null
          created_at: string | null
          dropped_sources: Json | null
          extension: number | null
          fb_ch_velo_diff: number | null
          gyro_stuff_plus: number | null
          hand: string
          hb: number | null
          id: string
          ivb: number | null
          needs_review: boolean | null
          outlier_flag: boolean | null
          outlier_metrics: string[] | null
          p_consolidated: boolean | null
          p_consolidated_count: number | null
          pitch_type: string
          pitches: number | null
          rel_height: number | null
          rel_side: number | null
          review_detail: Json | null
          review_note: string | null
          rstr_pitch_class: string | null
          season: number
          source_player_id: string
          source_tags: string[] | null
          spin: number | null
          stuff_plus: number | null
          team: string | null
          team_id: string | null
          vaa: number | null
          velocity: number | null
          whiff_pct: number | null
        }
        Insert: {
          boundary_case?: boolean | null
          conference?: string | null
          conference_id?: string | null
          created_at?: string | null
          dropped_sources?: Json | null
          extension?: number | null
          fb_ch_velo_diff?: number | null
          gyro_stuff_plus?: number | null
          hand: string
          hb?: number | null
          id?: string
          ivb?: number | null
          needs_review?: boolean | null
          outlier_flag?: boolean | null
          outlier_metrics?: string[] | null
          p_consolidated?: boolean | null
          p_consolidated_count?: number | null
          pitch_type: string
          pitches?: number | null
          rel_height?: number | null
          rel_side?: number | null
          review_detail?: Json | null
          review_note?: string | null
          rstr_pitch_class?: string | null
          season: number
          source_player_id: string
          source_tags?: string[] | null
          spin?: number | null
          stuff_plus?: number | null
          team?: string | null
          team_id?: string | null
          vaa?: number | null
          velocity?: number | null
          whiff_pct?: number | null
        }
        Update: {
          boundary_case?: boolean | null
          conference?: string | null
          conference_id?: string | null
          created_at?: string | null
          dropped_sources?: Json | null
          extension?: number | null
          fb_ch_velo_diff?: number | null
          gyro_stuff_plus?: number | null
          hand?: string
          hb?: number | null
          id?: string
          ivb?: number | null
          needs_review?: boolean | null
          outlier_flag?: boolean | null
          outlier_metrics?: string[] | null
          p_consolidated?: boolean | null
          p_consolidated_count?: number | null
          pitch_type?: string
          pitches?: number | null
          rel_height?: number | null
          rel_side?: number | null
          review_detail?: Json | null
          review_note?: string | null
          rstr_pitch_class?: string | null
          season?: number
          source_player_id?: string
          source_tags?: string[] | null
          spin?: number | null
          stuff_plus?: number | null
          team?: string | null
          team_id?: string | null
          vaa?: number | null
          velocity?: number | null
          whiff_pct?: number | null
        }
        Relationships: []
      }
      pitcher_stuff_plus_ncaa: {
        Row: {
          created_at: string | null
          extension: number | null
          extension_sd: number | null
          hand: string
          hb: number | null
          hb_sd: number | null
          id: string
          ivb: number | null
          ivb_sd: number | null
          n_pitchers: number | null
          pitch_type: string
          pitches: number | null
          rel_height: number | null
          rel_height_sd: number | null
          rel_side: number | null
          rel_side_sd: number | null
          season: number
          spin: number | null
          spin_sd: number | null
          vaa: number | null
          vaa_sd: number | null
          velo_diff: number | null
          velo_diff_sd: number | null
          velocity: number | null
          velocity_sd: number | null
          whiff_pct: number | null
          whiff_pct_sd: number | null
        }
        Insert: {
          created_at?: string | null
          extension?: number | null
          extension_sd?: number | null
          hand: string
          hb?: number | null
          hb_sd?: number | null
          id?: string
          ivb?: number | null
          ivb_sd?: number | null
          n_pitchers?: number | null
          pitch_type: string
          pitches?: number | null
          rel_height?: number | null
          rel_height_sd?: number | null
          rel_side?: number | null
          rel_side_sd?: number | null
          season: number
          spin?: number | null
          spin_sd?: number | null
          vaa?: number | null
          vaa_sd?: number | null
          velo_diff?: number | null
          velo_diff_sd?: number | null
          velocity?: number | null
          velocity_sd?: number | null
          whiff_pct?: number | null
          whiff_pct_sd?: number | null
        }
        Update: {
          created_at?: string | null
          extension?: number | null
          extension_sd?: number | null
          hand?: string
          hb?: number | null
          hb_sd?: number | null
          id?: string
          ivb?: number | null
          ivb_sd?: number | null
          n_pitchers?: number | null
          pitch_type?: string
          pitches?: number | null
          rel_height?: number | null
          rel_height_sd?: number | null
          rel_side?: number | null
          rel_side_sd?: number | null
          season?: number
          spin?: number | null
          spin_sd?: number | null
          vaa?: number | null
          vaa_sd?: number | null
          velo_diff?: number | null
          velo_diff_sd?: number | null
          velocity?: number | null
          velocity_sd?: number | null
          whiff_pct?: number | null
          whiff_pct_sd?: number | null
        }
        Relationships: []
      }
      "Pitching Master": {
        Row: {
          "90th_vel": number | null
          barrel_pct: number | null
          barrel_score: number | null
          bb_pct: number | null
          bb_score: number | null
          BB9: number | null
          bb9_pr_plus: number | null
          blended_90th_vel: number | null
          blended_barrel_pct: number | null
          blended_bb_pct: number | null
          blended_bb9: number | null
          blended_chase_pct: number | null
          blended_era: number | null
          blended_exit_vel: number | null
          blended_fip: number | null
          blended_from_team: string | null
          blended_from_team_id: string | null
          blended_ground_pct: number | null
          blended_h_pull_pct: number | null
          blended_hard_hit_pct: number | null
          blended_hr9: number | null
          blended_in_zone_pct: number | null
          blended_in_zone_whiff_pct: number | null
          blended_k9: number | null
          blended_la_10_30_pct: number | null
          blended_line_pct: number | null
          blended_miss_pct: number | null
          blended_stuff_plus: number | null
          blended_whip: number | null
          chase_pct: number | null
          chase_score: number | null
          combined_ip: number | null
          combined_seasons: string | null
          combined_used: boolean
          Conference: string | null
          conference_id: string | null
          ERA: number | null
          era_pr_plus: number | null
          ev_score: number | null
          ev90_score: number | null
          exit_vel: number | null
          FIP: number | null
          fip_pr_plus: number | null
          G: number | null
          gb_score: number | null
          ground_pct: number | null
          GS: number | null
          h_pull_pct: number | null
          hard_hit_pct: number | null
          hh_score: number | null
          HR9: number | null
          hr9_pr_plus: number | null
          id: string
          in_zone_pct: number | null
          in_zone_whiff_pct: number | null
          IP: number | null
          iz_score: number | null
          iz_whiff_score: number | null
          K9: number | null
          k9_pr_plus: number | null
          la_10_30_pct: number | null
          la_score: number | null
          ld_score: number | null
          line_pct: number | null
          miss_pct: number | null
          overall_pr_plus: number | null
          playerFullName: string | null
          pull_score: number | null
          Role: string | null
          Season: number | null
          source_player_id: string
          stuff_plus: number | null
          Team: string | null
          TeamID: string | null
          ThrowHand: string | null
          whiff_score: number | null
          WHIP: number | null
          whip_pr_plus: number | null
        }
        Insert: {
          "90th_vel"?: number | null
          barrel_pct?: number | null
          barrel_score?: number | null
          bb_pct?: number | null
          bb_score?: number | null
          BB9?: number | null
          bb9_pr_plus?: number | null
          blended_90th_vel?: number | null
          blended_barrel_pct?: number | null
          blended_bb_pct?: number | null
          blended_bb9?: number | null
          blended_chase_pct?: number | null
          blended_era?: number | null
          blended_exit_vel?: number | null
          blended_fip?: number | null
          blended_from_team?: string | null
          blended_from_team_id?: string | null
          blended_ground_pct?: number | null
          blended_h_pull_pct?: number | null
          blended_hard_hit_pct?: number | null
          blended_hr9?: number | null
          blended_in_zone_pct?: number | null
          blended_in_zone_whiff_pct?: number | null
          blended_k9?: number | null
          blended_la_10_30_pct?: number | null
          blended_line_pct?: number | null
          blended_miss_pct?: number | null
          blended_stuff_plus?: number | null
          blended_whip?: number | null
          chase_pct?: number | null
          chase_score?: number | null
          combined_ip?: number | null
          combined_seasons?: string | null
          combined_used?: boolean
          Conference?: string | null
          conference_id?: string | null
          ERA?: number | null
          era_pr_plus?: number | null
          ev_score?: number | null
          ev90_score?: number | null
          exit_vel?: number | null
          FIP?: number | null
          fip_pr_plus?: number | null
          G?: number | null
          gb_score?: number | null
          ground_pct?: number | null
          GS?: number | null
          h_pull_pct?: number | null
          hard_hit_pct?: number | null
          hh_score?: number | null
          HR9?: number | null
          hr9_pr_plus?: number | null
          id?: string
          in_zone_pct?: number | null
          in_zone_whiff_pct?: number | null
          IP?: number | null
          iz_score?: number | null
          iz_whiff_score?: number | null
          K9?: number | null
          k9_pr_plus?: number | null
          la_10_30_pct?: number | null
          la_score?: number | null
          ld_score?: number | null
          line_pct?: number | null
          miss_pct?: number | null
          overall_pr_plus?: number | null
          playerFullName?: string | null
          pull_score?: number | null
          Role?: string | null
          Season?: number | null
          source_player_id: string
          stuff_plus?: number | null
          Team?: string | null
          TeamID?: string | null
          ThrowHand?: string | null
          whiff_score?: number | null
          WHIP?: number | null
          whip_pr_plus?: number | null
        }
        Update: {
          "90th_vel"?: number | null
          barrel_pct?: number | null
          barrel_score?: number | null
          bb_pct?: number | null
          bb_score?: number | null
          BB9?: number | null
          bb9_pr_plus?: number | null
          blended_90th_vel?: number | null
          blended_barrel_pct?: number | null
          blended_bb_pct?: number | null
          blended_bb9?: number | null
          blended_chase_pct?: number | null
          blended_era?: number | null
          blended_exit_vel?: number | null
          blended_fip?: number | null
          blended_from_team?: string | null
          blended_from_team_id?: string | null
          blended_ground_pct?: number | null
          blended_h_pull_pct?: number | null
          blended_hard_hit_pct?: number | null
          blended_hr9?: number | null
          blended_in_zone_pct?: number | null
          blended_in_zone_whiff_pct?: number | null
          blended_k9?: number | null
          blended_la_10_30_pct?: number | null
          blended_line_pct?: number | null
          blended_miss_pct?: number | null
          blended_stuff_plus?: number | null
          blended_whip?: number | null
          chase_pct?: number | null
          chase_score?: number | null
          combined_ip?: number | null
          combined_seasons?: string | null
          combined_used?: boolean
          Conference?: string | null
          conference_id?: string | null
          ERA?: number | null
          era_pr_plus?: number | null
          ev_score?: number | null
          ev90_score?: number | null
          exit_vel?: number | null
          FIP?: number | null
          fip_pr_plus?: number | null
          G?: number | null
          gb_score?: number | null
          ground_pct?: number | null
          GS?: number | null
          h_pull_pct?: number | null
          hard_hit_pct?: number | null
          hh_score?: number | null
          HR9?: number | null
          hr9_pr_plus?: number | null
          id?: string
          in_zone_pct?: number | null
          in_zone_whiff_pct?: number | null
          IP?: number | null
          iz_score?: number | null
          iz_whiff_score?: number | null
          K9?: number | null
          k9_pr_plus?: number | null
          la_10_30_pct?: number | null
          la_score?: number | null
          ld_score?: number | null
          line_pct?: number | null
          miss_pct?: number | null
          overall_pr_plus?: number | null
          playerFullName?: string | null
          pull_score?: number | null
          Role?: string | null
          Season?: number | null
          source_player_id?: string
          stuff_plus?: number | null
          Team?: string | null
          TeamID?: string | null
          ThrowHand?: string | null
          whiff_score?: number | null
          WHIP?: number | null
          whip_pr_plus?: number | null
        }
        Relationships: []
      }
      player_overrides: {
        Row: {
          class_transition: string | null
          created_at: string
          dev_aggressiveness: number | null
          id: string
          player_id: string
          position: string | null
          updated_at: string
        }
        Insert: {
          class_transition?: string | null
          created_at?: string
          dev_aggressiveness?: number | null
          id?: string
          player_id: string
          position?: string | null
          updated_at?: string
        }
        Update: {
          class_transition?: string | null
          created_at?: string
          dev_aggressiveness?: number | null
          id?: string
          player_id?: string
          position?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_overrides_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_prediction_internals: {
        Row: {
          avg_power_rating: number | null
          bb9_power_rating: number | null
          created_at: string
          era_power_rating: number | null
          fip_power_rating: number | null
          hr9_power_rating: number | null
          id: string
          k9_power_rating: number | null
          obp_power_rating: number | null
          prediction_id: string
          slg_power_rating: number | null
          updated_at: string
          whip_power_rating: number | null
        }
        Insert: {
          avg_power_rating?: number | null
          bb9_power_rating?: number | null
          created_at?: string
          era_power_rating?: number | null
          fip_power_rating?: number | null
          hr9_power_rating?: number | null
          id?: string
          k9_power_rating?: number | null
          obp_power_rating?: number | null
          prediction_id: string
          slg_power_rating?: number | null
          updated_at?: string
          whip_power_rating?: number | null
        }
        Update: {
          avg_power_rating?: number | null
          bb9_power_rating?: number | null
          created_at?: string
          era_power_rating?: number | null
          fip_power_rating?: number | null
          hr9_power_rating?: number | null
          id?: string
          k9_power_rating?: number | null
          obp_power_rating?: number | null
          prediction_id?: string
          slg_power_rating?: number | null
          updated_at?: string
          whip_power_rating?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "player_prediction_internals_prediction_id_fkey"
            columns: ["prediction_id"]
            isOneToOne: true
            referencedRelation: "player_predictions"
            referencedColumns: ["id"]
          },
        ]
      }
      player_predictions: {
        Row: {
          barrel_score: number | null
          chase_score: number | null
          class_transition: string | null
          class_transition_overridden: boolean
          created_at: string
          dev_aggressiveness: number | null
          ev_score: number | null
          from_avg: number | null
          from_avg_plus: number | null
          from_bb9: number | null
          from_era: number | null
          from_fip: number | null
          from_hr9: number | null
          from_k9: number | null
          from_obp: number | null
          from_obp_plus: number | null
          from_park_factor: number | null
          from_slg: number | null
          from_slg_plus: number | null
          from_stuff_plus: number | null
          from_stuff_plus_self: number | null
          from_whip: number | null
          id: string
          locked: boolean
          model_type: string
          p_avg: number | null
          p_bb9: number | null
          p_era: number | null
          p_fip: number | null
          p_hr9: number | null
          p_iso: number | null
          p_k9: number | null
          p_obp: number | null
          p_ops: number | null
          p_rv_plus: number | null
          p_slg: number | null
          p_whip: number | null
          p_wrc: number | null
          p_wrc_plus: number | null
          pitcher_role: string | null
          player_id: string
          power_rating_plus: number | null
          power_rating_score: number | null
          season: number
          status: string
          to_avg_plus: number | null
          to_obp_plus: number | null
          to_park_factor: number | null
          to_slg_plus: number | null
          to_stuff_plus: number | null
          updated_at: string
          variant: string
          whiff_score: number | null
        }
        Insert: {
          barrel_score?: number | null
          chase_score?: number | null
          class_transition?: string | null
          class_transition_overridden?: boolean
          created_at?: string
          dev_aggressiveness?: number | null
          ev_score?: number | null
          from_avg?: number | null
          from_avg_plus?: number | null
          from_bb9?: number | null
          from_era?: number | null
          from_fip?: number | null
          from_hr9?: number | null
          from_k9?: number | null
          from_obp?: number | null
          from_obp_plus?: number | null
          from_park_factor?: number | null
          from_slg?: number | null
          from_slg_plus?: number | null
          from_stuff_plus?: number | null
          from_stuff_plus_self?: number | null
          from_whip?: number | null
          id?: string
          locked?: boolean
          model_type: string
          p_avg?: number | null
          p_bb9?: number | null
          p_era?: number | null
          p_fip?: number | null
          p_hr9?: number | null
          p_iso?: number | null
          p_k9?: number | null
          p_obp?: number | null
          p_ops?: number | null
          p_rv_plus?: number | null
          p_slg?: number | null
          p_whip?: number | null
          p_wrc?: number | null
          p_wrc_plus?: number | null
          pitcher_role?: string | null
          player_id: string
          power_rating_plus?: number | null
          power_rating_score?: number | null
          season?: number
          status?: string
          to_avg_plus?: number | null
          to_obp_plus?: number | null
          to_park_factor?: number | null
          to_slg_plus?: number | null
          to_stuff_plus?: number | null
          updated_at?: string
          variant?: string
          whiff_score?: number | null
        }
        Update: {
          barrel_score?: number | null
          chase_score?: number | null
          class_transition?: string | null
          class_transition_overridden?: boolean
          created_at?: string
          dev_aggressiveness?: number | null
          ev_score?: number | null
          from_avg?: number | null
          from_avg_plus?: number | null
          from_bb9?: number | null
          from_era?: number | null
          from_fip?: number | null
          from_hr9?: number | null
          from_k9?: number | null
          from_obp?: number | null
          from_obp_plus?: number | null
          from_park_factor?: number | null
          from_slg?: number | null
          from_slg_plus?: number | null
          from_stuff_plus?: number | null
          from_stuff_plus_self?: number | null
          from_whip?: number | null
          id?: string
          locked?: boolean
          model_type?: string
          p_avg?: number | null
          p_bb9?: number | null
          p_era?: number | null
          p_fip?: number | null
          p_hr9?: number | null
          p_iso?: number | null
          p_k9?: number | null
          p_obp?: number | null
          p_ops?: number | null
          p_rv_plus?: number | null
          p_slg?: number | null
          p_whip?: number | null
          p_wrc?: number | null
          p_wrc_plus?: number | null
          pitcher_role?: string | null
          player_id?: string
          power_rating_plus?: number | null
          power_rating_score?: number | null
          season?: number
          status?: string
          to_avg_plus?: number | null
          to_obp_plus?: number | null
          to_park_factor?: number | null
          to_slg_plus?: number | null
          to_stuff_plus?: number | null
          updated_at?: string
          variant?: string
          whiff_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "player_predictions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          ab: number | null
          age: number | null
          bats_hand: string | null
          class_year: string | null
          conference: string | null
          created_at: string
          first_name: string
          from_team: string | null
          g: number | null
          gs: number | null
          handedness: string | null
          headshot_url: string | null
          height_inches: number | null
          high_school: string | null
          home_state: string | null
          id: string
          ip: number | null
          last_name: string
          notes: string | null
          pa: number | null
          portal_entry_date: string | null
          portal_status: string
          position: string | null
          source_player_id: string | null
          source_team_id: string | null
          team: string | null
          team_id: string | null
          throws_hand: string | null
          transfer_portal: boolean
          updated_at: string
          weight: number | null
        }
        Insert: {
          ab?: number | null
          age?: number | null
          bats_hand?: string | null
          class_year?: string | null
          conference?: string | null
          created_at?: string
          first_name: string
          from_team?: string | null
          g?: number | null
          gs?: number | null
          handedness?: string | null
          headshot_url?: string | null
          height_inches?: number | null
          high_school?: string | null
          home_state?: string | null
          id?: string
          ip?: number | null
          last_name: string
          notes?: string | null
          pa?: number | null
          portal_entry_date?: string | null
          portal_status?: string
          position?: string | null
          source_player_id?: string | null
          source_team_id?: string | null
          team?: string | null
          team_id?: string | null
          throws_hand?: string | null
          transfer_portal?: boolean
          updated_at?: string
          weight?: number | null
        }
        Update: {
          ab?: number | null
          age?: number | null
          bats_hand?: string | null
          class_year?: string | null
          conference?: string | null
          created_at?: string
          first_name?: string
          from_team?: string | null
          g?: number | null
          gs?: number | null
          handedness?: string | null
          headshot_url?: string | null
          height_inches?: number | null
          high_school?: string | null
          home_state?: string | null
          id?: string
          ip?: number | null
          last_name?: string
          notes?: string | null
          pa?: number | null
          portal_entry_date?: string | null
          portal_status?: string
          position?: string | null
          source_player_id?: string | null
          source_team_id?: string | null
          team?: string | null
          team_id?: string | null
          throws_hand?: string | null
          transfer_portal?: boolean
          updated_at?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "players_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "Teams Table"
            referencedColumns: ["id"]
          },
        ]
      }
      power_ratings: {
        Row: {
          conference: string
          created_at: string
          id: string
          notes: string | null
          rank: number | null
          rating: number
          season: number
          strength_of_schedule: number | null
          updated_at: string
        }
        Insert: {
          conference: string
          created_at?: string
          id?: string
          notes?: string | null
          rank?: number | null
          rating?: number
          season: number
          strength_of_schedule?: number | null
          updated_at?: string
        }
        Update: {
          conference?: string
          created_at?: string
          id?: string
          notes?: string | null
          rank?: number | null
          rating?: number
          season?: number
          strength_of_schedule?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      rstr_reclassification_log: {
        Row: {
          action_taken: string
          created_at: string | null
          id: string
          original_pitch_type: string
          rstr_pitch_class: string
          season: number
          source_player_id: string
        }
        Insert: {
          action_taken: string
          created_at?: string | null
          id?: string
          original_pitch_type: string
          rstr_pitch_class: string
          season: number
          source_player_id: string
        }
        Update: {
          action_taken?: string
          created_at?: string | null
          id?: string
          original_pitch_type?: string
          rstr_pitch_class?: string
          season?: number
          source_player_id?: string
        }
        Relationships: []
      }
      season_stats: {
        Row: {
          at_bats: number | null
          batting_avg: number | null
          caught_stealing: number | null
          created_at: string
          doubles: number | null
          earned_runs: number | null
          era: number | null
          games: number | null
          hit_by_pitch: number | null
          hits: number | null
          hits_allowed: number | null
          home_runs: number | null
          id: string
          innings_pitched: number | null
          losses: number | null
          on_base_pct: number | null
          ops: number | null
          pitch_strikeouts: number | null
          pitch_walks: number | null
          player_id: string
          rbi: number | null
          runs: number | null
          sac_flies: number | null
          saves: number | null
          season: number
          slugging_pct: number | null
          stolen_bases: number | null
          strikeouts: number | null
          triples: number | null
          updated_at: string
          walks: number | null
          whip: number | null
          wins: number | null
        }
        Insert: {
          at_bats?: number | null
          batting_avg?: number | null
          caught_stealing?: number | null
          created_at?: string
          doubles?: number | null
          earned_runs?: number | null
          era?: number | null
          games?: number | null
          hit_by_pitch?: number | null
          hits?: number | null
          hits_allowed?: number | null
          home_runs?: number | null
          id?: string
          innings_pitched?: number | null
          losses?: number | null
          on_base_pct?: number | null
          ops?: number | null
          pitch_strikeouts?: number | null
          pitch_walks?: number | null
          player_id: string
          rbi?: number | null
          runs?: number | null
          sac_flies?: number | null
          saves?: number | null
          season: number
          slugging_pct?: number | null
          stolen_bases?: number | null
          strikeouts?: number | null
          triples?: number | null
          updated_at?: string
          walks?: number | null
          whip?: number | null
          wins?: number | null
        }
        Update: {
          at_bats?: number | null
          batting_avg?: number | null
          caught_stealing?: number | null
          created_at?: string
          doubles?: number | null
          earned_runs?: number | null
          era?: number | null
          games?: number | null
          hit_by_pitch?: number | null
          hits?: number | null
          hits_allowed?: number | null
          home_runs?: number | null
          id?: string
          innings_pitched?: number | null
          losses?: number | null
          on_base_pct?: number | null
          ops?: number | null
          pitch_strikeouts?: number | null
          pitch_walks?: number | null
          player_id?: string
          rbi?: number | null
          runs?: number | null
          sac_flies?: number | null
          saves?: number | null
          season?: number
          slugging_pct?: number | null
          stolen_bases?: number | null
          strikeouts?: number | null
          triples?: number | null
          updated_at?: string
          walks?: number | null
          whip?: number | null
          wins?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "season_stats_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      target_board: {
        Row: {
          added_at: string | null
          customer_team_id: string | null
          id: string
          notes: string | null
          player_id: string
          user_id: string
        }
        Insert: {
          added_at?: string | null
          customer_team_id?: string | null
          id?: string
          notes?: string | null
          player_id: string
          user_id: string
        }
        Update: {
          added_at?: string | null
          customer_team_id?: string | null
          id?: string
          notes?: string | null
          player_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "target_board_customer_team_id_fkey"
            columns: ["customer_team_id"]
            isOneToOne: false
            referencedRelation: "customer_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "target_board_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      team_build_players: {
        Row: {
          build_id: string
          created_at: string
          custom_name: string | null
          depth_order: number | null
          id: string
          nil_value: number | null
          player_id: string | null
          position_slot: string | null
          production_notes: string | null
          source: string
          updated_at: string
        }
        Insert: {
          build_id: string
          created_at?: string
          custom_name?: string | null
          depth_order?: number | null
          id?: string
          nil_value?: number | null
          player_id?: string | null
          position_slot?: string | null
          production_notes?: string | null
          source?: string
          updated_at?: string
        }
        Update: {
          build_id?: string
          created_at?: string
          custom_name?: string | null
          depth_order?: number | null
          id?: string
          nil_value?: number | null
          player_id?: string | null
          position_slot?: string | null
          production_notes?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_build_players_build_id_fkey"
            columns: ["build_id"]
            isOneToOne: false
            referencedRelation: "team_builds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_build_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      team_builds: {
        Row: {
          created_at: string
          customer_team_id: string | null
          id: string
          name: string
          notes: string | null
          season: number
          team: string
          total_budget: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          customer_team_id?: string | null
          id?: string
          name?: string
          notes?: string | null
          season?: number
          team: string
          total_budget?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          customer_team_id?: string | null
          id?: string
          name?: string
          notes?: string | null
          season?: number
          team?: string
          total_budget?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_builds_customer_team_id_fkey"
            columns: ["customer_team_id"]
            isOneToOne: false
            referencedRelation: "customer_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      "Teams Table": {
        Row: {
          abbreviation: string | null
          conference: string | null
          conference_id: string | null
          full_name: string
          id: string
          Mascot: string | null
          Season: number | null
          source_id: string | null
        }
        Insert: {
          abbreviation?: string | null
          conference?: string | null
          conference_id?: string | null
          full_name: string
          id?: string
          Mascot?: string | null
          Season?: number | null
          source_id?: string | null
        }
        Update: {
          abbreviation?: string | null
          conference?: string | null
          conference_id?: string | null
          full_name?: string
          id?: string
          Mascot?: string | null
          Season?: number | null
          source_id?: string | null
        }
        Relationships: []
      }
      temp_csv_players: {
        Row: {
          first_name: string
          last_name: string
        }
        Insert: {
          first_name: string
          last_name: string
        }
        Update: {
          first_name?: string
          last_name?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_team_access: {
        Row: {
          created_at: string
          created_by: string | null
          customer_team_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_team_id: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_team_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_team_access_customer_team_id_fkey"
            columns: ["customer_team_id"]
            isOneToOne: false
            referencedRelation: "customer_teams"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_team_admin_of: { Args: { _team_id: string }; Returns: boolean }
      is_team_member: { Args: { _team_id: string }; Returns: boolean }
      refresh_ncaa_sds: { Args: { target_season: number }; Returns: undefined }
      refresh_ncaa_sds_all: { Args: never; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "staff" | "scout" | "external" | "superadmin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["admin", "staff", "scout", "external", "superadmin"],
    },
  },
} as const
