BEGIN;

-- ============================================================================
-- Step 6B: club staff. club_staff is a PUBLIC-DISPLAY concept only -- it
-- never grants any application permission (mission section 5). A row here
-- creates no auth.users account, no club_memberships row, no OWNER/ADMIN
-- access. Conversely a real OWNER is never auto-listed as staff. The two
-- concepts share nothing but a club_id.
-- ============================================================================

CREATE TYPE public.club_staff_role AS ENUM (
  'PRESIDENT','HEAD_COACH','ASSISTANT_COACH','SPORTING_DIRECTOR',
  'GOALKEEPER_COACH','TEAM_MANAGER','PHYSIO','COMMUNICATION','OTHER'
);

CREATE TABLE public.club_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  -- NULL = club-wide (Président, Directeur sportif, Communication...).
  -- Non-NULL = attached to one specific team (Coach Seniors A...). Checked
  -- against club_id by the trigger below -- a team from another club can
  -- never be referenced (mission section 25).
  team_season_id uuid REFERENCES public.team_seasons(id) ON DELETE SET NULL,
  display_name text NOT NULL,
  role_type public.club_staff_role NOT NULL,
  -- Required (non-empty) when role_type='OTHER', NULL otherwise -- enforced
  -- by the CHECK below, mission section 6.
  custom_role text,
  -- Data minimisation (mission section 8): display name, role, team, and an
  -- optional short bio are the ONLY fields this table ever holds. No
  -- personal email/phone/address/DOB/social account/documents -- this is a
  -- public-display record, not a personnel file.
  short_bio text,
  -- Defaults to false: showing a real person publicly is an explicit,
  -- deliberate OWNER choice, never an accidental default (mission section 9).
  public_visible boolean NOT NULL DEFAULT false,
  -- Deactivating (not deleting) is the normal "remove from staff" action
  -- (mission section 19/20) -- history stays available to the club/D3 even
  -- though it stops being shown anywhere, public or Studio.
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  source_id uuid REFERENCES public.data_sources(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(btrim(display_name)) > 0 AND length(display_name) <= 120),
  CHECK (short_bio IS NULL OR length(short_bio) <= 280),
  CHECK (
    (role_type = 'OTHER' AND custom_role IS NOT NULL AND length(btrim(custom_role)) > 0)
    OR (role_type <> 'OTHER' AND custom_role IS NULL)
  )
);

COMMENT ON TABLE public.club_staff IS
  'Public-facing club/team staff directory -- a display concept only. Never grants any permission: no auth account, no club_memberships row, no Club Studio access is ever created or implied by a row here. A real OWNER/D3 Admin is likewise never auto-listed here.';

CREATE INDEX club_staff_club_idx ON public.club_staff(club_id);
CREATE INDEX club_staff_team_season_idx ON public.club_staff(team_season_id);

CREATE TRIGGER set_club_staff_updated_at BEFORE UPDATE ON public.club_staff
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Team/club integrity (mission section 25): a staff row attached to a team
-- must reference a team_season whose team belongs to the SAME club_id.
-- Enforced at the DB level via trigger (a plain CHECK can't join to another
-- table) so it holds even outside the RPCs below.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.validate_club_staff_team()
RETURNS trigger LANGUAGE plpgsql SET search_path=''
AS $$
DECLARE v_team_club uuid;
BEGIN
  IF NEW.team_season_id IS NOT NULL THEN
    SELECT t.club_id INTO v_team_club
    FROM public.team_seasons ts JOIN public.teams t ON t.id = ts.team_id
    WHERE ts.id = NEW.team_season_id;
    IF v_team_club IS NULL THEN
      RAISE EXCEPTION 'Team season not found';
    END IF;
    IF v_team_club <> NEW.club_id THEN
      RAISE EXCEPTION 'This team does not belong to this club';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER validate_club_staff_team BEFORE INSERT OR UPDATE OF club_id, team_season_id ON public.club_staff
  FOR EACH ROW EXECUTE FUNCTION public.validate_club_staff_team();

-- ----------------------------------------------------------------------------
-- Mutations. Same established pattern as every prior step: SECURITY DEFINER,
-- explicit actor_id (never auth.uid() inside the function), authorization
-- via actor_can_manage_club (OWNER of THIS club, or D3 Admin), granted only
-- to service_role. The server action resolves the real session before ever
-- calling these -- a client-supplied club_id/staff_id is never trusted
-- beyond what the RPC itself re-validates.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.add_club_staff(
  actor_id uuid,
  target_club_id uuid,
  p_team_season_id uuid,
  p_display_name text,
  p_role_type public.club_staff_role,
  p_custom_role text,
  p_short_bio text,
  p_public_visible boolean
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  v_display_name text := btrim(coalesce(p_display_name,''));
  v_custom_role text := nullif(btrim(coalesce(p_custom_role,'')),'');
  v_short_bio text := nullif(btrim(coalesce(p_short_bio,'')),'');
  v_source uuid;
  v_id uuid;
BEGIN
  IF NOT public.actor_can_manage_club(actor_id, target_club_id) THEN
    RAISE EXCEPTION 'Club OWNER required';
  END IF;
  IF length(v_display_name) = 0 THEN RAISE EXCEPTION 'Le nom affiché est requis'; END IF;
  IF p_role_type <> 'OTHER' THEN v_custom_role := NULL; END IF;
  IF p_role_type = 'OTHER' AND v_custom_role IS NULL THEN RAISE EXCEPTION 'Précisez la fonction pour "Autre"'; END IF;

  SELECT id INTO v_source FROM public.data_sources WHERE code = 'CLUB';

  INSERT INTO public.club_staff(
    club_id, team_season_id, display_name, role_type, custom_role, short_bio,
    public_visible, sort_order, source_id, created_by
  ) VALUES (
    target_club_id, p_team_season_id, v_display_name, p_role_type, v_custom_role, v_short_bio,
    coalesce(p_public_visible, false),
    CASE p_role_type
      WHEN 'PRESIDENT' THEN 10 WHEN 'SPORTING_DIRECTOR' THEN 20 WHEN 'COMMUNICATION' THEN 25
      WHEN 'HEAD_COACH' THEN 30 WHEN 'ASSISTANT_COACH' THEN 40 WHEN 'GOALKEEPER_COACH' THEN 45
      WHEN 'TEAM_MANAGER' THEN 50 WHEN 'PHYSIO' THEN 60 ELSE 90
    END,
    v_source, actor_id
  ) RETURNING id INTO v_id;

  INSERT INTO public.admin_audit_logs(actor_user_id, action, entity_type, entity_id, details)
  VALUES (actor_id, 'staff_created', 'club_staff', v_id, jsonb_build_object(
    'club_id', target_club_id, 'team_season_id', p_team_season_id, 'display_name', v_display_name,
    'role_type', p_role_type, 'custom_role', v_custom_role, 'public_visible', coalesce(p_public_visible, false)
  ));

  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.update_club_staff(
  actor_id uuid,
  p_staff_id uuid,
  p_team_season_id uuid,
  p_display_name text,
  p_role_type public.club_staff_role,
  p_custom_role text,
  p_short_bio text,
  p_public_visible boolean,
  p_sort_order integer
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  v_old public.club_staff;
  v_display_name text := btrim(coalesce(p_display_name,''));
  v_custom_role text := nullif(btrim(coalesce(p_custom_role,'')),'');
  v_short_bio text := nullif(btrim(coalesce(p_short_bio,'')),'');
BEGIN
  SELECT * INTO v_old FROM public.club_staff WHERE id = p_staff_id;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'Staff member not found'; END IF;
  IF NOT public.actor_can_manage_club(actor_id, v_old.club_id) THEN
    RAISE EXCEPTION 'Club OWNER required';
  END IF;
  IF length(v_display_name) = 0 THEN RAISE EXCEPTION 'Le nom affiché est requis'; END IF;
  IF p_role_type <> 'OTHER' THEN v_custom_role := NULL; END IF;
  IF p_role_type = 'OTHER' AND v_custom_role IS NULL THEN RAISE EXCEPTION 'Précisez la fonction pour "Autre"'; END IF;

  UPDATE public.club_staff SET
    team_season_id = p_team_season_id,
    display_name = v_display_name,
    role_type = p_role_type,
    custom_role = v_custom_role,
    short_bio = v_short_bio,
    public_visible = coalesce(p_public_visible, false),
    sort_order = coalesce(p_sort_order, sort_order)
  WHERE id = p_staff_id;

  IF v_old.display_name IS DISTINCT FROM v_display_name OR v_old.role_type IS DISTINCT FROM p_role_type
     OR v_old.custom_role IS DISTINCT FROM v_custom_role OR v_old.short_bio IS DISTINCT FROM v_short_bio THEN
    INSERT INTO public.admin_audit_logs(actor_user_id, action, entity_type, entity_id, details) VALUES (
      actor_id, 'staff_updated', 'club_staff', p_staff_id,
      jsonb_build_object(
        'before', jsonb_build_object('display_name', v_old.display_name, 'role_type', v_old.role_type, 'custom_role', v_old.custom_role, 'short_bio', v_old.short_bio),
        'after', jsonb_build_object('display_name', v_display_name, 'role_type', p_role_type, 'custom_role', v_custom_role, 'short_bio', v_short_bio)
      ));
  END IF;

  IF v_old.public_visible IS DISTINCT FROM coalesce(p_public_visible, false) THEN
    INSERT INTO public.admin_audit_logs(actor_user_id, action, entity_type, entity_id, details) VALUES (
      actor_id, 'staff_visibility_changed', 'club_staff', p_staff_id,
      jsonb_build_object('before', v_old.public_visible, 'after', coalesce(p_public_visible, false)));
  END IF;

  IF v_old.team_season_id IS DISTINCT FROM p_team_season_id THEN
    INSERT INTO public.admin_audit_logs(actor_user_id, action, entity_type, entity_id, details) VALUES (
      actor_id, 'staff_team_changed', 'club_staff', p_staff_id,
      jsonb_build_object('before', v_old.team_season_id, 'after', p_team_season_id));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.deactivate_club_staff(actor_id uuid, p_staff_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_old public.club_staff;
BEGIN
  SELECT * INTO v_old FROM public.club_staff WHERE id = p_staff_id;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'Staff member not found'; END IF;
  IF NOT public.actor_can_manage_club(actor_id, v_old.club_id) THEN
    RAISE EXCEPTION 'Club OWNER required';
  END IF;
  UPDATE public.club_staff SET active = false WHERE id = p_staff_id;
  INSERT INTO public.admin_audit_logs(actor_user_id, action, entity_type, entity_id, details)
  VALUES (actor_id, 'staff_deactivated', 'club_staff', p_staff_id, jsonb_build_object('club_id', v_old.club_id, 'display_name', v_old.display_name));
END $$;

REVOKE ALL ON FUNCTION public.add_club_staff(uuid,uuid,uuid,text,public.club_staff_role,text,text,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_club_staff(uuid,uuid,uuid,text,public.club_staff_role,text,text,boolean,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.deactivate_club_staff(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.add_club_staff(uuid,uuid,uuid,text,public.club_staff_role,text,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_club_staff(uuid,uuid,uuid,text,public.club_staff_role,text,text,boolean,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.deactivate_club_staff(uuid,uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- RLS / public surface. Same discipline as club_profiles (Step 6A gap
-- closure): the base table is never directly readable by anon/authenticated
-- -- created_by and source_id are internal -- only club_staff_public (a
-- plain, non-security_invoker view; permission checks and row visibility
-- both evaluate as the view owner, which is correct since the view's own
-- WHERE clause is the complete, self-contained visibility rule) exposes the
-- safe subset of columns, and only for rows that are both active and
-- explicitly marked public_visible.
-- ----------------------------------------------------------------------------

ALTER TABLE public.club_staff ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_staff FROM anon, authenticated;

CREATE VIEW public.club_staff_public AS
SELECT id, club_id, team_season_id, display_name, role_type, custom_role, short_bio, sort_order
FROM public.club_staff
WHERE active = true AND public_visible = true;

COMMENT ON VIEW public.club_staff_public IS
  'The only club_staff read surface for anon/authenticated: active AND public_visible rows only, safe columns only (no created_by/source_id/active/public_visible/timestamps).';

GRANT SELECT ON public.club_staff_public TO anon, authenticated;

COMMIT;
