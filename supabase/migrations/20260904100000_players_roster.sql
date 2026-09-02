BEGIN;

CREATE TYPE public.player_position AS ENUM ('GOALKEEPER','DEFENDER','MIDFIELDER','FORWARD','UNKNOWN');
CREATE TYPE public.player_profile_status AS ENUM ('PUBLIC','REVIEW','ARCHIVED');
CREATE TYPE public.player_claim_status AS ENUM ('UNCLAIMED','CLAIMED');
CREATE TYPE public.player_registration_status AS ENUM ('ACTIVE','ENDED','REVIEW');
CREATE TYPE public.player_verification_status AS ENUM ('DECLARED_BY_VERIFIED_CLUB','VERIFIED','NEEDS_REVIEW');

CREATE OR REPLACE FUNCTION public.normalize_player_name(value text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=''
AS $$
  SELECT trim(regexp_replace(public.unaccent(lower(coalesce(value,''))),'[^a-z0-9]+',' ','g'));
$$;

CREATE TABLE public.players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  first_name text NOT NULL CHECK (length(trim(first_name)) BETWEEN 1 AND 80),
  last_name text NOT NULL CHECK (length(trim(last_name)) BETWEEN 1 AND 100),
  display_name text NOT NULL,
  normalized_name text NOT NULL,
  primary_position public.player_position,
  profile_status public.player_profile_status NOT NULL DEFAULT 'PUBLIC',
  claim_status public.player_claim_status NOT NULL DEFAULT 'UNCLAIMED',
  source_id uuid REFERENCES public.data_sources(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.player_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE RESTRICT,
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE RESTRICT,
  start_date date,
  end_date date,
  status public.player_registration_status NOT NULL DEFAULT 'ACTIVE',
  source_id uuid REFERENCES public.data_sources(id) ON DELETE SET NULL,
  verification_status public.player_verification_status NOT NULL DEFAULT 'DECLARED_BY_VERIFIED_CLUB',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  UNIQUE(player_id,club_id,season_id)
);

CREATE TABLE public.team_roster_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_season_id uuid NOT NULL REFERENCES public.team_seasons(id) ON DELETE RESTRICT,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE RESTRICT,
  squad_number integer CHECK (squad_number BETWEEN 1 AND 99),
  primary_position public.player_position,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source_id uuid REFERENCES public.data_sources(id) ON DELETE SET NULL,
  verification_status public.player_verification_status NOT NULL DEFAULT 'DECLARED_BY_VERIFIED_CLUB',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.product_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name text NOT NULL CHECK (event_name IN ('player_created','player_attached','roster_member_added','roster_member_removed','player_profile_viewed')),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX team_roster_one_active_player_idx ON public.team_roster_members(team_season_id,player_id) WHERE active;
CREATE INDEX players_normalized_name_trgm_idx ON public.players USING gin(normalized_name gin_trgm_ops);
CREATE INDEX player_registrations_player_idx ON public.player_registrations(player_id,status);
CREATE INDEX player_registrations_club_season_idx ON public.player_registrations(club_id,season_id,status);
CREATE INDEX team_roster_player_idx ON public.team_roster_members(player_id,active);
CREATE INDEX team_roster_team_season_idx ON public.team_roster_members(team_season_id,active);

CREATE OR REPLACE FUNCTION public.set_player_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path=''
AS $$ BEGIN
  NEW.first_name=trim(NEW.first_name); NEW.last_name=trim(NEW.last_name);
  NEW.display_name=trim(NEW.first_name||' '||NEW.last_name);
  NEW.normalized_name=public.normalize_player_name(NEW.display_name);
  RETURN NEW;
END $$;
CREATE TRIGGER set_player_identity BEFORE INSERT OR UPDATE OF first_name,last_name ON public.players FOR EACH ROW EXECUTE FUNCTION public.set_player_identity();
CREATE TRIGGER set_players_updated_at BEFORE UPDATE ON public.players FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_player_registrations_updated_at BEFORE UPDATE ON public.player_registrations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_team_roster_members_updated_at BEFORE UPDATE ON public.team_roster_members FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.actor_can_manage_club(actor_id uuid,target_club_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$ SELECT EXISTS(SELECT 1 FROM public.club_memberships m WHERE m.user_id=actor_id AND m.club_id=target_club_id AND m.role='OWNER' AND m.active)
  OR EXISTS(SELECT 1 FROM public.user_profiles p WHERE p.id=actor_id AND p.d3_admin_role IS NOT NULL) $$;
REVOKE ALL ON FUNCTION public.actor_can_manage_club(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.actor_can_manage_club(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.ensure_senior_team(actor_id uuid,target_club_id uuid,rank_value integer)
RETURNS public.team_seasons LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE active_season public.seasons; target_team public.teams; result public.team_seasons; rank_label text;
BEGIN
  IF NOT public.actor_can_manage_club(actor_id,target_club_id) THEN RAISE EXCEPTION 'Club OWNER required'; END IF;
  IF rank_value NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'Rank must be A, B or C'; END IF;
  SELECT * INTO active_season FROM public.seasons WHERE active ORDER BY start_date DESC LIMIT 1;
  IF active_season.id IS NULL THEN RAISE EXCEPTION 'No active season'; END IF;
  rank_label=chr(64+rank_value);
  SELECT * INTO target_team FROM public.teams WHERE club_id=target_club_id AND team_rank=rank_value AND gender='male' AND category='senior' AND football_format='11' LIMIT 1;
  IF target_team.id IS NULL THEN
    INSERT INTO public.teams(club_id,display_name,team_rank,gender,category,football_format,active)
    VALUES(target_club_id,'Seniors '||rank_label,rank_value,'male','senior','11',true) RETURNING * INTO target_team;
    INSERT INTO public.admin_audit_logs(actor_user_id,action,entity_type,entity_id,details)
    VALUES(actor_id,'team_created','team',target_team.id,jsonb_build_object('club_id',target_club_id,'rank',rank_label));
  END IF;
  INSERT INTO public.team_seasons(team_id,season_id) VALUES(target_team.id,active_season.id)
  ON CONFLICT(team_id,season_id) DO UPDATE SET team_id=EXCLUDED.team_id RETURNING * INTO result;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.manage_roster_player(actor_id uuid,target_team_season_id uuid,existing_player_id uuid,new_first_name text,new_last_name text,new_slug text,position_value public.player_position,squad_value integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE target_club uuid; target_season uuid; result_player uuid; source_club uuid; registration_verification public.player_verification_status; roster_id uuid;
BEGIN
  SELECT t.club_id,ts.season_id INTO target_club,target_season FROM public.team_seasons ts JOIN public.teams t ON t.id=ts.team_id WHERE ts.id=target_team_season_id AND t.active;
  IF target_club IS NULL OR NOT public.actor_can_manage_club(actor_id,target_club) THEN RAISE EXCEPTION 'Club OWNER required'; END IF;
  IF squad_value IS NOT NULL AND squad_value NOT BETWEEN 1 AND 99 THEN RAISE EXCEPTION 'Invalid squad number'; END IF;
  SELECT id INTO source_club FROM public.data_sources WHERE code='CLUB';
  IF existing_player_id IS NULL THEN
    IF length(trim(coalesce(new_first_name,'')))=0 OR length(trim(coalesce(new_last_name,'')))=0 THEN RAISE EXCEPTION 'Player name required'; END IF;
    INSERT INTO public.players(slug,first_name,last_name,primary_position,source_id,created_by)
    VALUES(new_slug,new_first_name,new_last_name,coalesce(position_value,'UNKNOWN'),source_club,actor_id) RETURNING id INTO result_player;
    INSERT INTO public.admin_audit_logs(actor_user_id,action,entity_type,entity_id,details)
    VALUES(actor_id,'player_created','player',result_player,jsonb_build_object('source','CLUB','club_id',target_club));
    INSERT INTO public.product_events(event_name,actor_user_id,entity_id,metadata) VALUES('player_created',actor_id,result_player,jsonb_build_object('club_id',target_club));
  ELSE
    SELECT id INTO result_player FROM public.players WHERE id=existing_player_id AND profile_status<>'ARCHIVED';
    IF result_player IS NULL THEN RAISE EXCEPTION 'Player not found'; END IF;
  END IF;
  registration_verification=CASE WHEN EXISTS(SELECT 1 FROM public.player_registrations r WHERE r.player_id=result_player AND r.season_id=target_season AND r.club_id<>target_club AND r.status='ACTIVE') THEN 'NEEDS_REVIEW' ELSE 'DECLARED_BY_VERIFIED_CLUB' END;
  INSERT INTO public.player_registrations(player_id,club_id,season_id,status,source_id,verification_status,created_by)
  VALUES(result_player,target_club,target_season,CASE WHEN registration_verification='NEEDS_REVIEW' THEN 'REVIEW' ELSE 'ACTIVE' END,source_club,registration_verification,actor_id)
  ON CONFLICT(player_id,club_id,season_id) DO NOTHING;
  IF registration_verification='NEEDS_REVIEW' THEN
    INSERT INTO public.admin_audit_logs(actor_user_id,action,entity_type,entity_id,details) VALUES(actor_id,'ambiguous_registration_reported','player',result_player,jsonb_build_object('club_id',target_club,'season_id',target_season));
    RETURN NULL;
  END IF;
  INSERT INTO public.team_roster_members(team_season_id,player_id,squad_number,primary_position,created_by,source_id)
  VALUES(target_team_season_id,result_player,squad_value,position_value,actor_id,source_club)
  ON CONFLICT(team_season_id,player_id) WHERE active DO UPDATE SET squad_number=EXCLUDED.squad_number,primary_position=EXCLUDED.primary_position,updated_at=now()
  RETURNING id INTO roster_id;
  INSERT INTO public.admin_audit_logs(actor_user_id,action,entity_type,entity_id,details) VALUES
    (actor_id,'player_attached','player_registration',result_player,jsonb_build_object('club_id',target_club,'season_id',target_season)),
    (actor_id,'roster_member_added','team_roster_member',roster_id,jsonb_build_object('player_id',result_player,'team_season_id',target_team_season_id));
  INSERT INTO public.product_events(event_name,actor_user_id,entity_id,metadata) VALUES
    ('player_attached',actor_id,result_player,jsonb_build_object('club_id',target_club)),
    ('roster_member_added',actor_id,roster_id,jsonb_build_object('player_id',result_player,'team_season_id',target_team_season_id));
  RETURN result_player;
END $$;

CREATE OR REPLACE FUNCTION public.update_roster_member(actor_id uuid,roster_member_id uuid,position_value public.player_position,squad_value integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$ DECLARE target_club uuid; old_row public.team_roster_members; BEGIN
  SELECT trm.* INTO old_row FROM public.team_roster_members trm WHERE trm.id=roster_member_id;
  SELECT t.club_id INTO target_club FROM public.team_seasons ts JOIN public.teams t ON t.id=ts.team_id WHERE ts.id=old_row.team_season_id;
  IF target_club IS NULL OR NOT public.actor_can_manage_club(actor_id,target_club) THEN RAISE EXCEPTION 'Club OWNER required'; END IF;
  UPDATE public.team_roster_members SET primary_position=position_value,squad_number=squad_value WHERE id=roster_member_id;
  IF old_row.primary_position IS DISTINCT FROM position_value THEN INSERT INTO public.admin_audit_logs(actor_user_id,action,entity_type,entity_id,details) VALUES(actor_id,'roster_position_changed','team_roster_member',roster_member_id,jsonb_build_object('before',old_row.primary_position,'after',position_value)); END IF;
  IF old_row.squad_number IS DISTINCT FROM squad_value THEN INSERT INTO public.admin_audit_logs(actor_user_id,action,entity_type,entity_id,details) VALUES(actor_id,'squad_number_changed','team_roster_member',roster_member_id,jsonb_build_object('before',old_row.squad_number,'after',squad_value)); END IF;
END $$;

CREATE OR REPLACE FUNCTION public.remove_roster_member(actor_id uuid,roster_member_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$ DECLARE target_club uuid; target_player uuid; BEGIN
  SELECT t.club_id,trm.player_id INTO target_club,target_player FROM public.team_roster_members trm JOIN public.team_seasons ts ON ts.id=trm.team_season_id JOIN public.teams t ON t.id=ts.team_id WHERE trm.id=roster_member_id;
  IF target_club IS NULL OR NOT public.actor_can_manage_club(actor_id,target_club) THEN RAISE EXCEPTION 'Club OWNER required'; END IF;
  UPDATE public.team_roster_members SET active=false WHERE id=roster_member_id;
  INSERT INTO public.admin_audit_logs(actor_user_id,action,entity_type,entity_id,details) VALUES(actor_id,'roster_member_removed','team_roster_member',roster_member_id,jsonb_build_object('player_id',target_player));
  INSERT INTO public.product_events(event_name,actor_user_id,entity_id,metadata) VALUES('roster_member_removed',actor_id,roster_member_id,jsonb_build_object('player_id',target_player));
END $$;

REVOKE ALL ON FUNCTION public.ensure_senior_team(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.manage_roster_player(uuid,uuid,uuid,text,text,text,public.player_position,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_roster_member(uuid,uuid,public.player_position,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.remove_roster_member(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_senior_team(uuid,uuid,integer),public.manage_roster_player(uuid,uuid,uuid,text,text,text,public.player_position,integer),public.update_roster_member(uuid,uuid,public.player_position,integer),public.remove_roster_member(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.search_players(query text,result_limit integer DEFAULT 12)
RETURNS TABLE(id uuid,display_name text,slug text,primary_position public.player_position,club_name text,team_name text,rank real)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
  SELECT p.id,p.display_name,p.slug,p.primary_position,c.display_name,t.display_name,
    greatest(public.similarity(p.normalized_name,public.normalize_player_name(query)),CASE WHEN p.normalized_name LIKE '%'||public.normalize_player_name(query)||'%' THEN .8 ELSE 0 END)::real
  FROM public.players p
  LEFT JOIN public.player_registrations r ON r.player_id=p.id AND r.status='ACTIVE'
  LEFT JOIN public.clubs c ON c.id=r.club_id
  LEFT JOIN public.team_roster_members trm ON trm.player_id=p.id AND trm.active
  LEFT JOIN public.team_seasons ts ON ts.id=trm.team_season_id AND ts.season_id=r.season_id
  LEFT JOIN public.teams t ON t.id=ts.team_id
  WHERE p.profile_status='PUBLIC' AND (public.similarity(p.normalized_name,public.normalize_player_name(query))>=.24 OR p.normalized_name LIKE '%'||public.normalize_player_name(query)||'%')
  ORDER BY 7 DESC,p.display_name LIMIT least(greatest(result_limit,1),30);
$$;
REVOKE ALL ON FUNCTION public.search_players(text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_players(text,integer) TO anon,authenticated;

ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_roster_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY players_public_read ON public.players FOR SELECT USING(profile_status='PUBLIC');
CREATE POLICY player_registrations_public_read ON public.player_registrations FOR SELECT USING(status IN ('ACTIVE','REVIEW'));
CREATE POLICY team_roster_public_read ON public.team_roster_members FOR SELECT USING(active);
GRANT SELECT ON public.players,public.player_registrations,public.team_roster_members TO anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.players,public.player_registrations,public.team_roster_members FROM anon,authenticated;
REVOKE ALL ON public.product_events FROM anon,authenticated;

COMMIT;
