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
  public: {
    Tables: {
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
      conference_stats: {
        Row: {
          avg: number | null
          avg_plus: number | null
          barrel_score: number | null
          chase_score: number | null
          conference: string
          created_at: string
          ev_score: number | null
          id: string
          iso: number | null
          iso_plus: number | null
          obp: number | null
          obp_plus: number | null
          offensive_power_rating: number | null
          ops: number | null
          ops_plus: number | null
          season: number
          slg: number | null
          slg_plus: number | null
          stuff_plus: number | null
          updated_at: string
          whiff_score: number | null
          wrc: number | null
          wrc_plus: number | null
        }
        Insert: {
          avg?: number | null
          avg_plus?: number | null
          barrel_score?: number | null
          chase_score?: number | null
          conference: string
          created_at?: string
          ev_score?: number | null
          id?: string
          iso?: number | null
          iso_plus?: number | null
          obp?: number | null
          obp_plus?: number | null
          offensive_power_rating?: number | null
          ops?: number | null
          ops_plus?: number | null
          season: number
          slg?: number | null
          slg_plus?: number | null
          stuff_plus?: number | null
          updated_at?: string
          whiff_score?: number | null
          wrc?: number | null
          wrc_plus?: number | null
        }
        Update: {
          avg?: number | null
          avg_plus?: number | null
          barrel_score?: number | null
          chase_score?: number | null
          conference?: string
          created_at?: string
          ev_score?: number | null
          id?: string
          iso?: number | null
          iso_plus?: number | null
          obp?: number | null
          obp_plus?: number | null
          offensive_power_rating?: number | null
          ops?: number | null
          ops_plus?: number | null
          season?: number
          slg?: number | null
          slg_plus?: number | null
          stuff_plus?: number | null
          updated_at?: string
          whiff_score?: number | null
          wrc?: number | null
          wrc_plus?: number | null
        }
        Relationships: []
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
      player_predictions: {
        Row: {
          barrel_score: number | null
          chase_score: number | null
          class_transition: string | null
          created_at: string
          dev_aggressiveness: number | null
          ev_score: number | null
          from_avg: number | null
          from_avg_plus: number | null
          from_obp: number | null
          from_obp_plus: number | null
          from_park_factor: number | null
          from_slg: number | null
          from_slg_plus: number | null
          from_stuff_plus: number | null
          id: string
          model_type: string
          p_avg: number | null
          p_iso: number | null
          p_obp: number | null
          p_ops: number | null
          p_slg: number | null
          p_wrc: number | null
          p_wrc_plus: number | null
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
          created_at?: string
          dev_aggressiveness?: number | null
          ev_score?: number | null
          from_avg?: number | null
          from_avg_plus?: number | null
          from_obp?: number | null
          from_obp_plus?: number | null
          from_park_factor?: number | null
          from_slg?: number | null
          from_slg_plus?: number | null
          from_stuff_plus?: number | null
          id?: string
          model_type: string
          p_avg?: number | null
          p_iso?: number | null
          p_obp?: number | null
          p_ops?: number | null
          p_slg?: number | null
          p_wrc?: number | null
          p_wrc_plus?: number | null
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
          created_at?: string
          dev_aggressiveness?: number | null
          ev_score?: number | null
          from_avg?: number | null
          from_avg_plus?: number | null
          from_obp?: number | null
          from_obp_plus?: number | null
          from_park_factor?: number | null
          from_slg?: number | null
          from_slg_plus?: number | null
          from_stuff_plus?: number | null
          id?: string
          model_type?: string
          p_avg?: number | null
          p_iso?: number | null
          p_obp?: number | null
          p_ops?: number | null
          p_slg?: number | null
          p_wrc?: number | null
          p_wrc_plus?: number | null
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
          class_year: string | null
          conference: string | null
          created_at: string
          first_name: string
          handedness: string | null
          headshot_url: string | null
          height_inches: number | null
          high_school: string | null
          home_state: string | null
          id: string
          last_name: string
          notes: string | null
          portal_entry_date: string | null
          position: string | null
          team: string | null
          transfer_portal: boolean
          updated_at: string
          weight: number | null
        }
        Insert: {
          class_year?: string | null
          conference?: string | null
          created_at?: string
          first_name: string
          handedness?: string | null
          headshot_url?: string | null
          height_inches?: number | null
          high_school?: string | null
          home_state?: string | null
          id?: string
          last_name: string
          notes?: string | null
          portal_entry_date?: string | null
          position?: string | null
          team?: string | null
          transfer_portal?: boolean
          updated_at?: string
          weight?: number | null
        }
        Update: {
          class_year?: string | null
          conference?: string | null
          created_at?: string
          first_name?: string
          handedness?: string | null
          headshot_url?: string | null
          height_inches?: number | null
          high_school?: string | null
          home_state?: string | null
          id?: string
          last_name?: string
          notes?: string | null
          portal_entry_date?: string | null
          position?: string | null
          team?: string | null
          transfer_portal?: boolean
          updated_at?: string
          weight?: number | null
        }
        Relationships: []
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
      teams: {
        Row: {
          conference: string | null
          created_at: string
          division: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          conference?: string | null
          created_at?: string
          division?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          conference?: string | null
          created_at?: string
          division?: string | null
          id?: string
          name?: string
          updated_at?: string
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
    }
    Enums: {
      app_role: "admin" | "staff" | "scout" | "external"
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
  public: {
    Enums: {
      app_role: ["admin", "staff", "scout", "external"],
    },
  },
} as const
