BEGIN;

-- ============================================================================
-- STEP 6A gap closure -- two issues found in review before merge:
--
-- GAP 1: the mission requires https:// only for every public URL field;
-- is_safe_external_url() accepted http:// too. Data check performed before
-- writing this migration: `select club_id,website_url,facebook_url,
-- instagram_url,x_url,tiktok_url,youtube_url from club_profiles` returned
-- ZERO rows in total (the table is currently empty -- every fixture from
-- Step 5C/6A closeouts was cleaned up) and specifically zero http:// values
-- in any URL column. No data migration/backfill is needed; the stricter
-- CHECK constraints below are safe to apply as-is.
--
-- GAP 2: club_profiles.updated_by (an auth.users id -- internal) was
-- reachable by anon/authenticated because the table had a blanket
-- `GRANT SELECT ON club_profiles TO anon, authenticated`. RLS policies
-- control row visibility, never column visibility, so the
-- `club_profiles_public_read USING (true)` policy never protected this --
-- anon could `select=updated_by` directly over PostgREST. Fixed by
-- revoking the table-level grant entirely from anon/authenticated and
-- replacing it with a dedicated public view exposing only the columns an
-- OWNER actually publishes. The view is intentionally NOT
-- security_invoker (default: runs with the view owner's privileges, like
-- every other view in this project before Step 5C's security_invoker
-- views) -- that default is exactly right here because the correctness
-- concern is column-level (hide updated_by), not row-level: the
-- underlying club_profiles_public_read policy is already `USING (true)`
-- with no per-caller row filtering to preserve, unlike Step 5C's
-- player views over profile_status-gated `players`. Server-side code
-- (lib/clubs/profile-data.ts) already uses the service_role admin client
-- and an explicit safe column list -- unaffected either way -- but the
-- revoke closes direct REST/API access for anon and authenticated.
-- ============================================================================

-- ---- GAP 1: https:// only, no http:// -------------------------------------

CREATE OR REPLACE FUNCTION public.is_safe_external_url(url text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=''
AS $$ SELECT url IS NULL OR (length(url) <= 2048 AND url ~* '^https://[^[:space:]<>"'']+$') $$;

COMMENT ON FUNCTION public.is_safe_external_url(text) IS
  'https:// only (mission requirement) -- http://, javascript:, data:, file:, ftp:, protocol-relative "//host" and every other scheme are rejected. Referenced by club_profiles'' website_url/facebook_url/instagram_url/x_url/tiktok_url/youtube_url CHECK constraints -- changing this function retroactively tightens all six at once, but (as always with CHECK constraints backed by a function) does not itself re-validate rows already in the table; the data scan above confirms there were none to worry about here.';

-- ---- GAP 2: updated_by must never be selectable by anon/authenticated -----

REVOKE SELECT ON public.club_profiles FROM anon, authenticated;

CREATE VIEW public.club_profiles_public AS
SELECT
  club_id, short_description, long_description, founded_year, primary_color, secondary_color,
  website_url, facebook_url, instagram_url, x_url, tiktok_url, youtube_url,
  public_email, public_phone, venue_name, venue_address, venue_postal_code, venue_city
FROM public.club_profiles;

COMMENT ON VIEW public.club_profiles_public IS
  'The only club_profiles read surface for anon/authenticated. Deliberately excludes updated_by (an internal auth.users id) and created_at/updated_at (not used publicly). Plain view (not security_invoker) by design: permission checks and the underlying USING(true) RLS policy both evaluate as the view owner, which is exactly right for a table whose SELECT policy already has no per-caller row filtering to preserve.';

GRANT SELECT ON public.club_profiles_public TO anon, authenticated;

COMMIT;
