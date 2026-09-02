BEGIN;

CREATE TYPE public.club_claim_status AS ENUM ('PENDING','NEEDS_INFO','APPROVED','REJECTED','REVOKED');
CREATE TYPE public.club_membership_role AS ENUM ('OWNER','SPORTING_ADMIN','COMMUNICATION_ADMIN');
CREATE TYPE public.club_verification_method AS ENUM ('OFFICIAL_EMAIL','PUBLIC_CLUB_CONTACT','MANUAL_REVIEW');

CREATE TABLE public.club_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_role public.club_membership_role NOT NULL DEFAULT 'OWNER',
  relationship_to_club text NOT NULL CHECK (length(trim(relationship_to_club)) BETWEEN 2 AND 160),
  verification_method public.club_verification_method NOT NULL,
  verification_note text CHECK (verification_note IS NULL OR length(verification_note) <= 2000),
  status public.club_claim_status NOT NULL DEFAULT 'PENDING',
  admin_note text CHECK (admin_note IS NULL OR length(admin_note) <= 2000),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX club_claims_one_active_per_user_club
ON public.club_claims (club_id,user_id)
WHERE status IN ('PENDING','NEEDS_INFO','APPROVED');
CREATE INDEX club_claims_user_idx ON public.club_claims(user_id,submitted_at DESC);
CREATE INDEX club_claims_status_idx ON public.club_claims(status,submitted_at);

CREATE TABLE public.club_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.club_membership_role NOT NULL,
  active boolean NOT NULL DEFAULT true,
  source_claim_id uuid UNIQUE REFERENCES public.club_claims(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((active AND ended_at IS NULL) OR NOT active)
);

CREATE UNIQUE INDEX club_memberships_unique_active_role
ON public.club_memberships(club_id,user_id,role) WHERE active;
CREATE INDEX club_memberships_user_idx ON public.club_memberships(user_id,active);

ALTER TABLE public.clubs
  ADD COLUMN logo_path text,
  ADD COLUMN logo_source text CHECK (logo_source IS NULL OR logo_source IN ('CLUB','D3_ADMIN')),
  ADD COLUMN logo_updated_at timestamptz;

CREATE OR REPLACE FUNCTION public.has_active_club_role(target_club_id uuid, allowed_roles public.club_membership_role[] DEFAULT ARRAY['OWNER']::public.club_membership_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.club_memberships membership
    WHERE membership.club_id=target_club_id
      AND membership.user_id=(SELECT auth.uid())
      AND membership.active
      AND membership.role=ANY(allowed_roles)
  ) OR public.is_d3_admin();
$$;
REVOKE ALL ON FUNCTION public.has_active_club_role(uuid,public.club_membership_role[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.has_active_club_role(uuid,public.club_membership_role[]) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.audit_claim_submission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$ BEGIN
  INSERT INTO public.admin_audit_logs(actor_user_id,action,entity_type,entity_id,details)
  VALUES(NEW.user_id,'claim_submitted','club_claim',NEW.id,jsonb_build_object('club_id',NEW.club_id,'requested_role',NEW.requested_role));
  RETURN NEW;
END $$;
CREATE TRIGGER audit_claim_submission AFTER INSERT ON public.club_claims
FOR EACH ROW EXECUTE FUNCTION public.audit_claim_submission();

CREATE OR REPLACE FUNCTION public.resolve_club_claim(claim_id uuid, decision public.club_claim_status, note text, actor_id uuid)
RETURNS public.club_claims LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE claim public.club_claims; membership_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id=actor_id AND p.d3_admin_role IS NOT NULL) THEN
    RAISE EXCEPTION 'D3 admin required';
  END IF;
  IF decision NOT IN ('APPROVED','NEEDS_INFO','REJECTED') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
  IF decision IN ('NEEDS_INFO','REJECTED') AND length(trim(coalesce(note,'')))=0 THEN RAISE EXCEPTION 'Admin note required'; END IF;
  SELECT * INTO claim FROM public.club_claims WHERE id=claim_id FOR UPDATE;
  IF claim.id IS NULL THEN RAISE EXCEPTION 'Claim not found'; END IF;
  IF claim.status='APPROVED' AND decision='APPROVED' THEN RETURN claim; END IF;
  IF claim.status NOT IN ('PENDING','NEEDS_INFO') THEN RAISE EXCEPTION 'Claim already resolved'; END IF;

  UPDATE public.club_claims SET status=decision,admin_note=NULLIF(trim(note),''),
    resolved_at=CASE WHEN decision IN ('APPROVED','REJECTED') THEN now() ELSE NULL END,
    resolved_by=actor_id,updated_at=now() WHERE id=claim_id RETURNING * INTO claim;

  IF decision='APPROVED' THEN
    INSERT INTO public.club_memberships(club_id,user_id,role,source_claim_id)
    VALUES(claim.club_id,claim.user_id,'OWNER',claim.id)
    ON CONFLICT (source_claim_id) DO UPDATE SET active=true,ended_at=NULL,updated_at=now()
    RETURNING id INTO membership_id;
    UPDATE public.clubs SET claim_status='claimed',updated_at=now() WHERE id=claim.club_id;
    INSERT INTO public.admin_audit_logs(actor_user_id,action,entity_type,entity_id,details) VALUES
      (actor_id,'claim_approved','club_claim',claim.id,jsonb_build_object('club_id',claim.club_id)),
      (actor_id,'membership_created','club_membership',membership_id,jsonb_build_object('club_id',claim.club_id,'role','OWNER'));
  ELSE
    INSERT INTO public.admin_audit_logs(actor_user_id,action,entity_type,entity_id,details)
    VALUES(actor_id,CASE WHEN decision='NEEDS_INFO' THEN 'claim_needs_info' ELSE 'claim_rejected' END,
      'club_claim',claim.id,jsonb_build_object('club_id',claim.club_id,'reason',note));
  END IF;
  RETURN claim;
END $$;
REVOKE ALL ON FUNCTION public.resolve_club_claim(uuid,public.club_claim_status,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_club_claim(uuid,public.club_claim_status,text,uuid) TO service_role;

ALTER TABLE public.club_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY club_claims_select_own ON public.club_claims FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE POLICY club_claims_insert_own ON public.club_claims FOR INSERT TO authenticated
WITH CHECK(user_id=(SELECT auth.uid()) AND status='PENDING' AND requested_role='OWNER' AND resolved_at IS NULL AND resolved_by IS NULL AND admin_note IS NULL);
CREATE POLICY club_claims_answer_own ON public.club_claims FOR UPDATE TO authenticated
USING(user_id=(SELECT auth.uid()) AND status='NEEDS_INFO')
WITH CHECK(user_id=(SELECT auth.uid()) AND status='NEEDS_INFO' AND resolved_at IS NULL);
CREATE POLICY club_memberships_select_own ON public.club_memberships FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));

REVOKE ALL ON public.club_claims FROM anon,authenticated;
GRANT SELECT,INSERT ON public.club_claims TO authenticated;
GRANT UPDATE (relationship_to_club,verification_method,verification_note,updated_at) ON public.club_claims TO authenticated;
REVOKE ALL ON public.club_memberships FROM anon,authenticated;
GRANT SELECT ON public.club_memberships TO authenticated;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('club-assets','club-assets',false,5242880,ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=5242880,allowed_mime_types=EXCLUDED.allowed_mime_types;

CREATE POLICY club_assets_owner_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK(bucket_id='club-assets' AND (storage.foldername(name))[1]='clubs'
  AND (storage.foldername(name))[3]='logo'
  AND public.has_active_club_role(((storage.foldername(name))[2])::uuid,ARRAY['OWNER']::public.club_membership_role[]));
CREATE POLICY club_assets_owner_select ON storage.objects FOR SELECT TO authenticated
USING(bucket_id='club-assets' AND (storage.foldername(name))[1]='clubs'
  AND public.has_active_club_role(((storage.foldername(name))[2])::uuid,ARRAY['OWNER']::public.club_membership_role[]));
CREATE POLICY club_assets_owner_update ON storage.objects FOR UPDATE TO authenticated
USING(bucket_id='club-assets' AND (storage.foldername(name))[1]='clubs'
  AND public.has_active_club_role(((storage.foldername(name))[2])::uuid,ARRAY['OWNER']::public.club_membership_role[]))
WITH CHECK(bucket_id='club-assets' AND (storage.foldername(name))[1]='clubs'
  AND public.has_active_club_role(((storage.foldername(name))[2])::uuid,ARRAY['OWNER']::public.club_membership_role[]));
CREATE POLICY club_assets_owner_delete ON storage.objects FOR DELETE TO authenticated
USING(bucket_id='club-assets' AND (storage.foldername(name))[1]='clubs'
  AND public.has_active_club_role(((storage.foldername(name))[2])::uuid,ARRAY['OWNER']::public.club_membership_role[]));

CREATE TRIGGER set_club_claims_updated_at BEFORE UPDATE ON public.club_claims FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_club_memberships_updated_at BEFORE UPDATE ON public.club_memberships FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
