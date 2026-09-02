DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN (
      'user_profiles',
      'seasons',
      'clubs',
      'teams',
      'competitions',
      'competition_seasons',
      'competition_groups',
      'team_seasons',
      'venues',
      'data_sources',
      'external_identities'
    );

  IF v_count <> 11 THEN
    RAISE EXCEPTION 'Expected 11 foundation tables, found %', v_count;
  END IF;
END $$;

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'clubs'
    AND policyname IN ('clubs_select_public', 'clubs_admin_manage');

  IF v_count <> 2 THEN
    RAISE EXCEPTION 'clubs RLS policies missing';
  END IF;
END $$;

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_extension
  WHERE extname IN ('pg_trgm', 'unaccent');

  IF v_count <> 2 THEN
    RAISE EXCEPTION 'search extensions missing';
  END IF;
END $$;

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.data_sources
  WHERE code IN ('D3_ADMIN', 'CLUB', 'PLAYER', 'RNA', 'DATA_ES');

  IF v_count <> 5 THEN
    RAISE EXCEPTION 'seed data_sources missing expected codes';
  END IF;
END $$;

DO $$
DECLARE
  v_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'is_d3_admin'
  ) INTO v_exists;

  IF NOT v_exists THEN
    RAISE EXCEPTION 'is_d3_admin function missing';
  END IF;
END $$;
