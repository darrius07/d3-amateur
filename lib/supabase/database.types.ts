export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      clubs: {
        Row: {
          id: string;
          slug: string;
          official_name: string;
          display_name: string;
          short_name: string | null;
          city: string | null;
          postal_code: string | null;
          department_code: string | null;
          region_code: string | null;
          country_code: string;
          status: string;
          claim_status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          official_name: string;
          display_name: string;
          short_name?: string | null;
          city?: string | null;
          postal_code?: string | null;
          department_code?: string | null;
          region_code?: string | null;
          country_code?: string;
          status?: string;
          claim_status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          slug?: string;
          official_name?: string;
          display_name?: string;
          short_name?: string | null;
          city?: string | null;
          postal_code?: string | null;
          department_code?: string | null;
          region_code?: string | null;
          country_code?: string;
          status?: string;
          claim_status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      competitions: {
        Row: {
          id: string;
          name: string;
          short_name: string;
          competition_type: string;
          level: number | null;
          territory: string | null;
          organizer: string | null;
          gender: string;
          category: string;
          active: boolean;
        };
        Insert: {
          id?: string;
          name: string;
          short_name: string;
          competition_type: string;
          level?: number | null;
          territory?: string | null;
          organizer?: string | null;
          gender?: string;
          category?: string;
          active?: boolean;
        };
        Update: {
          id?: string;
          name?: string;
          short_name?: string;
          competition_type?: string;
          level?: number | null;
          territory?: string | null;
          organizer?: string | null;
          gender?: string;
          category?: string;
          active?: boolean;
        };
        Relationships: [];
      };
      competition_groups: {
        Row: {
          id: string;
          competition_season_id: string;
          name: string;
        };
        Insert: {
          id?: string;
          competition_season_id: string;
          name: string;
        };
        Update: {
          id?: string;
          competition_season_id?: string;
          name?: string;
        };
        Relationships: [];
      };
      competition_seasons: {
        Row: {
          id: string;
          competition_id: string;
          season_id: string;
          active: boolean;
        };
        Insert: {
          id?: string;
          competition_id: string;
          season_id: string;
          active?: boolean;
        };
        Update: {
          id?: string;
          competition_id?: string;
          season_id?: string;
          active?: boolean;
        };
        Relationships: [];
      };
      data_sources: {
        Row: {
          id: string;
          code: string;
          label: string;
          description: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          code: string;
          label: string;
          description?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          code?: string;
          label?: string;
          description?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      external_identities: {
        Row: {
          id: string;
          entity_type: string;
          entity_id: string;
          provider: string;
          external_id: string;
          metadata: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          entity_type: string;
          entity_id: string;
          provider: string;
          external_id: string;
          metadata?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          entity_type?: string;
          entity_id?: string;
          provider?: string;
          external_id?: string;
          metadata?: Json | null;
          created_at?: string;
        };
        Relationships: [];
      };
      seasons: {
        Row: {
          id: string;
          label: string;
          start_date: string;
          end_date: string;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          label: string;
          start_date: string;
          end_date: string;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          label?: string;
          start_date?: string;
          end_date?: string;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      team_seasons: {
        Row: {
          id: string;
          team_id: string;
          season_id: string;
          competition_season_id: string | null;
          group_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          team_id: string;
          season_id: string;
          competition_season_id?: string | null;
          group_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          team_id?: string;
          season_id?: string;
          competition_season_id?: string | null;
          group_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      teams: {
        Row: {
          id: string;
          club_id: string;
          display_name: string;
          team_rank: number | null;
          gender: string;
          category: string;
          football_format: string;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          club_id: string;
          display_name: string;
          team_rank?: number | null;
          gender: string;
          category: string;
          football_format: string;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          club_id?: string;
          display_name?: string;
          team_rank?: number | null;
          gender?: string;
          category?: string;
          football_format?: string;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_profiles: {
        Row: {
          id: string;
          display_name: string | null;
          d3_admin_role: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          d3_admin_role?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          display_name?: string | null;
          d3_admin_role?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      venues: {
        Row: {
          id: string;
          name: string;
          address: string | null;
          city: string | null;
          postal_code: string | null;
          latitude: number | null;
          longitude: number | null;
          data_es_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          address?: string | null;
          city?: string | null;
          postal_code?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          data_es_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          address?: string | null;
          city?: string | null;
          postal_code?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          data_es_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
