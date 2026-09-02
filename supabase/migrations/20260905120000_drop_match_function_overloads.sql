BEGIN;

-- 20260905110000 added p_venue_name as a new trailing parameter via
-- CREATE OR REPLACE, but Postgres resolves functions by full signature
-- (name + argument types), not name alone -- so that created a *second*
-- overload of create_match/update_match instead of replacing the first,
-- and PostgREST's RPC endpoint can no longer disambiguate which one to
-- call. Drop the old, pre-venue_name signatures explicitly; only the
-- 9-parameter versions (with p_venue_name) should exist afterward.
DROP FUNCTION IF EXISTS public.create_match(uuid,uuid,uuid,text,uuid,uuid,uuid,timestamptz);
DROP FUNCTION IF EXISTS public.update_match(uuid,uuid,uuid,uuid,text,timestamptz,uuid,uuid,uuid);

COMMIT;
