BEGIN;

-- Bug found immediately after applying 20260909100000: PostgreSQL's regex
-- engine (Tcl ARE) rejects a bound repetition count above its internal
-- RE_DUP_MAX ("invalid repetition count(s)") -- {1,2048} never worked at
-- all, so is_safe_external_url raised an error on every single call
-- instead of returning true/false, which would have made every
-- update_club_profile call fail the moment it touched a CHECK constraint
-- on any URL column. Bounding the length separately with plain length()
-- (no regex bound involved) and switching \s for the portable [:space:]
-- POSIX class fixes it, verified against a range of inputs before this
-- ships.
CREATE OR REPLACE FUNCTION public.is_safe_external_url(url text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=''
AS $$ SELECT url IS NULL OR (length(url) <= 2048 AND url ~* '^https?://[^[:space:]<>"'']+$') $$;

COMMIT;
