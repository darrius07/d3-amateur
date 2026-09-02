BEGIN;

CREATE TYPE public.rna_processing_status AS ENUM ('candidate','matched','rejected','needs_review');

CREATE TABLE public.staging_rna_associations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_rna_id text NOT NULL UNIQUE,
  raw_name text NOT NULL,
  normalized_name text NOT NULL,
  acronym text,
  association_purpose text,
  address_line text,
  postal_code text,
  city text,
  website text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processing_status public.rna_processing_status NOT NULL DEFAULT 'candidate',
  match_decision text CHECK (match_decision IN ('auto_match','needs_review','create_candidate','rejected')),
  matched_club_id uuid REFERENCES public.clubs(id) ON DELETE SET NULL,
  match_score numeric(5,4),
  match_reason text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  source_updated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.club_slug_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.normalize_club_name(value text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=''
AS $$
  SELECT trim(regexp_replace(
    regexp_replace(
      translate(lower(coalesce(value,'')),
        'àáâäãåçèéêëìíîïñòóôöõùúûüýÿœæ',
        'aaaaaaceeeeiiiinooooouuuuyyoea'),
      '[^a-z0-9]+', ' ', 'g'),
    '\s+', ' ', 'g'));
$$;

ALTER TABLE public.clubs ADD COLUMN search_name text;
UPDATE public.clubs SET search_name=public.normalize_club_name(display_name);
ALTER TABLE public.clubs ALTER COLUMN search_name SET NOT NULL;

CREATE OR REPLACE FUNCTION public.set_club_search_name()
RETURNS trigger LANGUAGE plpgsql SET search_path=''
AS $$ BEGIN NEW.search_name=public.normalize_club_name(NEW.display_name); RETURN NEW; END $$;
CREATE TRIGGER set_club_search_name BEFORE INSERT OR UPDATE OF display_name ON public.clubs
FOR EACH ROW EXECUTE FUNCTION public.set_club_search_name();

CREATE INDEX clubs_search_name_trgm_idx ON public.clubs USING gin(search_name gin_trgm_ops);
CREATE INDEX staging_rna_normalized_name_trgm_idx ON public.staging_rna_associations USING gin(normalized_name gin_trgm_ops);
CREATE INDEX staging_rna_status_idx ON public.staging_rna_associations(processing_status);

CREATE OR REPLACE FUNCTION public.search_clubs(query text, result_limit integer DEFAULT 12)
RETURNS TABLE(id uuid,display_name text,city text,department_code text,slug text,rank real)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
  SELECT c.id,c.display_name,c.city,c.department_code,c.slug,
    greatest(public.similarity(c.search_name,public.normalize_club_name(query)),
      CASE WHEN c.search_name LIKE '%'||public.normalize_club_name(query)||'%' THEN 0.75 ELSE 0 END)::real AS rank
  FROM public.clubs c
  WHERE c.status='active' AND (
    public.similarity(c.search_name,public.normalize_club_name(query)) >= 0.22
    OR c.search_name LIKE '%'||public.normalize_club_name(query)||'%')
  ORDER BY rank DESC,c.display_name
  LIMIT least(greatest(result_limit,1),30);
$$;

REVOKE ALL ON FUNCTION public.search_clubs(text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_clubs(text,integer) TO anon,authenticated;

ALTER TABLE public.staging_rna_associations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_slug_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY club_slug_history_public_read ON public.club_slug_history FOR SELECT USING(true);
GRANT SELECT ON public.club_slug_history TO anon,authenticated;
REVOKE ALL ON public.staging_rna_associations FROM anon,authenticated;
REVOKE ALL ON public.admin_audit_logs FROM anon,authenticated;

COMMIT;
