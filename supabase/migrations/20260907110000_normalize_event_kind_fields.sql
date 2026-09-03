BEGIN;

-- Bug found by the Step 5B.2 Golden Path E2E run: the "Ajouter un carton"
-- form (before it was split into separate jaune/rouge forms) always
-- submitted card_kind='DIRECT' alongside event_type=YELLOW_CARD, and
-- create_match_event() inserted it as given -- correctly rejected by the
-- match_events_check CHECK constraint (YELLOW_CARD requires card_kind
-- NULL), but surfaced as a raw 500 instead of being normalized away.
-- update_match_event() already normalizes goal_kind/card_kind from
-- v_old.event_type; create_match_event() now does the same from
-- p_event_type before the INSERT, so no caller (this UI or a future one)
-- can trip the CHECK constraint by sending an irrelevant kind field.
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
  v_goal_kind public.goal_kind := CASE WHEN p_event_type = 'GOAL' THEN p_goal_kind ELSE NULL END;
  v_card_kind public.card_kind := CASE WHEN p_event_type = 'RED_CARD' THEN p_card_kind ELSE NULL END;
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
    p_minute, p_added_time, v_goal_kind, v_card_kind, v_source, 'CLUB_DECLARED', actor_id
  ) RETURNING id INTO v_event_id;

  INSERT INTO public.admin_audit_logs(actor_user_id, action, entity_type, entity_id, details)
  VALUES (actor_id, 'match_event_created', 'match_event', v_event_id, jsonb_build_object(
    'match_id', p_match_id, 'team_season_id', p_team_season_id, 'event_type', p_event_type,
    'primary_player_id', p_primary_player_id, 'secondary_player_id', p_secondary_player_id,
    'minute', p_minute, 'added_time', p_added_time
  ));

  RETURN v_event_id;
END $$;

REVOKE ALL ON FUNCTION public.create_match_event(uuid,uuid,uuid,public.match_event_type,uuid,uuid,integer,integer,public.goal_kind,public.card_kind) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_match_event(uuid,uuid,uuid,public.match_event_type,uuid,uuid,integer,integer,public.goal_kind,public.card_kind) TO service_role;

COMMIT;
