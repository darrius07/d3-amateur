BEGIN;

-- classifyCandidate() (lib/players/identity.ts, already unit-tested) needs
-- club_id/season_id to tell "same name, same club/season -> very likely"
-- from "same name, different club -> ambiguous, never auto-merged", but
-- search_players() only ever returned display strings (club_name/
-- team_name) — it was wired nowhere. Adding the ids lets the Club Studio
-- player search show that distinction to the OWNER instead of a flat,
-- undifferentiated candidate list. Return shape changes, so the function
-- must be dropped and recreated (Postgres does not allow CREATE OR REPLACE
-- to change a function's result columns).
DROP FUNCTION IF EXISTS public.search_players(text,integer);

CREATE FUNCTION public.search_players(query text,result_limit integer DEFAULT 12)
RETURNS TABLE(id uuid,display_name text,slug text,primary_position public.player_position,club_id uuid,club_name text,season_id uuid,team_name text,rank real)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
  SELECT p.id,p.display_name,p.slug,p.primary_position,c.id,c.display_name,r.season_id,t.display_name,
    greatest(public.similarity(p.normalized_name,public.normalize_player_name(query)),CASE WHEN p.normalized_name LIKE '%'||public.normalize_player_name(query)||'%' THEN .8 ELSE 0 END)::real
  FROM public.players p
  LEFT JOIN public.player_registrations r ON r.player_id=p.id AND r.status='ACTIVE'
  LEFT JOIN public.clubs c ON c.id=r.club_id
  LEFT JOIN public.team_roster_members trm ON trm.player_id=p.id AND trm.active
  LEFT JOIN public.team_seasons ts ON ts.id=trm.team_season_id AND ts.season_id=r.season_id
  LEFT JOIN public.teams t ON t.id=ts.team_id
  WHERE p.profile_status='PUBLIC' AND (public.similarity(p.normalized_name,public.normalize_player_name(query))>=.24 OR p.normalized_name LIKE '%'||public.normalize_player_name(query)||'%')
  ORDER BY 9 DESC,p.display_name LIMIT least(greatest(result_limit,1),30);
$$;
REVOKE ALL ON FUNCTION public.search_players(text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_players(text,integer) TO anon,authenticated;

COMMIT;
