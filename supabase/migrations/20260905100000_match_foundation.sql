BEGIN;

-- ============================================================================
-- Step 5A: match foundation. No compositions/appearances/goals/cards here --
-- those are Step 5B/5C. This is deliberately just: schedule a match, know
-- who's playing, optionally record a final score.
-- ============================================================================

CREATE TYPE public.match_status AS ENUM ('SCHEDULED','PLAYED','POSTPONED','CANCELLED');
-- LIVE/ABANDONED/FORFEIT are anticipated but not built now -- adding enum
-- values later is a cheap, additive ALTER TYPE ... ADD VALUE, no reason to
-- pre-create labels nothing reads yet.
CREATE TYPE public.match_verification_status AS ENUM ('CLUB_DECLARED','VERIFIED','NEEDS_REVIEW');

CREATE TABLE public.matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE RESTRICT,
  competition_season_id uuid REFERENCES public.competition_seasons(id) ON DELETE SET NULL,
  competition_group_id uuid REFERENCES public.competition_groups(id) ON DELETE SET NULL,
  -- Both sides are nullable on purpose: a match always has at least one D3
  -- team_season (whichever side the OWNER controls), but the *other* side
  -- is either the opponent's D3 team_season (if they're already in D3) or
  -- NULL with external_opponent_name set (if they're not) -- and either
  -- side can be the free-text one, since our team can play home or away.
  -- The opponent_shape check below is the actual invariant; these two
  -- columns alone can't express "exactly one D3 side is required".
  home_team_season_id uuid REFERENCES public.team_seasons(id) ON DELETE RESTRICT,
  away_team_season_id uuid REFERENCES public.team_seasons(id) ON DELETE RESTRICT,
  external_opponent_name text,
  venue_id uuid REFERENCES public.venues(id) ON DELETE SET NULL,
  kickoff_at timestamptz NOT NULL,
  status public.match_status NOT NULL DEFAULT 'SCHEDULED',
  home_score integer,
  away_score integer,
  source_id uuid REFERENCES public.data_sources(id) ON DELETE SET NULL,
  verification_status public.match_verification_status NOT NULL DEFAULT 'CLUB_DECLARED',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (home_team_season_id IS DISTINCT FROM away_team_season_id),
  CHECK (num_nonnulls(home_team_season_id, away_team_season_id) = 2 AND external_opponent_name IS NULL
      OR num_nonnulls(home_team_season_id, away_team_season_id) = 1 AND external_opponent_name IS NOT NULL),
  CHECK (
    (status = 'PLAYED' AND home_score IS NOT NULL AND away_score IS NOT NULL AND home_score >= 0 AND away_score >= 0)
    OR (status <> 'PLAYED' AND home_score IS NULL AND away_score IS NULL)
  )
);

CREATE INDEX matches_home_team_season_idx ON public.matches(home_team_season_id);
CREATE INDEX matches_away_team_season_idx ON public.matches(away_team_season_id);
CREATE INDEX matches_season_idx ON public.matches(season_id);
CREATE INDEX matches_kickoff_idx ON public.matches(kickoff_at);
CREATE INDEX matches_status_idx ON public.matches(status);

CREATE TRIGGER set_matches_updated_at BEFORE UPDATE ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

comment on table public.matches is
  'Canonical D3 match. id is the permanent identity -- never date+teams, score, or a future provider id. Provider linkage goes through the existing generic external_identities(entity_type=''match'', entity_id) table, unused for now.';
comment on column public.matches.home_team_season_id is
  'Nullable: exactly one of home/away is null only when the other side is a free-text opponent (external_opponent_name) -- see the opponent-shape CHECK. Whichever side is non-null and owned by the acting OWNER is validated in the RPCs below, not here.';

-- ----------------------------------------------------------------------------
-- Authorization helpers
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.actor_can_manage_team_season(actor_id uuid, p_team_season_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.team_seasons ts
    JOIN public.teams t ON t.id = ts.team_id
    WHERE ts.id = p_team_season_id AND public.actor_can_manage_club(actor_id, t.club_id)
  )
$$;
REVOKE ALL ON FUNCTION public.actor_can_manage_team_season(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.actor_can_manage_team_season(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.actor_can_manage_match(actor_id uuid, p_match_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.matches m
    WHERE m.id = p_match_id
      AND (
        (m.home_team_season_id IS NOT NULL AND public.actor_can_manage_team_season(actor_id, m.home_team_season_id))
        OR (m.away_team_season_id IS NOT NULL AND public.actor_can_manage_team_season(actor_id, m.away_team_season_id))
      )
  )
$$;
REVOKE ALL ON FUNCTION public.actor_can_manage_match(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.actor_can_manage_match(uuid,uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- Mutations. All SECURITY DEFINER, all take an explicit actor_id, all
-- granted only to service_role -- the calling server action resolves
-- actor_id from the caller's real session (never from client input) before
-- ever reaching here, exactly like Step 3/4. No table INSERT/UPDATE/DELETE
-- grant exists for anon/authenticated on `matches` (see RLS below), so
-- these RPCs are the only write path -- one atomic statement each, no
-- partially-applied client-side write sequences.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_match(
  actor_id uuid,
  p_home_team_season_id uuid,
  p_away_team_season_id uuid,
  p_external_opponent_name text,
  p_competition_season_id uuid,
  p_competition_group_id uuid,
  p_venue_id uuid,
  p_kickoff_at timestamptz
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  v_source uuid;
  v_season uuid;
  v_external text := nullif(btrim(coalesce(p_external_opponent_name,'')),'');
  v_match_id uuid;
BEGIN
  IF p_kickoff_at IS NULL THEN RAISE EXCEPTION 'Kickoff date/time required'; END IF;
  IF p_home_team_season_id IS NULL AND p_away_team_season_id IS NULL THEN
    RAISE EXCEPTION 'At least one side must be a D3 team';
  END IF;
  IF p_home_team_season_id IS NOT NULL AND p_away_team_season_id IS NOT NULL AND v_external IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot set both a D3 opponent and a free-text opponent name';
  END IF;
  IF (p_home_team_season_id IS NULL) <> (p_away_team_season_id IS NULL) AND v_external IS NULL THEN
    RAISE EXCEPTION 'Opponent required: pick a D3 team or enter a name';
  END IF;
  IF p_home_team_season_id = p_away_team_season_id AND p_home_team_season_id IS NOT NULL THEN
    RAISE EXCEPTION 'A team cannot play itself';
  END IF;
  IF NOT (
    (p_home_team_season_id IS NOT NULL AND public.actor_can_manage_team_season(actor_id, p_home_team_season_id))
    OR (p_away_team_season_id IS NOT NULL AND public.actor_can_manage_team_season(actor_id, p_away_team_season_id))
  ) THEN
    RAISE EXCEPTION 'Club OWNER required for at least one side of the match';
  END IF;

  SELECT coalesce(
    (SELECT season_id FROM public.team_seasons WHERE id = p_home_team_season_id),
    (SELECT season_id FROM public.team_seasons WHERE id = p_away_team_season_id)
  ) INTO v_season;
  SELECT id INTO v_source FROM public.data_sources WHERE code = 'CLUB';

  INSERT INTO public.matches(
    season_id, competition_season_id, competition_group_id,
    home_team_season_id, away_team_season_id, external_opponent_name,
    venue_id, kickoff_at, status, source_id, verification_status, created_by
  ) VALUES (
    v_season, p_competition_season_id, p_competition_group_id,
    p_home_team_season_id, p_away_team_season_id, v_external,
    p_venue_id, p_kickoff_at, 'SCHEDULED', v_source, 'CLUB_DECLARED', actor_id
  ) RETURNING id INTO v_match_id;

  INSERT INTO public.admin_audit_logs(actor_user_id, action, entity_type, entity_id, details)
  VALUES (actor_id, 'match_created', 'match', v_match_id, jsonb_build_object(
    'home_team_season_id', p_home_team_season_id, 'away_team_season_id', p_away_team_season_id,
    'external_opponent_name', v_external, 'kickoff_at', p_kickoff_at
  ));

  RETURN v_match_id;
END $$;

CREATE OR REPLACE FUNCTION public.update_match(
  actor_id uuid,
  p_match_id uuid,
  p_home_team_season_id uuid,
  p_away_team_season_id uuid,
  p_external_opponent_name text,
  p_kickoff_at timestamptz,
  p_venue_id uuid,
  p_competition_season_id uuid,
  p_competition_group_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  v_old public.matches;
  v_external text := nullif(btrim(coalesce(p_external_opponent_name,'')),'');
BEGIN
  SELECT * INTO v_old FROM public.matches WHERE id = p_match_id;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'Match not found'; END IF;
  IF NOT public.actor_can_manage_match(actor_id, p_match_id) THEN RAISE EXCEPTION 'Club OWNER required'; END IF;
  IF v_old.status NOT IN ('SCHEDULED','POSTPONED') THEN
    RAISE EXCEPTION 'Match schedule can only be edited before it is played, and never once cancelled';
  END IF;
  IF p_kickoff_at IS NULL THEN RAISE EXCEPTION 'Kickoff date/time required'; END IF;
  IF p_home_team_season_id IS NULL AND p_away_team_season_id IS NULL THEN
    RAISE EXCEPTION 'At least one side must be a D3 team';
  END IF;
  IF p_home_team_season_id IS NOT NULL AND p_away_team_season_id IS NOT NULL AND v_external IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot set both a D3 opponent and a free-text opponent name';
  END IF;
  IF (p_home_team_season_id IS NULL) <> (p_away_team_season_id IS NULL) AND v_external IS NULL THEN
    RAISE EXCEPTION 'Opponent required: pick a D3 team or enter a name';
  END IF;
  IF p_home_team_season_id = p_away_team_season_id AND p_home_team_season_id IS NOT NULL THEN
    RAISE EXCEPTION 'A team cannot play itself';
  END IF;
  IF NOT (
    (p_home_team_season_id IS NOT NULL AND public.actor_can_manage_team_season(actor_id, p_home_team_season_id))
    OR (p_away_team_season_id IS NOT NULL AND public.actor_can_manage_team_season(actor_id, p_away_team_season_id))
  ) THEN
    RAISE EXCEPTION 'Club OWNER required for at least one side of the match';
  END IF;

  UPDATE public.matches SET
    home_team_season_id = p_home_team_season_id,
    away_team_season_id = p_away_team_season_id,
    external_opponent_name = v_external,
    kickoff_at = p_kickoff_at,
    venue_id = p_venue_id,
    competition_season_id = p_competition_season_id,
    competition_group_id = p_competition_group_id,
    updated_at = now()
  WHERE id = p_match_id;

  INSERT INTO public.admin_audit_logs(actor_user_id, action, entity_type, entity_id, details) VALUES (
    actor_id, 'match_edited', 'match', p_match_id,
    jsonb_build_object(
      'before', jsonb_build_object('home_team_season_id', v_old.home_team_season_id, 'away_team_season_id', v_old.away_team_season_id, 'external_opponent_name', v_old.external_opponent_name, 'kickoff_at', v_old.kickoff_at, 'venue_id', v_old.venue_id),
      'after', jsonb_build_object('home_team_season_id', p_home_team_season_id, 'away_team_season_id', p_away_team_season_id, 'external_opponent_name', v_external, 'kickoff_at', p_kickoff_at, 'venue_id', p_venue_id)
    )
  );
  IF v_old.kickoff_at IS DISTINCT FROM p_kickoff_at THEN
    INSERT INTO public.admin_audit_logs(actor_user_id, action, entity_type, entity_id, details)
    VALUES (actor_id, 'kickoff_changed', 'match', p_match_id, jsonb_build_object('before', v_old.kickoff_at, 'after', p_kickoff_at));
  END IF;
  IF v_old.home_team_season_id IS DISTINCT FROM p_home_team_season_id
     OR v_old.away_team_season_id IS DISTINCT FROM p_away_team_season_id
     OR v_old.external_opponent_name IS DISTINCT FROM v_external THEN
    INSERT INTO public.admin_audit_logs(actor_user_id, action, entity_type, entity_id, details) VALUES (
      actor_id, 'opponent_changed', 'match', p_match_id,
      jsonb_build_object(
        'before', jsonb_build_object('home', v_old.home_team_season_id, 'away', v_old.away_team_season_id, 'external', v_old.external_opponent_name),
        'after', jsonb_build_object('home', p_home_team_season_id, 'away', p_away_team_season_id, 'external', v_external)
      )
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.enter_match_result(
  actor_id uuid, p_match_id uuid, p_home_score integer, p_away_score integer
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_old public.matches;
BEGIN
  SELECT * INTO v_old FROM public.matches WHERE id = p_match_id;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'Match not found'; END IF;
  IF NOT public.actor_can_manage_match(actor_id, p_match_id) THEN RAISE EXCEPTION 'Club OWNER required'; END IF;
  IF v_old.status NOT IN ('SCHEDULED','PLAYED') THEN
    RAISE EXCEPTION 'Cannot enter a result for a postponed or cancelled match';
  END IF;
  IF p_home_score IS NULL OR p_away_score IS NULL OR p_home_score < 0 OR p_away_score < 0 THEN
    RAISE EXCEPTION 'Score must be zero or a positive whole number for both teams';
  END IF;

  UPDATE public.matches SET home_score = p_home_score, away_score = p_away_score, status = 'PLAYED', updated_at = now()
  WHERE id = p_match_id;

  INSERT INTO public.admin_audit_logs(actor_user_id, action, entity_type, entity_id, details) VALUES (
    actor_id,
    CASE WHEN v_old.status = 'PLAYED' THEN 'result_corrected' ELSE 'result_entered' END,
    'match', p_match_id,
    jsonb_build_object(
      'before', jsonb_build_object('home_score', v_old.home_score, 'away_score', v_old.away_score, 'status', v_old.status),
      'after', jsonb_build_object('home_score', p_home_score, 'away_score', p_away_score)
    )
  );
END $$;

CREATE OR REPLACE FUNCTION public.postpone_match(actor_id uuid, p_match_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_old public.matches;
BEGIN
  SELECT * INTO v_old FROM public.matches WHERE id = p_match_id;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'Match not found'; END IF;
  IF NOT public.actor_can_manage_match(actor_id, p_match_id) THEN RAISE EXCEPTION 'Club OWNER required'; END IF;
  IF v_old.status = 'PLAYED' THEN RAISE EXCEPTION 'Cannot postpone a match that has already been played'; END IF;
  UPDATE public.matches SET status = 'POSTPONED', updated_at = now() WHERE id = p_match_id;
  INSERT INTO public.admin_audit_logs(actor_user_id, action, entity_type, entity_id, details)
  VALUES (actor_id, 'match_postponed', 'match', p_match_id, jsonb_build_object('before_status', v_old.status));
END $$;

CREATE OR REPLACE FUNCTION public.cancel_match(actor_id uuid, p_match_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_old public.matches;
BEGIN
  SELECT * INTO v_old FROM public.matches WHERE id = p_match_id;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'Match not found'; END IF;
  IF NOT public.actor_can_manage_match(actor_id, p_match_id) THEN RAISE EXCEPTION 'Club OWNER required'; END IF;
  IF v_old.status = 'PLAYED' THEN RAISE EXCEPTION 'Cannot cancel a match that has already been played -- correct the result instead'; END IF;
  UPDATE public.matches SET status = 'CANCELLED', updated_at = now() WHERE id = p_match_id;
  INSERT INTO public.admin_audit_logs(actor_user_id, action, entity_type, entity_id, details)
  VALUES (actor_id, 'match_cancelled', 'match', p_match_id, jsonb_build_object('before_status', v_old.status));
END $$;

REVOKE ALL ON FUNCTION public.create_match(uuid,uuid,uuid,text,uuid,uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_match(uuid,uuid,uuid,uuid,text,timestamptz,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.enter_match_result(uuid,uuid,integer,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.postpone_match(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_match(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_match(uuid,uuid,uuid,text,uuid,uuid,uuid,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_match(uuid,uuid,uuid,uuid,text,timestamptz,uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.enter_match_result(uuid,uuid,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.postpone_match(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_match(uuid,uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- RLS: matches are always publicly readable (a fixture list/result is not
-- sensitive, unlike a player profile that can be under review) -- only
-- writes are gated, and only through the RPCs above.
-- ----------------------------------------------------------------------------

ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY matches_public_read ON public.matches FOR SELECT USING (true);
GRANT SELECT ON public.matches TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.matches FROM anon, authenticated;

COMMIT;
