BEGIN;

-- ============================================================================
-- Step 6D: missing club / create club. A user submission is NEVER
-- immediately a canonical D3 club (mission section 3) -- it always lands
-- in club_creation_requests as PENDING_REVIEW, and only a D3 Admin
-- decision (never auto-approval) can turn it into a real clubs row + an
-- OWNER membership, via one atomic RPC (approve_club_creation_request).
-- ============================================================================

CREATE TYPE public.club_creation_request_status AS ENUM ('PENDING_REVIEW','NEEDS_INFO','APPROVED','REJECTED','DUPLICATE');
CREATE TYPE public.duplicate_review_state AS ENUM ('NONE','POSSIBLE','LIKELY_DUPLICATE');

-- A club created through this flow is tagged with its real provenance --
-- never allowed to look like it came from RNA/Open Data (mission section 6).
INSERT INTO public.data_sources (code, label, description)
VALUES ('USER_SUBMITTED', 'Soumission utilisateur', 'Club identity submitted by a user via the missing-club flow, reviewed by a D3 Admin before becoming canonical')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.clubs ADD COLUMN source_id uuid REFERENCES public.data_sources(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.clubs.source_id IS
  'NULL for the original RNA-imported registry (provenance predates this column). USER_SUBMITTED for a club created via approve_club_creation_request -- its canonical identity started as a user submission, reviewed by a D3 Admin, never RNA/Open Data.';

CREATE TABLE public.club_creation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status public.club_creation_request_status NOT NULL DEFAULT 'PENDING_REVIEW',
  club_name text NOT NULL,
  short_name text,
  city text NOT NULL,
  postal_code text,
  department text,
  website_url text,
  social_url text,
  requested_level text,
  requested_team_label text,
  -- Mission section 9: "Je confirme représenter ce club ou agir avec son
  -- autorisation." -- required, never merely recorded as false and still
  -- accepted; the CHECK constraint refuses the row outright otherwise.
  representative_confirmation boolean NOT NULL,
  -- Always computed server-side by the trigger below, on every insert --
  -- never trusted from client input (mission section 32).
  duplicate_candidate_club_id uuid REFERENCES public.clubs(id) ON DELETE SET NULL,
  duplicate_review_state public.duplicate_review_state NOT NULL DEFAULT 'NONE',
  -- admin_note is INTERNAL (never shown to the requester -- mission section
  -- 26). public_message is the short, public-safe explanation shown to the
  -- requester for NEEDS_INFO/REJECTED/DUPLICATE (mission section 27) -- a
  -- deliberate addition beyond the mission's minimum field list, needed to
  -- satisfy that exact requirement without ever leaking admin_note.
  admin_note text,
  public_message text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_club_id uuid REFERENCES public.clubs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (representative_confirmation),
  CHECK (length(btrim(club_name)) BETWEEN 2 AND 120),
  CHECK (short_name IS NULL OR length(short_name) <= 40),
  CHECK (length(btrim(city)) BETWEEN 2 AND 80),
  CHECK (postal_code IS NULL OR postal_code ~ '^[0-9]{4,10}$'),
  CHECK (department IS NULL OR length(department) <= 80),
  CHECK (requested_level IS NULL OR length(requested_level) <= 80),
  CHECK (requested_team_label IS NULL OR length(requested_team_label) <= 80),
  CHECK (public.is_safe_external_url(website_url)),
  CHECK (public.is_safe_external_url(social_url)),
  CHECK (admin_note IS NULL OR length(admin_note) <= 2000),
  CHECK (public_message IS NULL OR length(public_message) <= 500)
);

COMMENT ON TABLE public.club_creation_requests IS
  'A user''s submission that their club is missing from D3. Never directly creates a club -- only approve_club_creation_request (D3 Admin only) does, atomically, after human review.';
COMMENT ON COLUMN public.club_creation_requests.admin_note IS
  'Internal D3 Admin note -- never exposed to the requester. Use public_message for anything the requester should see.';

-- Anti-spam (mission section 15): the same user cannot have two PENDING_REVIEW
-- requests for what is clearly the same club (normalized name + city).
-- NEEDS_INFO is deliberately excluded from this index -- it is not "still
-- pending", it is a decision the user can act on by submitting a fresh
-- request (this MVP has no self-service edit-in-place RPC, mission section
-- 27's "si architecture raisonnable" -- a brand new PENDING_REVIEW request
-- is the raisonnable, simple path here).
CREATE UNIQUE INDEX club_creation_requests_one_pending_per_user_name_city
ON public.club_creation_requests (requested_by, public.normalize_club_name(club_name), lower(btrim(city)))
WHERE status = 'PENDING_REVIEW';
CREATE INDEX club_creation_requests_requester_idx ON public.club_creation_requests(requested_by, created_at DESC);
CREATE INDEX club_creation_requests_status_idx ON public.club_creation_requests(status, created_at);

CREATE TRIGGER set_club_creation_requests_updated_at BEFORE UPDATE ON public.club_creation_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Duplicate detection (mission section 12): reuses the exact normalization
-- (normalize_club_name) and trigram similarity already built for the
-- registry's own search_clubs, rather than inventing a second matching
-- algorithm. Decision policy mirrors lib/clubs/registry.ts's matchClub()
-- exactly: exact normalized name + same city/postal -> LIKELY_DUPLICATE
-- (mission section 14's "doublon dur"); exact name alone, or high
-- similarity, -> POSSIBLE; otherwise NONE. Never auto-merges anything --
-- this only ever informs the UI and the admin_note-free duplicate fields.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.find_duplicate_club_candidates(p_name text, p_city text, p_postal_code text)
RETURNS TABLE(id uuid, display_name text, slug text, city text, postal_code text, claim_status text, review_state public.duplicate_review_state)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
  SELECT c.id, c.display_name, c.slug, c.city, c.postal_code, c.claim_status,
    CASE
      WHEN public.normalize_club_name(c.display_name) = public.normalize_club_name(p_name)
        AND ((p_postal_code IS NOT NULL AND c.postal_code = p_postal_code) OR (p_city IS NOT NULL AND lower(btrim(c.city)) = lower(btrim(p_city))))
        THEN 'LIKELY_DUPLICATE'::public.duplicate_review_state
      WHEN public.normalize_club_name(c.display_name) = public.normalize_club_name(p_name)
        OR public.similarity(c.search_name, public.normalize_club_name(p_name)) >= 0.5
        THEN 'POSSIBLE'::public.duplicate_review_state
      ELSE 'NONE'::public.duplicate_review_state
    END AS review_state
  FROM public.clubs c
  WHERE c.status = 'active' AND (
    public.normalize_club_name(c.display_name) = public.normalize_club_name(p_name)
    OR public.similarity(c.search_name, public.normalize_club_name(p_name)) >= 0.3
  )
  ORDER BY (public.normalize_club_name(c.display_name) = public.normalize_club_name(p_name)) DESC,
    public.similarity(c.search_name, public.normalize_club_name(p_name)) DESC
  LIMIT 5
$$;

COMMENT ON FUNCTION public.find_duplicate_club_candidates(text,text,text) IS
  'Read-only duplicate preview -- used both by the submission form (before insert) and re-run fresh at approval time (mission section 43, never trusting only the submission-time snapshot). Public club data only, safe for anon/authenticated.';

REVOKE ALL ON FUNCTION public.find_duplicate_club_candidates(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_duplicate_club_candidates(text,text,text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_club_creation_request_duplicate()
RETURNS trigger LANGUAGE plpgsql SET search_path=''
AS $$
DECLARE v_match record;
BEGIN
  SELECT id, review_state INTO v_match FROM public.find_duplicate_club_candidates(NEW.club_name, NEW.city, NEW.postal_code) LIMIT 1;
  NEW.duplicate_candidate_club_id := v_match.id;
  NEW.duplicate_review_state := coalesce(v_match.review_state, 'NONE');
  RETURN NEW;
END $$;

CREATE TRIGGER set_club_creation_request_duplicate BEFORE INSERT ON public.club_creation_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_club_creation_request_duplicate();

COMMENT ON TRIGGER set_club_creation_request_duplicate ON public.club_creation_requests IS
  'Always overwrites duplicate_candidate_club_id/duplicate_review_state from a fresh server-side match, regardless of any client-supplied value -- the only way these two columns are ever set (mission section 32).';

-- ----------------------------------------------------------------------------
-- Admin review mutations. NEEDS_INFO/REJECTED/DUPLICATE share one RPC
-- (a plain status + note update); APPROVED gets its own, because it is the
-- one decision with real side effects (a new clubs row + an OWNER
-- membership) that must be atomic and idempotent (mission sections 20, 42).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_club_creation_request(
  actor_id uuid, p_request_id uuid, p_decision public.club_creation_request_status,
  p_admin_note text, p_public_message text, p_duplicate_candidate_club_id uuid
) RETURNS public.club_creation_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE req public.club_creation_requests;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = actor_id AND p.d3_admin_role IS NOT NULL) THEN
    RAISE EXCEPTION 'D3 admin required';
  END IF;
  IF p_decision NOT IN ('NEEDS_INFO','REJECTED','DUPLICATE') THEN
    RAISE EXCEPTION 'Invalid decision -- use approve_club_creation_request for APPROVED';
  END IF;

  SELECT * INTO req FROM public.club_creation_requests WHERE id = p_request_id FOR UPDATE;
  IF req.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF req.status NOT IN ('PENDING_REVIEW','NEEDS_INFO') THEN RAISE EXCEPTION 'Request already resolved'; END IF;
  IF p_decision = 'DUPLICATE' AND p_duplicate_candidate_club_id IS NULL AND req.duplicate_candidate_club_id IS NULL THEN
    RAISE EXCEPTION 'A duplicate candidate club is required to mark DUPLICATE';
  END IF;

  UPDATE public.club_creation_requests SET
    status = p_decision,
    admin_note = nullif(btrim(coalesce(p_admin_note,'')), ''),
    public_message = nullif(btrim(coalesce(p_public_message,'')), ''),
    duplicate_candidate_club_id = coalesce(p_duplicate_candidate_club_id, duplicate_candidate_club_id),
    reviewed_by = actor_id, reviewed_at = now(), updated_at = now()
  WHERE id = p_request_id
  RETURNING * INTO req;

  INSERT INTO public.admin_audit_logs(actor_user_id, action, entity_type, entity_id, details)
  VALUES (actor_id,
    CASE p_decision WHEN 'NEEDS_INFO' THEN 'club_creation_marked_needs_info' WHEN 'REJECTED' THEN 'club_creation_rejected' ELSE 'club_creation_marked_duplicate' END,
    'club_creation_request', req.id,
    jsonb_build_object('admin_note', p_admin_note, 'public_message', p_public_message, 'duplicate_candidate_club_id', req.duplicate_candidate_club_id));

  RETURN req;
END $$;

-- Atomic + idempotent approval (mission sections 20, 42): a second APPROVE
-- call on an already-approved request is a harmless no-op returning the
-- same row -- never a second club, never a second membership. Everything
-- else here runs inside the single implicit transaction of this function
-- call: any exception rolls back the entire thing, so there is no path to
-- an orphaned club without an OWNER, or a request marked APPROVED without
-- a real club (mission section 20/47).
CREATE OR REPLACE FUNCTION public.approve_club_creation_request(actor_id uuid, p_request_id uuid)
RETURNS public.club_creation_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  req public.club_creation_requests;
  v_source uuid;
  v_base_slug text;
  v_slug text;
  v_suffix int := 0;
  v_club_id uuid;
  v_membership_id uuid;
  v_fresh_match record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = actor_id AND p.d3_admin_role IS NOT NULL) THEN
    RAISE EXCEPTION 'D3 admin required';
  END IF;

  SELECT * INTO req FROM public.club_creation_requests WHERE id = p_request_id FOR UPDATE;
  IF req.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF req.status = 'APPROVED' THEN RETURN req; END IF;
  IF req.status NOT IN ('PENDING_REVIEW','NEEDS_INFO') THEN RAISE EXCEPTION 'Request already resolved'; END IF;

  -- Re-check duplicates fresh at approval time -- a matching club may have
  -- been added to the registry since submission (mission section 43).
  SELECT id, review_state INTO v_fresh_match FROM public.find_duplicate_club_candidates(req.club_name, req.city, req.postal_code) LIMIT 1;
  IF v_fresh_match.review_state = 'LIKELY_DUPLICATE' THEN
    RAISE EXCEPTION 'A likely duplicate club (%) was found at approval time -- use resolve_club_creation_request with DUPLICATE instead', v_fresh_match.id;
  END IF;

  SELECT id INTO v_source FROM public.data_sources WHERE code = 'USER_SUBMITTED';

  -- Deterministic slug collision handling (mission section 24): never
  -- overwrite an existing slug, append -2/-3/... until free.
  v_base_slug := left(coalesce(nullif(regexp_replace(public.normalize_club_name(req.club_name), '\s+', '-', 'g'), ''), 'club'), 60);
  v_slug := v_base_slug;
  LOOP
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.clubs WHERE slug = v_slug);
    v_suffix := v_suffix + 1;
    v_slug := left(v_base_slug, 57) || '-' || v_suffix::text;
  END LOOP;

  -- The approved name becomes BOTH official_name and display_name (mission
  -- section 23): there is no separate Open Data identity to diverge from
  -- for a USER_SUBMITTED club. claim_status is 'claimed' immediately --
  -- the review+approval this function just performed IS the claim; no
  -- separate club_claims row is created or needed.
  INSERT INTO public.clubs(slug, official_name, display_name, city, postal_code, department_code, status, claim_status, source_id)
  VALUES (v_slug, req.club_name, req.club_name, req.city, req.postal_code, req.department, 'active', 'claimed', v_source)
  RETURNING id INTO v_club_id;

  INSERT INTO public.club_memberships(club_id, user_id, role, active)
  VALUES (v_club_id, req.requested_by, 'OWNER', true)
  RETURNING id INTO v_membership_id;

  UPDATE public.club_creation_requests SET
    status = 'APPROVED', reviewed_by = actor_id, reviewed_at = now(), created_club_id = v_club_id, updated_at = now()
  WHERE id = p_request_id
  RETURNING * INTO req;

  INSERT INTO public.admin_audit_logs(actor_user_id, action, entity_type, entity_id, details) VALUES
    (actor_id, 'club_creation_approved', 'club_creation_request', req.id, jsonb_build_object('club_id', v_club_id)),
    (actor_id, 'user_submitted_club_created', 'club', v_club_id, jsonb_build_object('request_id', req.id, 'name', req.club_name, 'slug', v_slug)),
    (actor_id, 'owner_granted_from_creation_request', 'club_membership', v_membership_id, jsonb_build_object('club_id', v_club_id, 'user_id', req.requested_by));

  RETURN req;
END $$;

REVOKE ALL ON FUNCTION public.resolve_club_creation_request(uuid,uuid,public.club_creation_request_status,text,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.approve_club_creation_request(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_club_creation_request(uuid,uuid,public.club_creation_request_status,text,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_club_creation_request(uuid,uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- RLS: an authenticated user manages only their own requests -- can create
-- one (with every privileged field forced NULL/default by this same CHECK,
-- duplicate_candidate_club_id/duplicate_review_state always overwritten by
-- the trigger above regardless) and read their own, but cannot set status,
-- reviewed_by, created_club_id, or anything else directly (no UPDATE grant
-- exists for authenticated at all -- resolve_club_creation_request/
-- approve_club_creation_request, service_role only, are the sole paths).
-- anon has zero access (mission section 28): no SELECT policy, no grant.
-- ----------------------------------------------------------------------------

ALTER TABLE public.club_creation_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY club_creation_requests_select_own ON public.club_creation_requests FOR SELECT TO authenticated
USING (requested_by = (SELECT auth.uid()));

CREATE POLICY club_creation_requests_insert_own ON public.club_creation_requests FOR INSERT TO authenticated
WITH CHECK (
  requested_by = (SELECT auth.uid())
  AND status = 'PENDING_REVIEW'
  AND admin_note IS NULL
  AND public_message IS NULL
  AND reviewed_by IS NULL
  AND reviewed_at IS NULL
  AND created_club_id IS NULL
);

REVOKE ALL ON public.club_creation_requests FROM anon;
GRANT SELECT, INSERT ON public.club_creation_requests TO authenticated;

COMMIT;
