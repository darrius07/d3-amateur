BEGIN;

-- ============================================================================
-- Step 6C: club sponsors. Two tables, not one: `sponsors` is the reusable
-- entity (a real business can one day sponsor more than one club --
-- mission section 4), `club_sponsors` is the per-club relationship (tier,
-- visibility, its own uploaded logo copy, audit trail). Splitting them now
-- costs nothing and avoids a painful migration later; a single flat table
-- would have conflated "this business" with "this club's arrangement with
-- it". Each club_sponsors row keeps its OWN logo_path rather than sharing
-- one asset across every club that sponsor might someday support -- that
-- sidesteps a much harder shared-mutable-asset ownership question (which
-- club may replace a logo used by another club's row?) for a case this
-- step's UI doesn't even expose yet (there is no "link an existing
-- sponsor" flow -- add_club_sponsor always creates both rows together).
--
-- A sponsor here is a "Partenaire du club" -- never a D3 advertising
-- product. No impressions/reach/CTR/media-value column exists anywhere in
-- this schema, on purpose (mission section 6).
-- ============================================================================

CREATE TABLE public.sponsors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  website_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(btrim(name)) > 0 AND length(name) <= 120),
  CHECK (public.is_safe_external_url(website_url))
);

COMMENT ON TABLE public.sponsors IS
  'Reusable sponsor identity -- name + optional website. Never exposed directly to anon/authenticated (a sponsor a club has not yet made public must not leak here); only reachable through sponsors_public, which already filters on the owning club_sponsors row''s visibility.';

CREATE TRIGGER set_sponsors_updated_at BEFORE UPDATE ON public.sponsors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TYPE public.sponsor_tier AS ENUM ('MAIN','PREMIUM','PARTNER','SUPPORTER','OTHER');

CREATE TABLE public.club_sponsors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  sponsor_id uuid NOT NULL REFERENCES public.sponsors(id) ON DELETE CASCADE,
  tier public.sponsor_tier NOT NULL,
  -- Required (non-empty) when tier='OTHER', NULL otherwise -- mirrors
  -- club_staff's role_type/custom_role pattern exactly (mission section 5).
  -- These tiers are a presentation choice the club makes, never a paid D3
  -- offering (mission section 5/6).
  custom_tier_label text,
  logo_path text,
  public_visible boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  short_message text,
  source_id uuid REFERENCES public.data_sources(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (short_message IS NULL OR length(short_message) <= 160),
  CHECK (
    (tier = 'OTHER' AND custom_tier_label IS NOT NULL AND length(btrim(custom_tier_label)) > 0)
    OR (tier <> 'OTHER' AND custom_tier_label IS NULL)
  )
);

COMMENT ON TABLE public.club_sponsors IS
  'One club''s relationship with one sponsor: tier, visibility, its own logo, audit trail. Never grants any D3 advertising product -- no impressions/reach/CTR/media-value column exists here.';

CREATE INDEX club_sponsors_club_idx ON public.club_sponsors(club_id);
CREATE INDEX club_sponsors_sponsor_idx ON public.club_sponsors(sponsor_id);

CREATE TRIGGER set_club_sponsors_updated_at BEFORE UPDATE ON public.club_sponsors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Mutations. Same established pattern: SECURITY DEFINER, explicit actor_id,
-- actor_can_manage_club() authorization, granted only to service_role.
-- add_club_sponsor creates the sponsors row and the club_sponsors row
-- together in one transaction (no "pick an existing sponsor" UI exists in
-- this step, so there is nothing to look up).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.add_club_sponsor(
  actor_id uuid,
  target_club_id uuid,
  p_name text,
  p_website_url text,
  p_tier public.sponsor_tier,
  p_custom_tier_label text,
  p_short_message text,
  p_public_visible boolean
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  v_name text := btrim(coalesce(p_name,''));
  v_website text := nullif(btrim(coalesce(p_website_url,'')),'');
  v_custom_tier text := nullif(btrim(coalesce(p_custom_tier_label,'')),'');
  v_short_message text := nullif(btrim(coalesce(p_short_message,'')),'');
  v_source uuid;
  v_sponsor_id uuid;
  v_id uuid;
BEGIN
  IF NOT public.actor_can_manage_club(actor_id, target_club_id) THEN
    RAISE EXCEPTION 'Club OWNER required';
  END IF;
  IF length(v_name) = 0 THEN RAISE EXCEPTION 'Le nom du partenaire est requis'; END IF;
  IF p_tier <> 'OTHER' THEN v_custom_tier := NULL; END IF;
  IF p_tier = 'OTHER' AND v_custom_tier IS NULL THEN RAISE EXCEPTION 'Précisez le niveau pour "Autre"'; END IF;

  SELECT id INTO v_source FROM public.data_sources WHERE code = 'CLUB';

  INSERT INTO public.sponsors(name, website_url) VALUES (v_name, v_website) RETURNING id INTO v_sponsor_id;

  INSERT INTO public.club_sponsors(
    club_id, sponsor_id, tier, custom_tier_label, short_message, public_visible, sort_order, source_id, created_by
  ) VALUES (
    target_club_id, v_sponsor_id, p_tier, v_custom_tier, v_short_message, coalesce(p_public_visible, false),
    CASE p_tier WHEN 'MAIN' THEN 10 WHEN 'PREMIUM' THEN 20 WHEN 'PARTNER' THEN 30 WHEN 'SUPPORTER' THEN 40 ELSE 90 END,
    v_source, actor_id
  ) RETURNING id INTO v_id;

  INSERT INTO public.admin_audit_logs(actor_user_id, action, entity_type, entity_id, details)
  VALUES (actor_id, 'sponsor_created', 'club_sponsor', v_id, jsonb_build_object(
    'club_id', target_club_id, 'sponsor_id', v_sponsor_id, 'name', v_name, 'tier', p_tier,
    'custom_tier_label', v_custom_tier, 'public_visible', coalesce(p_public_visible, false)
  ));

  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.update_club_sponsor(
  actor_id uuid,
  p_club_sponsor_id uuid,
  p_name text,
  p_website_url text,
  p_tier public.sponsor_tier,
  p_custom_tier_label text,
  p_short_message text,
  p_public_visible boolean,
  p_sort_order integer
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  v_old public.club_sponsors;
  v_old_sponsor public.sponsors;
  v_name text := btrim(coalesce(p_name,''));
  v_website text := nullif(btrim(coalesce(p_website_url,'')),'');
  v_custom_tier text := nullif(btrim(coalesce(p_custom_tier_label,'')),'');
  v_short_message text := nullif(btrim(coalesce(p_short_message,'')),'');
BEGIN
  SELECT * INTO v_old FROM public.club_sponsors WHERE id = p_club_sponsor_id;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'Sponsor not found'; END IF;
  IF NOT public.actor_can_manage_club(actor_id, v_old.club_id) THEN
    RAISE EXCEPTION 'Club OWNER required';
  END IF;
  IF length(v_name) = 0 THEN RAISE EXCEPTION 'Le nom du partenaire est requis'; END IF;
  IF p_tier <> 'OTHER' THEN v_custom_tier := NULL; END IF;
  IF p_tier = 'OTHER' AND v_custom_tier IS NULL THEN RAISE EXCEPTION 'Précisez le niveau pour "Autre"'; END IF;

  SELECT * INTO v_old_sponsor FROM public.sponsors WHERE id = v_old.sponsor_id;
  UPDATE public.sponsors SET name = v_name, website_url = v_website WHERE id = v_old.sponsor_id;

  UPDATE public.club_sponsors SET
    tier = p_tier, custom_tier_label = v_custom_tier, short_message = v_short_message,
    public_visible = coalesce(p_public_visible, false), sort_order = coalesce(p_sort_order, sort_order)
  WHERE id = p_club_sponsor_id;

  IF v_old_sponsor.name IS DISTINCT FROM v_name OR v_old_sponsor.website_url IS DISTINCT FROM v_website
     OR v_old.short_message IS DISTINCT FROM v_short_message THEN
    INSERT INTO public.admin_audit_logs(actor_user_id, action, entity_type, entity_id, details) VALUES (
      actor_id, 'sponsor_updated', 'club_sponsor', p_club_sponsor_id,
      jsonb_build_object(
        'before', jsonb_build_object('name', v_old_sponsor.name, 'website_url', v_old_sponsor.website_url, 'short_message', v_old.short_message),
        'after', jsonb_build_object('name', v_name, 'website_url', v_website, 'short_message', v_short_message)
      ));
  END IF;

  IF v_old.public_visible IS DISTINCT FROM coalesce(p_public_visible, false) THEN
    INSERT INTO public.admin_audit_logs(actor_user_id, action, entity_type, entity_id, details) VALUES (
      actor_id, 'sponsor_visibility_changed', 'club_sponsor', p_club_sponsor_id,
      jsonb_build_object('before', v_old.public_visible, 'after', coalesce(p_public_visible, false)));
  END IF;

  IF v_old.tier IS DISTINCT FROM p_tier OR v_old.custom_tier_label IS DISTINCT FROM v_custom_tier THEN
    INSERT INTO public.admin_audit_logs(actor_user_id, action, entity_type, entity_id, details) VALUES (
      actor_id, 'sponsor_tier_changed', 'club_sponsor', p_club_sponsor_id,
      jsonb_build_object('before', jsonb_build_object('tier', v_old.tier, 'custom_tier_label', v_old.custom_tier_label), 'after', jsonb_build_object('tier', p_tier, 'custom_tier_label', v_custom_tier)));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.deactivate_club_sponsor(actor_id uuid, p_club_sponsor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_old public.club_sponsors;
BEGIN
  SELECT * INTO v_old FROM public.club_sponsors WHERE id = p_club_sponsor_id;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'Sponsor not found'; END IF;
  IF NOT public.actor_can_manage_club(actor_id, v_old.club_id) THEN
    RAISE EXCEPTION 'Club OWNER required';
  END IF;
  UPDATE public.club_sponsors SET active = false WHERE id = p_club_sponsor_id;
  INSERT INTO public.admin_audit_logs(actor_user_id, action, entity_type, entity_id, details)
  VALUES (actor_id, 'sponsor_deactivated', 'club_sponsor', p_club_sponsor_id, jsonb_build_object('club_id', v_old.club_id));
END $$;

-- Logo path bookkeeping only -- the actual Storage upload/delete happens
-- server-side (service_role) in the Next.js server action, exactly like
-- Step 3's uploadClubLogo/deleteClubLogo. This RPC just re-validates
-- ownership and records the new path + a granular audit row, the same
-- division of responsibility already established for club logos.
CREATE OR REPLACE FUNCTION public.set_club_sponsor_logo(actor_id uuid, p_club_sponsor_id uuid, p_logo_path text, p_action text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_old public.club_sponsors;
BEGIN
  SELECT * INTO v_old FROM public.club_sponsors WHERE id = p_club_sponsor_id;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'Sponsor not found'; END IF;
  IF NOT public.actor_can_manage_club(actor_id, v_old.club_id) THEN
    RAISE EXCEPTION 'Club OWNER required';
  END IF;
  IF p_action NOT IN ('sponsor_logo_uploaded','sponsor_logo_replaced','sponsor_logo_deleted') THEN
    RAISE EXCEPTION 'Invalid action';
  END IF;
  UPDATE public.club_sponsors SET logo_path = p_logo_path WHERE id = p_club_sponsor_id;
  INSERT INTO public.admin_audit_logs(actor_user_id, action, entity_type, entity_id, details)
  VALUES (actor_id, p_action, 'club_sponsor', p_club_sponsor_id, jsonb_build_object('before', v_old.logo_path, 'after', p_logo_path));
END $$;

REVOKE ALL ON FUNCTION public.add_club_sponsor(uuid,uuid,text,text,public.sponsor_tier,text,text,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_club_sponsor(uuid,uuid,text,text,public.sponsor_tier,text,text,boolean,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.deactivate_club_sponsor(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.set_club_sponsor_logo(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.add_club_sponsor(uuid,uuid,text,text,public.sponsor_tier,text,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_club_sponsor(uuid,uuid,text,text,public.sponsor_tier,text,text,boolean,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.deactivate_club_sponsor(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_club_sponsor_logo(uuid,uuid,text,text) TO service_role;

-- ----------------------------------------------------------------------------
-- RLS / public surface. Same discipline as club_profiles/club_staff: base
-- tables never directly readable by anon/authenticated (created_by,
-- source_id are internal, and a not-yet-public sponsor's name must never
-- leak via a bare `sponsors` join either) -- only sponsors_public (plain,
-- non-security_invoker view) exposes the safe subset, only for rows that
-- are both active and explicitly public_visible.
-- ----------------------------------------------------------------------------

ALTER TABLE public.sponsors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_sponsors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sponsors FROM anon, authenticated;
REVOKE ALL ON public.club_sponsors FROM anon, authenticated;

CREATE VIEW public.sponsors_public AS
SELECT cs.id, cs.club_id, s.name, cs.tier, cs.custom_tier_label, cs.logo_path, s.website_url, cs.short_message, cs.sort_order
FROM public.club_sponsors cs
JOIN public.sponsors s ON s.id = cs.sponsor_id
WHERE cs.active = true AND cs.public_visible = true;

COMMENT ON VIEW public.sponsors_public IS
  'The only sponsor read surface for anon/authenticated: active AND public_visible club_sponsors rows only, joined to the sponsor''s name/website, safe columns only (no created_by/source_id/active/public_visible/timestamps/sponsor.id).';

GRANT SELECT ON public.sponsors_public TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- Storage: sponsor-assets, private bucket + server-side signed URLs at
-- render time (mission section 12) -- the exact same architecture as
-- club-assets (Step 3), for the same reason: logo_path stored in DB is
-- permanent and never expires, whereas a stored signed URL would. Path
-- convention sponsors/{club_id}/{club_sponsor_id}/{filename} (mission
-- section 10) lets the RLS policies below key authorization off segment
-- [2] (club_id) alone via has_active_club_role -- same mechanism as
-- club_assets_owner_*. The app's own server actions use the service_role
-- admin client (bypassing these policies entirely, same as
-- uploadClubLogo/deleteClubLogo) and re-check ownership themselves before
-- ever touching Storage; these policies are defense-in-depth against a
-- client hitting the Storage API directly with their own session.
-- ----------------------------------------------------------------------------

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('sponsor-assets','sponsor-assets',false,5242880,ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=5242880,allowed_mime_types=EXCLUDED.allowed_mime_types;

CREATE POLICY sponsor_assets_owner_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK(bucket_id='sponsor-assets' AND (storage.foldername(name))[1]='sponsors'
  AND public.has_active_club_role(((storage.foldername(name))[2])::uuid,ARRAY['OWNER']::public.club_membership_role[]));
CREATE POLICY sponsor_assets_owner_select ON storage.objects FOR SELECT TO authenticated
USING(bucket_id='sponsor-assets' AND (storage.foldername(name))[1]='sponsors'
  AND public.has_active_club_role(((storage.foldername(name))[2])::uuid,ARRAY['OWNER']::public.club_membership_role[]));
CREATE POLICY sponsor_assets_owner_update ON storage.objects FOR UPDATE TO authenticated
USING(bucket_id='sponsor-assets' AND (storage.foldername(name))[1]='sponsors'
  AND public.has_active_club_role(((storage.foldername(name))[2])::uuid,ARRAY['OWNER']::public.club_membership_role[]))
WITH CHECK(bucket_id='sponsor-assets' AND (storage.foldername(name))[1]='sponsors'
  AND public.has_active_club_role(((storage.foldername(name))[2])::uuid,ARRAY['OWNER']::public.club_membership_role[]));
CREATE POLICY sponsor_assets_owner_delete ON storage.objects FOR DELETE TO authenticated
USING(bucket_id='sponsor-assets' AND (storage.foldername(name))[1]='sponsors'
  AND public.has_active_club_role(((storage.foldername(name))[2])::uuid,ARRAY['OWNER']::public.club_membership_role[]));

COMMIT;
