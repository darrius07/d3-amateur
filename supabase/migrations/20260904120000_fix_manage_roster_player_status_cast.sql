BEGIN;

-- Bug found by scripts/step4-security-integration.mjs: the very first real
-- call to manage_roster_player() failed with
--   column "status" is of type public.player_registration_status but
--   expression is of type text
-- The `CASE WHEN ... THEN 'REVIEW' ELSE 'ACTIVE' END` in the
-- player_registrations INSERT resolves its bare string literals as `text`
-- in a VALUES-list context (no implicit text->enum cast in Postgres),
-- unlike the plpgsql `registration_verification := CASE ... END;`
-- assignment just above it, which does accept the same shape. Only the
-- explicit cast on the INSERT's CASE expression was missing; the rest of
-- the function is unchanged.
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
  VALUES(result_player,target_club,target_season,(CASE WHEN registration_verification='NEEDS_REVIEW' THEN 'REVIEW' ELSE 'ACTIVE' END)::public.player_registration_status,source_club,registration_verification,actor_id)
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

REVOKE ALL ON FUNCTION public.manage_roster_player(uuid,uuid,uuid,text,text,text,public.player_position,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.manage_roster_player(uuid,uuid,uuid,text,text,text,public.player_position,integer) TO service_role;

COMMIT;
