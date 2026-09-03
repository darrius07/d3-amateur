BEGIN;

-- Fix found before shipping any Step 5C UI: player_match_facts and
-- player_match_event_facts only excluded status='CANCELLED' matches, but
-- never required status='PLAYED'. save_match_lineup/create_match_event
-- both allow entering a squad or an event on a SCHEDULED match (e.g. the
-- OWNER prepares next Saturday's lineup ahead of kickoff) -- correct product
-- behaviour, but it meant a not-yet-played fixture could already inflate a
-- player's documented appearances/goals, inconsistent with
-- team_season_data_coverage's own played_matches, which was already
-- (correctly) restricted to status='PLAYED'. A statistic can only be
-- "derived from what happened" once the match has actually happened.
CREATE OR REPLACE VIEW public.player_match_facts WITH (security_invoker = true) AS
SELECT
  ma.player_id,
  ma.match_id,
  ma.team_season_id,
  ts.season_id,
  t.club_id,
  ma.lineup_role,
  (ma.lineup_role = 'STARTER') AS is_start,
  (ma.lineup_role = 'BENCH' AND EXISTS (
    SELECT 1 FROM public.match_events se
    WHERE se.match_id = ma.match_id AND se.team_season_id = ma.team_season_id
      AND se.event_type = 'SUBSTITUTION' AND se.secondary_player_id = ma.player_id
  )) AS is_substitute_appearance
FROM public.match_appearances ma
JOIN public.team_seasons ts ON ts.id = ma.team_season_id
JOIN public.teams t ON t.id = ts.team_id
JOIN public.matches m ON m.id = ma.match_id AND m.status = 'PLAYED';

comment on view public.player_match_facts is
  'One row per documented match_appearances entry for a PLAYED match, with the derived is_start/is_substitute_appearance booleans. A lineup saved ahead of a still-SCHEDULED match contributes nothing here yet. Internal building block -- query player_team_season_stats/player_season_stats/player_career_stats for display.';

CREATE OR REPLACE VIEW public.player_match_event_facts WITH (security_invoker = true) AS
SELECT
  e.id AS event_id,
  e.match_id,
  e.team_season_id,
  ts.season_id,
  t.club_id,
  e.event_type,
  e.primary_player_id,
  e.secondary_player_id
FROM public.match_events e
JOIN public.team_seasons ts ON ts.id = e.team_season_id
JOIN public.teams t ON t.id = ts.team_id
JOIN public.matches m ON m.id = e.match_id AND m.status = 'PLAYED';

comment on view public.player_match_event_facts is
  'One row per match_events entry for a PLAYED match, with team/season/club context attached. Internal building block.';

COMMIT;
