BEGIN;

-- ============================================================================
-- Step 6A: club profile & identity. club_profiles holds only EDITORIAL data
-- the OWNER explicitly chooses to publish -- never the canonical/Open Data
-- identity (official_name, RNA linkage, legal address), which stays on
-- `clubs` and has no write path here or anywhere else. display_name also
-- stays on `clubs` (it already existed, distinct from official_name since
-- the original foundation migration) -- update_club_profile below updates
-- it alongside the profile row in the same transaction, but never touches
-- official_name.
-- ============================================================================

CREATE TABLE public.club_profiles (
  club_id uuid PRIMARY KEY REFERENCES public.clubs(id) ON DELETE CASCADE,
  short_description text,
  long_description text,
  founded_year integer,
  primary_color text,
  secondary_color text,
  website_url text,
  facebook_url text,
  instagram_url text,
  x_url text,
  tiktok_url text,
  youtube_url text,
  -- Public contact is deliberately its own pair of columns, never a read of
  -- auth.users.email or club_memberships -- these exist ONLY when an OWNER
  -- explicitly types them here as information they want published (mission
  -- section 20/37: never silently reuse private/Auth/Claim data).
  public_email text,
  public_phone text,
  venue_name text,
  venue_address text,
  venue_postal_code text,
  venue_city text,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (short_description IS NULL OR length(short_description) <= 200),
  CHECK (long_description IS NULL OR length(long_description) <= 2000),
  CHECK (founded_year IS NULL OR founded_year BETWEEN 1850 AND extract(year FROM now())::int),
  CHECK (primary_color IS NULL OR primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  CHECK (secondary_color IS NULL OR secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  CHECK (public_email IS NULL OR public_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CHECK (venue_postal_code IS NULL OR venue_postal_code ~ '^[0-9]{4,10}$')
);

COMMENT ON TABLE public.club_profiles IS
  'Editorial club identity the OWNER chooses to publish -- never the canonical Open Data identity (clubs.official_name, RNA linkage), which has no write path here. One row per club, created on first save.';
COMMENT ON COLUMN public.club_profiles.public_email IS
  'Only ever set by an explicit OWNER input on this exact field -- never auto-filled from auth.users.email or Claim evidence.';

CREATE TRIGGER set_club_profiles_updated_at BEFORE UPDATE ON public.club_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Defense in depth for external URLs: https/http only, no javascript:/data:/
-- file:/arbitrary scheme. Used both as a table CHECK (so a bug elsewhere can
-- never insert something unsafe) and inside update_club_profile below.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_safe_external_url(url text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=''
AS $$ SELECT url IS NULL OR (url ~* '^https?://[^\s<>"'']{1,2048}$') $$;

ALTER TABLE public.club_profiles
  ADD CONSTRAINT club_profiles_website_url_safe CHECK (public.is_safe_external_url(website_url)),
  ADD CONSTRAINT club_profiles_facebook_url_safe CHECK (public.is_safe_external_url(facebook_url)),
  ADD CONSTRAINT club_profiles_instagram_url_safe CHECK (public.is_safe_external_url(instagram_url)),
  ADD CONSTRAINT club_profiles_x_url_safe CHECK (public.is_safe_external_url(x_url)),
  ADD CONSTRAINT club_profiles_tiktok_url_safe CHECK (public.is_safe_external_url(tiktok_url)),
  ADD CONSTRAINT club_profiles_youtube_url_safe CHECK (public.is_safe_external_url(youtube_url));

-- ----------------------------------------------------------------------------
-- update_club_profile: the only write path. One atomic transaction updates
-- clubs.display_name (if changed) and upserts club_profiles, then writes
-- granular-but-batched audit rows (mission section 36) -- never one row per
-- input field, only one per logical group that actually changed. Every text
-- field is normalized (trim, empty string -> NULL) here so the client never
-- has to guess NULL-handling; every value is still re-validated by the
-- CHECK constraints above regardless of what the client sent.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_club_profile(
  actor_id uuid,
  target_club_id uuid,
  p_display_name text,
  p_short_description text,
  p_long_description text,
  p_founded_year integer,
  p_primary_color text,
  p_secondary_color text,
  p_website_url text,
  p_facebook_url text,
  p_instagram_url text,
  p_x_url text,
  p_tiktok_url text,
  p_youtube_url text,
  p_public_email text,
  p_public_phone text,
  p_venue_name text,
  p_venue_address text,
  p_venue_postal_code text,
  p_venue_city text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  v_old_club public.clubs;
  v_old_profile public.club_profiles;
  v_display_name text := nullif(btrim(coalesce(p_display_name,'')),'');
  v_short_description text := nullif(btrim(coalesce(p_short_description,'')),'');
  v_long_description text := nullif(btrim(coalesce(p_long_description,'')),'');
  v_primary_color text := nullif(upper(btrim(coalesce(p_primary_color,''))),'');
  v_secondary_color text := nullif(upper(btrim(coalesce(p_secondary_color,''))),'');
  v_website_url text := nullif(btrim(coalesce(p_website_url,'')),'');
  v_facebook_url text := nullif(btrim(coalesce(p_facebook_url,'')),'');
  v_instagram_url text := nullif(btrim(coalesce(p_instagram_url,'')),'');
  v_x_url text := nullif(btrim(coalesce(p_x_url,'')),'');
  v_tiktok_url text := nullif(btrim(coalesce(p_tiktok_url,'')),'');
  v_youtube_url text := nullif(btrim(coalesce(p_youtube_url,'')),'');
  v_public_email text := nullif(lower(btrim(coalesce(p_public_email,''))),'');
  v_public_phone text := nullif(btrim(coalesce(p_public_phone,'')),'');
  v_venue_name text := nullif(btrim(coalesce(p_venue_name,'')),'');
  v_venue_address text := nullif(btrim(coalesce(p_venue_address,'')),'');
  v_venue_postal_code text := nullif(btrim(coalesce(p_venue_postal_code,'')),'');
  v_venue_city text := nullif(btrim(coalesce(p_venue_city,'')),'');
BEGIN
  IF NOT public.actor_can_manage_club(actor_id, target_club_id) THEN
    RAISE EXCEPTION 'Club OWNER required';
  END IF;

  SELECT * INTO v_old_club FROM public.clubs WHERE id = target_club_id;
  IF v_old_club.id IS NULL THEN RAISE EXCEPTION 'Club not found'; END IF;

  IF v_display_name IS NULL THEN RAISE EXCEPTION 'Le nom affiché est requis'; END IF;
  IF length(v_display_name) > 120 THEN RAISE EXCEPTION 'Nom affiché trop long (120 caractères maximum)'; END IF;

  SELECT * INTO v_old_profile FROM public.club_profiles WHERE club_id = target_club_id;

  IF v_old_club.display_name IS DISTINCT FROM v_display_name THEN
    UPDATE public.clubs SET display_name = v_display_name WHERE id = target_club_id;
    INSERT INTO public.admin_audit_logs(actor_user_id, action, entity_type, entity_id, details)
    VALUES (actor_id, 'display_name_changed', 'club', target_club_id,
      jsonb_build_object('before', v_old_club.display_name, 'after', v_display_name));
  END IF;

  INSERT INTO public.club_profiles(
    club_id, short_description, long_description, founded_year, primary_color, secondary_color,
    website_url, facebook_url, instagram_url, x_url, tiktok_url, youtube_url,
    public_email, public_phone, venue_name, venue_address, venue_postal_code, venue_city, updated_by
  ) VALUES (
    target_club_id, v_short_description, v_long_description, p_founded_year, v_primary_color, v_secondary_color,
    v_website_url, v_facebook_url, v_instagram_url, v_x_url, v_tiktok_url, v_youtube_url,
    v_public_email, v_public_phone, v_venue_name, v_venue_address, v_venue_postal_code, v_venue_city, actor_id
  )
  ON CONFLICT (club_id) DO UPDATE SET
    short_description = EXCLUDED.short_description,
    long_description = EXCLUDED.long_description,
    founded_year = EXCLUDED.founded_year,
    primary_color = EXCLUDED.primary_color,
    secondary_color = EXCLUDED.secondary_color,
    website_url = EXCLUDED.website_url,
    facebook_url = EXCLUDED.facebook_url,
    instagram_url = EXCLUDED.instagram_url,
    x_url = EXCLUDED.x_url,
    tiktok_url = EXCLUDED.tiktok_url,
    youtube_url = EXCLUDED.youtube_url,
    public_email = EXCLUDED.public_email,
    public_phone = EXCLUDED.public_phone,
    venue_name = EXCLUDED.venue_name,
    venue_address = EXCLUDED.venue_address,
    venue_postal_code = EXCLUDED.venue_postal_code,
    venue_city = EXCLUDED.venue_city,
    updated_by = actor_id,
    updated_at = now();

  IF v_old_profile.short_description IS DISTINCT FROM v_short_description
     OR v_old_profile.long_description IS DISTINCT FROM v_long_description
     OR v_old_profile.founded_year IS DISTINCT FROM p_founded_year THEN
    INSERT INTO public.admin_audit_logs(actor_user_id, action, entity_type, entity_id, details) VALUES (
      actor_id, 'profile_updated', 'club', target_club_id,
      jsonb_build_object(
        'before', jsonb_build_object('short_description', v_old_profile.short_description, 'long_description', v_old_profile.long_description, 'founded_year', v_old_profile.founded_year),
        'after', jsonb_build_object('short_description', v_short_description, 'long_description', v_long_description, 'founded_year', p_founded_year)
      ));
  END IF;

  IF v_old_profile.primary_color IS DISTINCT FROM v_primary_color OR v_old_profile.secondary_color IS DISTINCT FROM v_secondary_color THEN
    INSERT INTO public.admin_audit_logs(actor_user_id, action, entity_type, entity_id, details) VALUES (
      actor_id, 'club_colors_changed', 'club', target_club_id,
      jsonb_build_object(
        'before', jsonb_build_object('primary_color', v_old_profile.primary_color, 'secondary_color', v_old_profile.secondary_color),
        'after', jsonb_build_object('primary_color', v_primary_color, 'secondary_color', v_secondary_color)
      ));
  END IF;

  IF v_old_profile.website_url IS DISTINCT FROM v_website_url OR v_old_profile.facebook_url IS DISTINCT FROM v_facebook_url
     OR v_old_profile.instagram_url IS DISTINCT FROM v_instagram_url OR v_old_profile.x_url IS DISTINCT FROM v_x_url
     OR v_old_profile.tiktok_url IS DISTINCT FROM v_tiktok_url OR v_old_profile.youtube_url IS DISTINCT FROM v_youtube_url THEN
    INSERT INTO public.admin_audit_logs(actor_user_id, action, entity_type, entity_id, details) VALUES (
      actor_id, 'social_links_changed', 'club', target_club_id,
      jsonb_build_object(
        'before', jsonb_build_object('website_url', v_old_profile.website_url, 'facebook_url', v_old_profile.facebook_url, 'instagram_url', v_old_profile.instagram_url, 'x_url', v_old_profile.x_url, 'tiktok_url', v_old_profile.tiktok_url, 'youtube_url', v_old_profile.youtube_url),
        'after', jsonb_build_object('website_url', v_website_url, 'facebook_url', v_facebook_url, 'instagram_url', v_instagram_url, 'x_url', v_x_url, 'tiktok_url', v_tiktok_url, 'youtube_url', v_youtube_url)
      ));
  END IF;

  IF v_old_profile.public_email IS DISTINCT FROM v_public_email OR v_old_profile.public_phone IS DISTINCT FROM v_public_phone THEN
    INSERT INTO public.admin_audit_logs(actor_user_id, action, entity_type, entity_id, details) VALUES (
      actor_id, 'public_contact_changed', 'club', target_club_id,
      jsonb_build_object(
        'before', jsonb_build_object('public_email', v_old_profile.public_email, 'public_phone', v_old_profile.public_phone),
        'after', jsonb_build_object('public_email', v_public_email, 'public_phone', v_public_phone)
      ));
  END IF;

  IF v_old_profile.venue_name IS DISTINCT FROM v_venue_name OR v_old_profile.venue_address IS DISTINCT FROM v_venue_address
     OR v_old_profile.venue_postal_code IS DISTINCT FROM v_venue_postal_code OR v_old_profile.venue_city IS DISTINCT FROM v_venue_city THEN
    INSERT INTO public.admin_audit_logs(actor_user_id, action, entity_type, entity_id, details) VALUES (
      actor_id, 'venue_changed', 'club', target_club_id,
      jsonb_build_object(
        'before', jsonb_build_object('venue_name', v_old_profile.venue_name, 'venue_address', v_old_profile.venue_address, 'venue_postal_code', v_old_profile.venue_postal_code, 'venue_city', v_old_profile.venue_city),
        'after', jsonb_build_object('venue_name', v_venue_name, 'venue_address', v_venue_address, 'venue_postal_code', v_venue_postal_code, 'venue_city', v_venue_city)
      ));
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.update_club_profile(uuid,uuid,text,text,text,integer,text,text,text,text,text,text,text,text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_club_profile(uuid,uuid,text,text,text,integer,text,text,text,text,text,text,text,text,text,text,text,text,text,text) TO service_role;

-- ----------------------------------------------------------------------------
-- RLS: public read (the whole point is a public showcase), no direct write
-- grant for anon/authenticated -- update_club_profile (service_role only)
-- is the sole write path.
-- ----------------------------------------------------------------------------

ALTER TABLE public.club_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY club_profiles_public_read ON public.club_profiles FOR SELECT USING (true);
GRANT SELECT ON public.club_profiles TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.club_profiles FROM anon, authenticated;

COMMIT;
