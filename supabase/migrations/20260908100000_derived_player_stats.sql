BEGIN;

-- ============================================================================
-- Step 5C: derived player stats. NO stored counters anywhere (no
-- players.goals, no team_roster_members.appearances, nothing mutable) --
-- every number here is a view computed live from match_appearances and
-- match_events, the only source of truth. Correcting a lineup or an event
-- changes what these views return on the very next read; there is nothing
-- to "recalculate" and nothing that can go stale.
--
-- All views are `security_invoker = true`: they run under the CALLER's own
-- RLS, not the view owner's. match_appearances/match_events/matches are
-- already publicly readable and players is public-only for
-- profile_status='PUBLIC' -- security_invoker means a REVIEW-status
-- player's derived stats are invisible to anon exactly like the player
-- profile itself already is, with no separate rule to keep in sync.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Base fact views (not for direct display -- building blocks for the
-- aggregates below). Cancelled matches never contribute a fact: they never
-- happened.
-- ----------------------------------------------------------------------------

CREATE VIEW public.player_match_facts WITH (security_invoker = true) AS
SELECT
  ma.player_id,
  ma.match_id,
  ma.team_season_id,
  ts.season_id,
  t.club_id,
  ma.lineup_role,
  (ma.lineup_role = 'STARTER') AS is_start,
  -- A BENCH row only becomes a documented appearance if a SUBSTITUTION
  -- event actually brings this player on, for this match+team specifically
  -- (mission section 5) -- sitting on the bench alone counts for nothing.
  (ma.lineup_role = 'BENCH' AND EXISTS (
    SELECT 1 FROM public.match_events se
    WHERE se.match_id = ma.match_id AND se.team_season_id = ma.team_season_id
      AND se.event_type = 'SUBSTITUTION' AND se.secondary_player_id = ma.player_id
  )) AS is_substitute_appearance
FROM public.match_appearances ma
JOIN public.team_seasons ts ON ts.id = ma.team_season_id
JOIN public.teams t ON t.id = ts.team_id
JOIN public.matches m ON m.id = ma.match_id AND m.status <> 'CANCELLED';

comment on view public.player_match_facts is
  'One row per documented match_appearances entry, with the derived is_start/is_substitute_appearance booleans. Internal building block -- query player_team_season_stats/player_season_stats/player_career_stats for display.';

CREATE VIEW public.player_match_event_facts WITH (security_invoker = true) AS
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
JOIN public.matches m ON m.id = e.match_id AND m.status <> 'CANCELLED';

comment on view public.player_match_event_facts is
  'One row per match_events entry with team/season/club context attached. Internal building block.';

-- ----------------------------------------------------------------------------
-- Per (player, team_season): the finest-grained breakdown -- Club Studio
-- roster and the "Seniors A vs Seniors B" split on the Player page use this.
-- ----------------------------------------------------------------------------

CREATE VIEW public.player_team_season_stats WITH (security_invoker = true) AS
WITH appearance_agg AS (
  SELECT player_id, team_season_id, season_id, club_id,
    count(*) FILTER (WHERE is_start OR is_substitute_appearance) AS appearances,
    count(*) FILTER (WHERE is_start) AS starts,
    count(*) FILTER (WHERE is_substitute_appearance) AS substitute_appearances
  FROM public.player_match_facts
  GROUP BY player_id, team_season_id, season_id, club_id
),
event_agg AS (
  SELECT team_season_id, primary_player_id AS player_id,
    count(*) FILTER (WHERE event_type = 'GOAL') AS documented_goals,
    count(*) FILTER (WHERE event_type = 'OWN_GOAL') AS documented_own_goals,
    count(*) FILTER (WHERE event_type = 'YELLOW_CARD') AS yellow_cards,
    count(*) FILTER (WHERE event_type = 'RED_CARD') AS red_cards
  FROM public.player_match_event_facts
  GROUP BY team_season_id, primary_player_id
),
assist_agg AS (
  SELECT team_season_id, secondary_player_id AS player_id,
    count(*) FILTER (WHERE event_type = 'GOAL') AS documented_assists
  FROM public.player_match_event_facts
  WHERE secondary_player_id IS NOT NULL
  GROUP BY team_season_id, secondary_player_id
)
SELECT
  a.player_id, a.team_season_id, a.season_id, a.club_id,
  a.appearances, a.starts, a.substitute_appearances,
  coalesce(e.documented_goals, 0) AS documented_goals,
  coalesce(asst.documented_assists, 0) AS documented_assists,
  coalesce(e.documented_own_goals, 0) AS documented_own_goals,
  coalesce(e.yellow_cards, 0) AS yellow_cards,
  coalesce(e.red_cards, 0) AS red_cards
FROM appearance_agg a
LEFT JOIN event_agg e ON e.team_season_id = a.team_season_id AND e.player_id = a.player_id
LEFT JOIN assist_agg asst ON asst.team_season_id = a.team_season_id AND asst.player_id = a.player_id;

comment on view public.player_team_season_stats is
  'Derived stats per player per team_season. A player transferred mid-season has one row per team_season they actually appeared for -- never merged.';

-- ----------------------------------------------------------------------------
-- Per (player, club, season): the "Club A: 7 matches / Club B: 5 matches"
-- transfer breakdown (mission section 12) -- rolls team_season up to club
-- in case a player bounced between e.g. Seniors A/B of the same club.
-- ----------------------------------------------------------------------------

CREATE VIEW public.player_club_season_stats WITH (security_invoker = true) AS
WITH appearance_agg AS (
  SELECT player_id, season_id, club_id,
    count(DISTINCT match_id) FILTER (WHERE is_start OR is_substitute_appearance) AS appearances,
    count(DISTINCT match_id) FILTER (WHERE is_start) AS starts,
    count(DISTINCT match_id) FILTER (WHERE is_substitute_appearance) AS substitute_appearances
  FROM public.player_match_facts
  GROUP BY player_id, season_id, club_id
),
event_agg AS (
  SELECT season_id, club_id, primary_player_id AS player_id,
    count(*) FILTER (WHERE event_type = 'GOAL') AS documented_goals,
    count(*) FILTER (WHERE event_type = 'OWN_GOAL') AS documented_own_goals,
    count(*) FILTER (WHERE event_type = 'YELLOW_CARD') AS yellow_cards,
    count(*) FILTER (WHERE event_type = 'RED_CARD') AS red_cards
  FROM public.player_match_event_facts
  GROUP BY season_id, club_id, primary_player_id
),
assist_agg AS (
  SELECT season_id, club_id, secondary_player_id AS player_id,
    count(*) FILTER (WHERE event_type = 'GOAL') AS documented_assists
  FROM public.player_match_event_facts
  WHERE secondary_player_id IS NOT NULL
  GROUP BY season_id, club_id, secondary_player_id
)
SELECT
  a.player_id, a.season_id, a.club_id,
  a.appearances, a.starts, a.substitute_appearances,
  coalesce(e.documented_goals, 0) AS documented_goals,
  coalesce(asst.documented_assists, 0) AS documented_assists,
  coalesce(e.documented_own_goals, 0) AS documented_own_goals,
  coalesce(e.yellow_cards, 0) AS yellow_cards,
  coalesce(e.red_cards, 0) AS red_cards
FROM appearance_agg a
LEFT JOIN event_agg e ON e.season_id = a.season_id AND e.club_id = a.club_id AND e.player_id = a.player_id
LEFT JOIN assist_agg asst ON asst.season_id = a.season_id AND asst.club_id = a.club_id AND asst.player_id = a.player_id;

-- ----------------------------------------------------------------------------
-- Per (player, season): the season total across every club/team the player
-- appeared for that season. Appearance-type counts use COUNT(DISTINCT
-- match_id) defensively (mission section 26/11) -- a player cannot log two
-- appearances for the same match no matter how many team_season rows
-- reference it.
-- ----------------------------------------------------------------------------

CREATE VIEW public.player_season_stats WITH (security_invoker = true) AS
WITH appearance_agg AS (
  SELECT player_id, season_id,
    count(DISTINCT match_id) FILTER (WHERE is_start OR is_substitute_appearance) AS appearances,
    count(DISTINCT match_id) FILTER (WHERE is_start) AS starts,
    count(DISTINCT match_id) FILTER (WHERE is_substitute_appearance) AS substitute_appearances
  FROM public.player_match_facts
  GROUP BY player_id, season_id
),
event_agg AS (
  SELECT season_id, primary_player_id AS player_id,
    count(*) FILTER (WHERE event_type = 'GOAL') AS documented_goals,
    count(*) FILTER (WHERE event_type = 'OWN_GOAL') AS documented_own_goals,
    count(*) FILTER (WHERE event_type = 'YELLOW_CARD') AS yellow_cards,
    count(*) FILTER (WHERE event_type = 'RED_CARD') AS red_cards
  FROM public.player_match_event_facts
  GROUP BY season_id, primary_player_id
),
assist_agg AS (
  SELECT season_id, secondary_player_id AS player_id,
    count(*) FILTER (WHERE event_type = 'GOAL') AS documented_assists
  FROM public.player_match_event_facts
  WHERE secondary_player_id IS NOT NULL
  GROUP BY season_id, secondary_player_id
)
SELECT
  a.player_id, a.season_id,
  a.appearances, a.starts, a.substitute_appearances,
  coalesce(e.documented_goals, 0) AS documented_goals,
  coalesce(asst.documented_assists, 0) AS documented_assists,
  coalesce(e.documented_own_goals, 0) AS documented_own_goals,
  coalesce(e.yellow_cards, 0) AS yellow_cards,
  coalesce(e.red_cards, 0) AS red_cards
FROM appearance_agg a
LEFT JOIN event_agg e ON e.season_id = a.season_id AND e.player_id = a.player_id
LEFT JOIN assist_agg asst ON asst.season_id = a.season_id AND asst.player_id = a.player_id;

-- ----------------------------------------------------------------------------
-- Per player, across every documented season: "Carrière documentée dans
-- D3" -- never called just "Carrière" in the UI (mission section 19), since
-- D3 only knows what clubs have documented, not a player's real history.
-- ----------------------------------------------------------------------------

CREATE VIEW public.player_career_stats WITH (security_invoker = true) AS
WITH appearance_agg AS (
  SELECT player_id,
    count(DISTINCT match_id) FILTER (WHERE is_start OR is_substitute_appearance) AS appearances,
    count(DISTINCT match_id) FILTER (WHERE is_start) AS starts,
    count(DISTINCT match_id) FILTER (WHERE is_substitute_appearance) AS substitute_appearances,
    count(DISTINCT season_id) AS documented_seasons,
    count(DISTINCT club_id) AS documented_clubs
  FROM public.player_match_facts
  GROUP BY player_id
),
event_agg AS (
  SELECT primary_player_id AS player_id,
    count(*) FILTER (WHERE event_type = 'GOAL') AS documented_goals,
    count(*) FILTER (WHERE event_type = 'OWN_GOAL') AS documented_own_goals,
    count(*) FILTER (WHERE event_type = 'YELLOW_CARD') AS yellow_cards,
    count(*) FILTER (WHERE event_type = 'RED_CARD') AS red_cards
  FROM public.player_match_event_facts
  GROUP BY primary_player_id
),
assist_agg AS (
  SELECT secondary_player_id AS player_id,
    count(*) FILTER (WHERE event_type = 'GOAL') AS documented_assists
  FROM public.player_match_event_facts
  WHERE secondary_player_id IS NOT NULL
  GROUP BY secondary_player_id
)
SELECT
  a.player_id,
  a.appearances, a.starts, a.substitute_appearances, a.documented_seasons, a.documented_clubs,
  coalesce(e.documented_goals, 0) AS documented_goals,
  coalesce(asst.documented_assists, 0) AS documented_assists,
  coalesce(e.documented_own_goals, 0) AS documented_own_goals,
  coalesce(e.yellow_cards, 0) AS yellow_cards,
  coalesce(e.red_cards, 0) AS red_cards
FROM appearance_agg a
LEFT JOIN event_agg e ON e.player_id = a.player_id
LEFT JOIN assist_agg asst ON asst.player_id = a.player_id;

-- ----------------------------------------------------------------------------
-- Coverage: how much of a team's played schedule actually has documented
-- data. matches_with_any_event_data deliberately never implies the events
-- of that match are complete (mission section 13) -- it only means at
-- least one event row exists.
-- ----------------------------------------------------------------------------

CREATE VIEW public.team_season_data_coverage WITH (security_invoker = true) AS
SELECT
  ts.id AS team_season_id,
  count(*) AS played_matches,
  count(*) FILTER (WHERE la.has_any_lineup) AS matches_with_any_lineup_data,
  count(*) FILTER (WHERE coalesce(la.starter_count, 0) >= 11) AS matches_with_complete_starting_lineup,
  count(*) FILTER (WHERE ea.has_any_event) AS matches_with_any_event_data
FROM public.team_seasons ts
JOIN public.matches m ON (m.home_team_season_id = ts.id OR m.away_team_season_id = ts.id) AND m.status = 'PLAYED'
LEFT JOIN LATERAL (
  SELECT
    EXISTS(SELECT 1 FROM public.match_appearances ma WHERE ma.match_id = m.id AND ma.team_season_id = ts.id) AS has_any_lineup,
    (SELECT count(*) FROM public.match_appearances ma WHERE ma.match_id = m.id AND ma.team_season_id = ts.id AND ma.lineup_role = 'STARTER') AS starter_count
) la ON true
LEFT JOIN LATERAL (
  SELECT EXISTS(SELECT 1 FROM public.match_events me WHERE me.match_id = m.id AND me.team_season_id = ts.id) AS has_any_event
) ea ON true
GROUP BY ts.id;

comment on view public.team_season_data_coverage is
  'played_matches = PLAYED matches involving this team_season. matches_with_any_event_data means at least one event exists for that match -- never a claim of completeness.';

GRANT SELECT ON
  public.player_match_facts, public.player_match_event_facts,
  public.player_team_season_stats, public.player_club_season_stats,
  public.player_season_stats, public.player_career_stats,
  public.team_season_data_coverage
TO anon, authenticated;

COMMIT;
