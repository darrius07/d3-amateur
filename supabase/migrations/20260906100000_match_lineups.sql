BEGIN;

-- ============================================================================
-- Step 5B.1: match lineups (starters/bench). No goals/cards/subs/minutes/
-- aggregate stats here -- Step 5B.2/5C. A player's matchday number/position
-- here is a SNAPSHOT for this match only; it never writes back to the
-- permanent team_roster_members row.
-- ============================================================================

CREATE TYPE public.lineup_role AS ENUM ('STARTER','BENCH');
-- More roles (e.g. a formation-position enum, captain flag) are anticipated
-- but not built now -- ALTER TYPE ... ADD VALUE later is cheap and additive.
CREATE TYPE public.participation_status AS ENUM ('SELECTED','DID_NOT_PLAY','UNKNOWN');

CREATE TABLE public.match_appearances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  team_season_id uuid NOT NULL REFERENCES public.team_seasons(id) ON DELETE RESTRICT,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE RESTRICT,
  lineup_role public.lineup_role NOT NULL,
  position public.player_position,
  squad_number integer,
  participation_status public.participation_status NOT NULL DEFAULT 'SELECTED',
  source_id uuid REFERENCES public.data_sources(id) ON DELETE SET NULL,
  verification_status public.match_verification_status NOT NULL DEFAULT 'CLUB_DECLARED',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- A player has exactly one row per match+team, so STARTER and BENCH can
  -- never coexist for the same player/match/team -- this unique constraint
  -- *is* the "no simultaneous starter+bench" guarantee, not a separate rule.
  UNIQUE (match_id, team_season_id, player_id),
  CHECK (squad_number IS NULL OR squad_number BETWEEN 1 AND 99)
);

CREATE INDEX match_appearances_match_idx ON public.match_appearances(match_id);
CREATE INDEX match_appearances_team_season_idx ON public.match_appearances(team_season_id);
CREATE INDEX match_appearances_player_idx ON public.match_appearances(player_id);

CREATE TRIGGER set_match_appearances_updated_at BEFORE UPDATE ON public.match_appearances
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

comment on table public.match_appearances is
  'Matchday squad (starters/bench) per match+team. Snapshot only: squad_number/position here never write back to team_roster_members. No goals/cards/subs/minutes -- Step 5B.2+.';

-- ----------------------------------------------------------------------------
-- Single, transactional, idempotent save: the OWNER's client holds the full
-- desired lineup for (match, team) in memory (add/move/remove/edit are all
-- local state changes) and submits the whole set once. This function
-- replaces the existing set for that (match, team) -- delete rows no longer
-- present, upsert the rest -- inside one statement/transaction, so there is
-- no client-visible partially-saved state, and resubmitting the same set
-- twice is a no-op. Eligibility (must be actively registered with the same
-- club+season, not merely exist in `players`) is checked per entry before
-- any write happens.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.save_match_lineup(
  actor_id uuid,
  p_match_id uuid,
  p_team_season_id uuid,
  p_entries jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  v_club uuid;
  v_season uuid;
  v_starter_count integer := 0;
  v_entry jsonb;
  v_player_id uuid;
  v_role text;
  v_seen uuid[] := '{}';
  v_before jsonb;
  v_after jsonb;
BEGIN
  SELECT t.club_id, ts.season_id INTO v_club, v_season
  FROM public.team_seasons ts JOIN public.teams t ON t.id = ts.team_id
  WHERE ts.id = p_team_season_id;
  IF v_club IS NULL THEN RAISE EXCEPTION 'Team not found'; END IF;
  IF NOT public.actor_can_manage_team_season(actor_id, p_team_season_id) THEN
    RAISE EXCEPTION 'Club OWNER required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.matches m
    WHERE m.id = p_match_id AND (m.home_team_season_id = p_team_season_id OR m.away_team_season_id = p_team_season_id)
  ) THEN
    RAISE EXCEPTION 'This team is not part of the given match';
  END IF;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(coalesce(p_entries, '[]'::jsonb))
  LOOP
    v_player_id := (v_entry->>'player_id')::uuid;
    v_role := v_entry->>'lineup_role';
    IF v_player_id IS NULL THEN RAISE EXCEPTION 'player_id is required for every lineup entry'; END IF;
    IF v_player_id = ANY(v_seen) THEN RAISE EXCEPTION 'Player % listed more than once in the same lineup', v_player_id; END IF;
    v_seen := v_seen || v_player_id;
    IF v_role NOT IN ('STARTER','BENCH') THEN RAISE EXCEPTION 'Invalid lineup role %', v_role; END IF;
    IF v_role = 'STARTER' THEN v_starter_count := v_starter_count + 1; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.player_registrations r
      WHERE r.player_id = v_player_id AND r.club_id = v_club AND r.season_id = v_season AND r.status = 'ACTIVE'
    ) THEN
      RAISE EXCEPTION 'Player % is not actively registered with this club for this season', v_player_id;
    END IF;
  END LOOP;
  IF v_starter_count > 11 THEN
    RAISE EXCEPTION 'A lineup cannot have more than 11 starters (got %)', v_starter_count;
  END IF;

  SELECT jsonb_agg(jsonb_build_object('player_id', player_id, 'lineup_role', lineup_role)) INTO v_before
  FROM public.match_appearances WHERE match_id = p_match_id AND team_season_id = p_team_season_id;

  DELETE FROM public.match_appearances
  WHERE match_id = p_match_id AND team_season_id = p_team_season_id
    AND NOT (player_id = ANY(v_seen));

  IF array_length(v_seen, 1) > 0 THEN
    INSERT INTO public.match_appearances(
      match_id, team_season_id, player_id, lineup_role, position, squad_number,
      participation_status, source_id, verification_status, created_by
    )
    SELECT
      p_match_id, p_team_season_id,
      (e->>'player_id')::uuid,
      (e->>'lineup_role')::public.lineup_role,
      nullif(e->>'position', '')::public.player_position,
      nullif(e->>'squad_number', '')::integer,
      coalesce(nullif(e->>'participation_status', ''), 'SELECTED')::public.participation_status,
      (SELECT id FROM public.data_sources WHERE code = 'CLUB'),
      'CLUB_DECLARED',
      actor_id
    FROM jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) AS e
    ON CONFLICT (match_id, team_season_id, player_id) DO UPDATE SET
      lineup_role = EXCLUDED.lineup_role,
      position = EXCLUDED.position,
      squad_number = EXCLUDED.squad_number,
      participation_status = EXCLUDED.participation_status,
      updated_at = now();
  END IF;

  SELECT jsonb_agg(jsonb_build_object('player_id', player_id, 'lineup_role', lineup_role)) INTO v_after
  FROM public.match_appearances WHERE match_id = p_match_id AND team_season_id = p_team_season_id;

  -- One synthetic event with a useful diff, not one row per player touched.
  INSERT INTO public.admin_audit_logs(actor_user_id, action, entity_type, entity_id, details)
  VALUES (actor_id, 'lineup_updated', 'match_appearance_set', p_match_id, jsonb_build_object(
    'team_season_id', p_team_season_id,
    'before', coalesce(v_before, '[]'::jsonb),
    'after', coalesce(v_after, '[]'::jsonb)
  ));
END $$;

REVOKE ALL ON FUNCTION public.save_match_lineup(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_match_lineup(uuid,uuid,uuid,jsonb) TO service_role;

-- ----------------------------------------------------------------------------
-- RLS: lineups are publicly readable (a matchday squad is not sensitive),
-- writes only through save_match_lineup above.
-- ----------------------------------------------------------------------------

ALTER TABLE public.match_appearances ENABLE ROW LEVEL SECURITY;
CREATE POLICY match_appearances_public_read ON public.match_appearances FOR SELECT USING (true);
GRANT SELECT ON public.match_appearances TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.match_appearances FROM anon, authenticated;

COMMIT;
