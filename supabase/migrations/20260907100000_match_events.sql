BEGIN;

-- ============================================================================
-- Step 5B.2: match events (goals/assists/own goals/cards/substitutions).
-- Documentation of what happened, per match -- NOT aggregate Player/season/
-- career stats (that's Step 5C) and NEVER a recomputation of
-- matches.home_score/away_score (that stays Step 5A's independent,
-- club-declared result -- see the "score independence" comment below).
-- ============================================================================

CREATE TYPE public.match_event_type AS ENUM ('GOAL','OWN_GOAL','YELLOW_CARD','RED_CARD','SUBSTITUTION');
-- Deliberately no standalone ASSIST type -- an assist is the GOAL event's
-- own secondary_player_id, per mission section 4.
CREATE TYPE public.goal_kind AS ENUM ('NORMAL','PENALTY','FREE_KICK','UNKNOWN');
CREATE TYPE public.card_kind AS ENUM ('DIRECT','SECOND_YELLOW','UNKNOWN');

CREATE TABLE public.match_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  team_season_id uuid NOT NULL REFERENCES public.team_seasons(id) ON DELETE RESTRICT,
  event_type public.match_event_type NOT NULL,
  -- GOAL: scorer / optional assist. OWN_GOAL: the player who scored on their
  -- own goal (secondary always NULL -- no assist for an own goal).
  -- YELLOW_CARD/RED_CARD: sanctioned player (secondary always NULL).
  -- SUBSTITUTION: primary = player going out, secondary = player coming in
  -- (required, and never equal to primary).
  primary_player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE RESTRICT,
  secondary_player_id uuid REFERENCES public.players(id) ON DELETE RESTRICT,
  -- Both optional: amateur football often has no precise minute. 130 covers
  -- extra time in a cup match; added_time covers the "45+2"/"90+4" notation.
  minute integer,
  added_time integer,
  goal_kind public.goal_kind,
  card_kind public.card_kind,
  source_id uuid REFERENCES public.data_sources(id) ON DELETE SET NULL,
  verification_status public.match_verification_status NOT NULL DEFAULT 'CLUB_DECLARED',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (minute IS NULL OR minute BETWEEN 0 AND 130),
  CHECK (added_time IS NULL OR added_time BETWEEN 0 AND 15),
  CHECK (
    (event_type = 'GOAL' AND card_kind IS NULL)
    OR (event_type = 'OWN_GOAL' AND secondary_player_id IS NULL AND goal_kind IS NULL AND card_kind IS NULL)
    OR (event_type = 'YELLOW_CARD' AND secondary_player_id IS NULL AND goal_kind IS NULL AND card_kind IS NULL)
    OR (event_type = 'RED_CARD' AND secondary_player_id IS NULL AND goal_kind IS NULL)
    OR (event_type = 'SUBSTITUTION' AND secondary_player_id IS NOT NULL AND goal_kind IS NULL AND card_kind IS NULL AND primary_player_id <> secondary_player_id)
  )
);

CREATE INDEX match_events_match_idx ON public.match_events(match_id);
CREATE INDEX match_events_team_season_idx ON public.match_events(team_season_id);
CREATE INDEX match_events_primary_player_idx ON public.match_events(primary_player_id);

CREATE TRIGGER set_match_events_updated_at BEFORE UPDATE ON public.match_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

comment on table public.match_events is
  'Per-match event documentation (goals/own goals/cards/substitutions). Permanent id, never (match+player+minute) -- see mission section 3. Never aggregated into Player/season stats (Step 5C) and never used to recompute matches.home_score/away_score (Step 5A''s independent, club-declared result): partial event data, an external opponent, or two clubs documenting to different depths must never make the score look wrong.';

-- ----------------------------------------------------------------------------
-- Eligibility: every player referenced by an event (scorer, assist,
-- sanctioned player, substitute in/out) must already be on *that team's*
-- matchday squad for *that match* (match_appearances) -- stricter than mere
-- club/season registration, since an event happens in a specific match's
-- actual squad. Checked in the RPCs below, not a DB CHECK (needs a
-- cross-table lookup).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.player_on_match_sheet(p_match_id uuid, p_team_season_id uuid, p_player_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.match_appearances ma
    WHERE ma.match_id = p_match_id AND ma.team_season_id = p_team_season_id AND ma.player_id = p_player_id
  )
$$;
REVOKE ALL ON FUNCTION public.player_on_match_sheet(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.player_on_match_sheet(uuid,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.create_match_event(
  actor_id uuid,
  p_match_id uuid,
  p_team_season_id uuid,
  p_event_type public.match_event_type,
  p_primary_player_id uuid,
  p_secondary_player_id uuid,
  p_minute integer,
  p_added_time integer,
  p_goal_kind public.goal_kind,
  p_card_kind public.card_kind
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  v_source uuid;
  v_event_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.matches m WHERE m.id = p_match_id AND (m.home_team_season_id = p_team_season_id OR m.away_team_season_id = p_team_season_id)
  ) THEN
    RAISE EXCEPTION 'This team is not part of the given match';
  END IF;
  IF NOT public.actor_can_manage_team_season(actor_id, p_team_season_id) THEN
    RAISE EXCEPTION 'Club OWNER required';
  END IF;
  IF p_primary_player_id IS NULL THEN RAISE EXCEPTION 'A player is required for this event'; END IF;
  IF NOT public.player_on_match_sheet(p_match_id, p_team_season_id, p_primary_player_id) THEN
    RAISE EXCEPTION 'Player must be on this team''s match sheet first -- add them via Gérer la composition';
  END IF;
  IF p_event_type = 'SUBSTITUTION' THEN
    IF p_secondary_player_id IS NULL THEN RAISE EXCEPTION 'An incoming player is required for a substitution'; END IF;
    IF p_secondary_player_id = p_primary_player_id THEN RAISE EXCEPTION 'The outgoing and incoming player must be different'; END IF;
    IF NOT public.player_on_match_sheet(p_match_id, p_team_season_id, p_secondary_player_id) THEN
      RAISE EXCEPTION 'Incoming player must be on this team''s match sheet first -- add them via Gérer la composition';
    END IF;
  ELSIF p_event_type = 'GOAL' AND p_secondary_player_id IS NOT NULL THEN
    IF p_secondary_player_id = p_primary_player_id THEN RAISE EXCEPTION 'The scorer and the assist cannot be the same player'; END IF;
    IF NOT public.player_on_match_sheet(p_match_id, p_team_season_id, p_secondary_player_id) THEN
      RAISE EXCEPTION 'Assist player must be on this team''s match sheet first -- add them via Gérer la composition';
    END IF;
  ELSIF p_event_type <> 'GOAL' AND p_secondary_player_id IS NOT NULL THEN
    RAISE EXCEPTION 'This event type does not take a second player';
  END IF;

  SELECT id INTO v_source FROM public.data_sources WHERE code = 'CLUB';

  INSERT INTO public.match_events(
    match_id, team_season_id, event_type, primary_player_id, secondary_player_id,
    minute, added_time, goal_kind, card_kind, source_id, verification_status, created_by
  ) VALUES (
    p_match_id, p_team_season_id, p_event_type, p_primary_player_id, p_secondary_player_id,
    p_minute, p_added_time, p_goal_kind, p_card_kind, v_source, 'CLUB_DECLARED', actor_id
  ) RETURNING id INTO v_event_id;

  INSERT INTO public.admin_audit_logs(actor_user_id, action, entity_type, entity_id, details)
  VALUES (actor_id, 'match_event_created', 'match_event', v_event_id, jsonb_build_object(
    'match_id', p_match_id, 'team_season_id', p_team_season_id, 'event_type', p_event_type,
    'primary_player_id', p_primary_player_id, 'secondary_player_id', p_secondary_player_id,
    'minute', p_minute, 'added_time', p_added_time
  ));

  RETURN v_event_id;
END $$;

CREATE OR REPLACE FUNCTION public.update_match_event(
  actor_id uuid,
  p_event_id uuid,
  p_primary_player_id uuid,
  p_secondary_player_id uuid,
  p_minute integer,
  p_added_time integer,
  p_goal_kind public.goal_kind,
  p_card_kind public.card_kind
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_old public.match_events;
BEGIN
  SELECT * INTO v_old FROM public.match_events WHERE id = p_event_id;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'Event not found'; END IF;
  IF NOT public.actor_can_manage_team_season(actor_id, v_old.team_season_id) THEN
    RAISE EXCEPTION 'Club OWNER required';
  END IF;
  IF p_primary_player_id IS NULL THEN RAISE EXCEPTION 'A player is required for this event'; END IF;
  IF NOT public.player_on_match_sheet(v_old.match_id, v_old.team_season_id, p_primary_player_id) THEN
    RAISE EXCEPTION 'Player must be on this team''s match sheet';
  END IF;
  IF v_old.event_type = 'SUBSTITUTION' THEN
    IF p_secondary_player_id IS NULL THEN RAISE EXCEPTION 'An incoming player is required for a substitution'; END IF;
    IF p_secondary_player_id = p_primary_player_id THEN RAISE EXCEPTION 'The outgoing and incoming player must be different'; END IF;
    IF NOT public.player_on_match_sheet(v_old.match_id, v_old.team_season_id, p_secondary_player_id) THEN
      RAISE EXCEPTION 'Incoming player must be on this team''s match sheet';
    END IF;
  ELSIF v_old.event_type = 'GOAL' AND p_secondary_player_id IS NOT NULL THEN
    IF p_secondary_player_id = p_primary_player_id THEN RAISE EXCEPTION 'The scorer and the assist cannot be the same player'; END IF;
    IF NOT public.player_on_match_sheet(v_old.match_id, v_old.team_season_id, p_secondary_player_id) THEN
      RAISE EXCEPTION 'Assist player must be on this team''s match sheet';
    END IF;
  ELSIF v_old.event_type NOT IN ('GOAL','SUBSTITUTION') AND p_secondary_player_id IS NOT NULL THEN
    RAISE EXCEPTION 'This event type does not take a second player';
  END IF;

  UPDATE public.match_events SET
    primary_player_id = p_primary_player_id,
    secondary_player_id = p_secondary_player_id,
    minute = p_minute,
    added_time = p_added_time,
    goal_kind = CASE WHEN v_old.event_type = 'GOAL' THEN p_goal_kind ELSE NULL END,
    card_kind = CASE WHEN v_old.event_type = 'RED_CARD' THEN p_card_kind ELSE NULL END,
    updated_at = now()
  WHERE id = p_event_id;

  INSERT INTO public.admin_audit_logs(actor_user_id, action, entity_type, entity_id, details)
  VALUES (actor_id, 'match_event_updated', 'match_event', p_event_id, jsonb_build_object('before', to_jsonb(v_old), 'after', jsonb_build_object(
    'primary_player_id', p_primary_player_id, 'secondary_player_id', p_secondary_player_id,
    'minute', p_minute, 'added_time', p_added_time, 'goal_kind', p_goal_kind, 'card_kind', p_card_kind
  )));
END $$;

-- Hard delete is acceptable here per mission section 18: the full row is
-- captured in the audit's `before`, the operation is authorization-checked
-- like every other mutation, and no aggregate stat yet reads match_events
-- (Step 5C's problem, not this one's) -- so nothing downstream can be
-- silently corrupted by a row disappearing.
CREATE OR REPLACE FUNCTION public.delete_match_event(actor_id uuid, p_event_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_old public.match_events;
BEGIN
  SELECT * INTO v_old FROM public.match_events WHERE id = p_event_id;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'Event not found'; END IF;
  IF NOT public.actor_can_manage_team_season(actor_id, v_old.team_season_id) THEN
    RAISE EXCEPTION 'Club OWNER required';
  END IF;
  DELETE FROM public.match_events WHERE id = p_event_id;
  INSERT INTO public.admin_audit_logs(actor_user_id, action, entity_type, entity_id, details)
  VALUES (actor_id, 'match_event_deleted', 'match_event', p_event_id, jsonb_build_object('before', to_jsonb(v_old)));
END $$;

REVOKE ALL ON FUNCTION public.create_match_event(uuid,uuid,uuid,public.match_event_type,uuid,uuid,integer,integer,public.goal_kind,public.card_kind) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_match_event(uuid,uuid,uuid,uuid,integer,integer,public.goal_kind,public.card_kind) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.delete_match_event(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_match_event(uuid,uuid,uuid,public.match_event_type,uuid,uuid,integer,integer,public.goal_kind,public.card_kind) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_match_event(uuid,uuid,uuid,uuid,integer,integer,public.goal_kind,public.card_kind) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_match_event(uuid,uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- RLS: publicly readable (a match timeline is not sensitive), writes only
-- through the RPCs above.
-- ----------------------------------------------------------------------------

ALTER TABLE public.match_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY match_events_public_read ON public.match_events FOR SELECT USING (true);
GRANT SELECT ON public.match_events TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.match_events FROM anon, authenticated;

COMMIT;
