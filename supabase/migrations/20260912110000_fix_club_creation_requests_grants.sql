BEGIN;

-- Gap fix: Supabase grants ALL PRIVILEGES on newly created public-schema
-- tables to anon/authenticated/service_role by default. The original
-- migration only revoked from anon, leaving `authenticated` with a full
-- blanket UPDATE/DELETE grant on club_creation_requests despite RLS having
-- no UPDATE/DELETE policy for it -- RLS policies control which ROWS a
-- grant applies to, they never substitute for the grant itself, so a
-- missing REVOKE here would have let any authenticated user UPDATE or
-- DELETE their own (and, once a matching USING clause existed, any) row
-- directly, bypassing resolve_club_creation_request/
-- approve_club_creation_request entirely. Same bug class as the Step 6A
-- gap closure (updated_by exposed to anon via a blanket table grant).
REVOKE ALL ON public.club_creation_requests FROM anon, authenticated;
GRANT SELECT, INSERT ON public.club_creation_requests TO authenticated;

COMMIT;
