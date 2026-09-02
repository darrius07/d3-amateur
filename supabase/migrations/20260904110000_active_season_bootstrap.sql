BEGIN;

-- Step 4 (ensure_senior_team) requires an active season to attach team_seasons
-- to, but nothing before Step 4 ever created one — `seasons` was empty in
-- production. French amateur football seasons run July -> June; this
-- computes the season straddling CURRENT_DATE at migration-apply time
-- instead of hardcoding a literal year, and only inserts when no active
-- season already exists, so it is a no-op once a real season (RNA/D3 admin
-- managed) takes over.
CREATE OR REPLACE FUNCTION public.season_label_for_date(value date)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE WHEN EXTRACT(MONTH FROM value) >= 7
    THEN EXTRACT(YEAR FROM value)::int || '-' || (EXTRACT(YEAR FROM value)::int + 1)
    ELSE (EXTRACT(YEAR FROM value)::int - 1) || '-' || EXTRACT(YEAR FROM value)::int
  END;
$$;

INSERT INTO public.seasons (label, start_date, end_date, active)
SELECT
  public.season_label_for_date(current_date),
  make_date(CASE WHEN EXTRACT(MONTH FROM current_date) >= 7 THEN EXTRACT(YEAR FROM current_date)::int ELSE EXTRACT(YEAR FROM current_date)::int - 1 END, 7, 1),
  make_date(CASE WHEN EXTRACT(MONTH FROM current_date) >= 7 THEN EXTRACT(YEAR FROM current_date)::int + 1 ELSE EXTRACT(YEAR FROM current_date)::int END, 6, 30),
  true
WHERE NOT EXISTS (SELECT 1 FROM public.seasons WHERE active)
ON CONFLICT (label) DO NOTHING;

COMMIT;
