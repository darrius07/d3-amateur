BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE ROLE d3_admin NOLOGIN;

CREATE TABLE IF NOT EXISTS public.user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  d3_admin_role text CHECK (d3_admin_role IN ('superadmin', 'moderator')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.is_d3_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.d3_admin_role IS NOT NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, display_name, d3_admin_role, created_at, updated_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    NULL,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        updated_at = NOW();

  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL UNIQUE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS public.clubs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  official_name text NOT NULL,
  display_name text NOT NULL,
  short_name text,
  city text,
  postal_code text,
  department_code text,
  region_code text,
  country_code text NOT NULL DEFAULT 'FR',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending')),
  claim_status text NOT NULL DEFAULT 'unclaimed' CHECK (claim_status IN ('unclaimed', 'pending', 'claimed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  team_rank integer,
  gender text NOT NULL CHECK (gender IN ('male', 'female', 'mixed')),
  category text NOT NULL,
  football_format text NOT NULL CHECK (football_format IN ('11', '7', '5', 'futsal')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.competitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  short_name text NOT NULL,
  competition_type text NOT NULL,
  level integer,
  territory text,
  organizer text,
  gender text NOT NULL CHECK (gender IN ('male', 'female', 'mixed')),
  category text NOT NULL,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.competition_seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (competition_id, season_id)
);

CREATE TABLE IF NOT EXISTS public.competition_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_season_id uuid NOT NULL REFERENCES public.competition_seasons(id) ON DELETE CASCADE,
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.team_seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  competition_season_id uuid REFERENCES public.competition_seasons(id) ON DELETE SET NULL,
  group_id uuid REFERENCES public.competition_groups(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, season_id)
);

CREATE TABLE IF NOT EXISTS public.venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  city text,
  postal_code text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  data_es_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (latitude BETWEEN -90 AND 90),
  CHECK (longitude BETWEEN -180 AND 180)
);

CREATE TABLE IF NOT EXISTS public.data_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.external_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  provider text NOT NULL,
  external_id text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, entity_type, external_id)
);

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_user_profiles_updated_at
BEFORE UPDATE ON public.user_profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_seasons_updated_at
BEFORE UPDATE ON public.seasons
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_clubs_updated_at
BEFORE UPDATE ON public.clubs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_teams_updated_at
BEFORE UPDATE ON public.teams
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_venues_updated_at
BEFORE UPDATE ON public.venues
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS clubs_slug_idx ON public.clubs (slug);
CREATE INDEX IF NOT EXISTS clubs_official_name_idx ON public.clubs (official_name);
CREATE INDEX IF NOT EXISTS clubs_display_name_idx ON public.clubs (display_name);
CREATE INDEX IF NOT EXISTS clubs_display_name_trgm_idx ON public.clubs USING gin (display_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS clubs_official_name_trgm_idx ON public.clubs USING gin (official_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS teams_club_id_idx ON public.teams (club_id);
CREATE INDEX IF NOT EXISTS competition_seasons_season_idx ON public.competition_seasons (season_id);
CREATE INDEX IF NOT EXISTS team_seasons_season_idx ON public.team_seasons (season_id);
CREATE INDEX IF NOT EXISTS venues_city_idx ON public.venues (city);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_identities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_profiles_select_own"
ON public.user_profiles FOR SELECT
USING (auth.uid() = id);

CREATE POLICY "user_profiles_insert_own"
ON public.user_profiles FOR INSERT
WITH CHECK (auth.uid() = id);

CREATE POLICY "user_profiles_update_own"
ON public.user_profiles FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

CREATE POLICY "user_profiles_admin_full"
ON public.user_profiles FOR ALL
USING (public.is_d3_admin())
WITH CHECK (public.is_d3_admin());

CREATE POLICY "seasons_select_public"
ON public.seasons FOR SELECT
USING (true);

CREATE POLICY "seasons_admin_manage"
ON public.seasons FOR ALL
USING (public.is_d3_admin())
WITH CHECK (public.is_d3_admin());

CREATE POLICY "clubs_select_public"
ON public.clubs FOR SELECT
USING (true);

CREATE POLICY "clubs_admin_manage"
ON public.clubs FOR ALL
USING (public.is_d3_admin())
WITH CHECK (public.is_d3_admin());

CREATE POLICY "teams_select_public"
ON public.teams FOR SELECT
USING (true);

CREATE POLICY "teams_admin_manage"
ON public.teams FOR ALL
USING (public.is_d3_admin())
WITH CHECK (public.is_d3_admin());

CREATE POLICY "competitions_select_public"
ON public.competitions FOR SELECT
USING (true);

CREATE POLICY "competitions_admin_manage"
ON public.competitions FOR ALL
USING (public.is_d3_admin())
WITH CHECK (public.is_d3_admin());

CREATE POLICY "competition_seasons_select_public"
ON public.competition_seasons FOR SELECT
USING (true);

CREATE POLICY "competition_seasons_admin_manage"
ON public.competition_seasons FOR ALL
USING (public.is_d3_admin())
WITH CHECK (public.is_d3_admin());

CREATE POLICY "competition_groups_select_public"
ON public.competition_groups FOR SELECT
USING (true);

CREATE POLICY "competition_groups_admin_manage"
ON public.competition_groups FOR ALL
USING (public.is_d3_admin())
WITH CHECK (public.is_d3_admin());

CREATE POLICY "team_seasons_select_public"
ON public.team_seasons FOR SELECT
USING (true);

CREATE POLICY "team_seasons_admin_manage"
ON public.team_seasons FOR ALL
USING (public.is_d3_admin())
WITH CHECK (public.is_d3_admin());

CREATE POLICY "venues_select_public"
ON public.venues FOR SELECT
USING (true);

CREATE POLICY "venues_admin_manage"
ON public.venues FOR ALL
USING (public.is_d3_admin())
WITH CHECK (public.is_d3_admin());

CREATE POLICY "data_sources_select_admin"
ON public.data_sources FOR SELECT
USING (public.is_d3_admin() OR auth.role() = 'authenticated');

CREATE POLICY "data_sources_admin_manage"
ON public.data_sources FOR ALL
USING (public.is_d3_admin())
WITH CHECK (public.is_d3_admin());

CREATE POLICY "external_identities_admin_select"
ON public.external_identities FOR SELECT
USING (public.is_d3_admin());

CREATE POLICY "external_identities_admin_manage"
ON public.external_identities FOR ALL
USING (public.is_d3_admin())
WITH CHECK (public.is_d3_admin());

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.user_profiles TO authenticated;
GRANT SELECT ON public.seasons TO anon, authenticated;
GRANT SELECT ON public.clubs TO anon, authenticated;
GRANT SELECT ON public.teams TO anon, authenticated;
GRANT SELECT ON public.competitions TO anon, authenticated;
GRANT SELECT ON public.competition_seasons TO anon, authenticated;
GRANT SELECT ON public.competition_groups TO anon, authenticated;
GRANT SELECT ON public.team_seasons TO anon, authenticated;
GRANT SELECT ON public.venues TO anon, authenticated;
GRANT SELECT ON public.data_sources TO anon, authenticated;
GRANT SELECT ON public.external_identities TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.user_profiles TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.seasons TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.clubs TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.teams TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.competitions TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.competition_seasons TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.competition_groups TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.team_seasons TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.venues TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.data_sources TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.external_identities TO authenticated;

INSERT INTO public.data_sources (code, label, description)
VALUES
  ('D3_ADMIN', 'D3 Admin', 'D3 Amateur platform administration source'),
  ('CLUB', 'Club', 'Club-provided operational data'),
  ('PLAYER', 'Player', 'Player-provided profile data'),
  ('RNA', 'RNA', 'French register of associations data'),
  ('DATA_ES', 'Data ES', 'Data ES import source')
ON CONFLICT (code) DO NOTHING;

COMMIT;
