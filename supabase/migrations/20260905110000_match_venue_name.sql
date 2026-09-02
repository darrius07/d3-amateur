BEGIN;

-- "lieu facultatif" (mission section 5/12) needs a place to live even
-- though there is no venues search/creation tool yet (out of scope for
-- 5A) -- mirrors external_opponent_name's free-text pattern exactly.
-- venue_id (FK to public.venues) stays available, unused for now, for a
-- future verified-venue reconciliation without ever touching match.id.
ALTER TABLE public.matches ADD COLUMN venue_name text;

CREATE OR REPLACE FUNCTION public.create_match(
  actor_id uuid,
  p_home_team_season_id uuid,
  p_away_team_season_id uuid,
  p_external_opponent_name text,
  p_competition_season_id uuid,
  p_competition_group_id uuid,
  p_venue_id uuid,
  p_kickoff_at timestamptz,
  p_venue_name text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  v_source uuid;
  v_season uuid;
  v_external text := nullif(btrim(coalesce(p_external_opponent_name,'')),'');
  v_venue_name text := nullif(btrim(coalesce(p_venue_name,'')),'');
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
    venue_id, venue_name, kickoff_at, status, source_id, verification_status, created_by
  ) VALUES (
    v_season, p_competition_season_id, p_competition_group_id,
    p_home_team_season_id, p_away_team_season_id, v_external,
    p_venue_id, v_venue_name, p_kickoff_at, 'SCHEDULED', v_source, 'CLUB_DECLARED', actor_id
  ) RETURNING id INTO v_match_id;

  INSERT INTO public.admin_audit_logs(actor_user_id, action, entity_type, entity_id, details)
  VALUES (actor_id, 'match_created', 'match', v_match_id, jsonb_build_object(
    'home_team_season_id', p_home_team_season_id, 'away_team_season_id', p_away_team_season_id,
    'external_opponent_name', v_external, 'kickoff_at', p_kickoff_at, 'venue_name', v_venue_name
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
  p_competition_group_id uuid,
  p_venue_name text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  v_old public.matches;
  v_external text := nullif(btrim(coalesce(p_external_opponent_name,'')),'');
  v_venue_name text := nullif(btrim(coalesce(p_venue_name,'')),'');
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
    venue_name = v_venue_name,
    competition_season_id = p_competition_season_id,
    competition_group_id = p_competition_group_id,
    updated_at = now()
  WHERE id = p_match_id;

  INSERT INTO public.admin_audit_logs(actor_user_id, action, entity_type, entity_id, details) VALUES (
    actor_id, 'match_edited', 'match', p_match_id,
    jsonb_build_object(
      'before', jsonb_build_object('home_team_season_id', v_old.home_team_season_id, 'away_team_season_id', v_old.away_team_season_id, 'external_opponent_name', v_old.external_opponent_name, 'kickoff_at', v_old.kickoff_at, 'venue_name', v_old.venue_name),
      'after', jsonb_build_object('home_team_season_id', p_home_team_season_id, 'away_team_season_id', p_away_team_season_id, 'external_opponent_name', v_external, 'kickoff_at', p_kickoff_at, 'venue_name', v_venue_name)
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

REVOKE ALL ON FUNCTION public.create_match(uuid,uuid,uuid,text,uuid,uuid,uuid,timestamptz,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_match(uuid,uuid,uuid,uuid,text,timestamptz,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_match(uuid,uuid,uuid,text,uuid,uuid,uuid,timestamptz,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_match(uuid,uuid,uuid,uuid,text,timestamptz,uuid,uuid,uuid,text) TO service_role;

COMMIT;
