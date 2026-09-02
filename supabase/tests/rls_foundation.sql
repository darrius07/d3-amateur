BEGIN;
SELECT '1..28';

INSERT INTO auth.users (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) VALUES
('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','normal@d3.test','',now(),now(),now()),
('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','other@d3.test','',now(),now(),now()),
('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin@d3.test','',now(),now(),now());
UPDATE public.user_profiles SET display_name='Normal' WHERE id='10000000-0000-0000-0000-000000000001';
UPDATE public.user_profiles SET display_name='Other' WHERE id='10000000-0000-0000-0000-000000000002';
UPDATE public.user_profiles SET display_name='Admin',d3_admin_role='superadmin' WHERE id='10000000-0000-0000-0000-000000000003';
INSERT INTO public.seasons (id,label,start_date,end_date) VALUES ('20000000-0000-0000-0000-000000000001','RLS 2026','2026-01-01','2026-12-31');
INSERT INTO public.clubs (id,slug,official_name,display_name) VALUES ('30000000-0000-0000-0000-000000000001','rls-club','RLS Club','RLS Club');
INSERT INTO public.teams (id,club_id,display_name,gender,category,football_format) VALUES ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','RLS Team','mixed','senior','11');
INSERT INTO public.competitions (id,name,short_name,competition_type,gender,category) VALUES ('50000000-0000-0000-0000-000000000001','RLS Competition','RLS','league','mixed','senior');
INSERT INTO public.venues (id,name) VALUES ('60000000-0000-0000-0000-000000000001','RLS Venue');

DO $$
DECLARE n integer; denied boolean;
BEGIN
  -- anon: public reads pass; all canonical writes must be denied by grants/RLS.
  EXECUTE 'SET LOCAL ROLE anon';
  PERFORM * FROM public.seasons; PERFORM * FROM public.clubs; PERFORM * FROM public.teams;
  PERFORM * FROM public.competitions; PERFORM * FROM public.venues;
  denied := false; BEGIN INSERT INTO public.clubs(slug,official_name,display_name) VALUES('anon-write','Anon','Anon'); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'anon insert was allowed'; END IF;
  denied := false; BEGIN UPDATE public.clubs SET display_name='Anon' WHERE id='30000000-0000-0000-0000-000000000001'; EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'anon update was allowed'; END IF;
  denied := false; BEGIN DELETE FROM public.clubs WHERE id='30000000-0000-0000-0000-000000000001'; EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'anon delete was allowed'; END IF;

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM * FROM public.clubs;
  SELECT count(*) INTO n FROM public.user_profiles; IF n<>1 THEN RAISE EXCEPTION 'normal user sees % profiles',n; END IF;
  UPDATE public.user_profiles SET display_name='Safe name' WHERE id='10000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'display_name update failed'; END IF;
  denied := false; BEGIN UPDATE public.user_profiles SET d3_admin_role='superadmin' WHERE id='10000000-0000-0000-0000-000000000001'; EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'self-promotion was allowed'; END IF;
  IF public.is_d3_admin() THEN RAISE EXCEPTION 'normal user became admin'; END IF;
  denied := false; BEGIN INSERT INTO public.clubs(slug,official_name,display_name) VALUES('user-write','User','User'); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'normal club insert allowed'; END IF;
  UPDATE public.teams SET display_name='User write' WHERE id='40000000-0000-0000-0000-000000000001'; GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'normal team update allowed'; END IF;
  DELETE FROM public.competitions WHERE id='50000000-0000-0000-0000-000000000001'; GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'normal competition delete allowed'; END IF;
  UPDATE public.venues SET name='User write' WHERE id='60000000-0000-0000-0000-000000000001'; GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'normal venue update allowed'; END IF;
  denied := false; BEGIN INSERT INTO public.external_identities(entity_type,entity_id,provider,external_id) VALUES('club','30000000-0000-0000-0000-000000000001','USER','forbidden'); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'normal external identity insert allowed'; END IF;
  DELETE FROM public.data_sources WHERE code='RNA'; GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'normal data source delete allowed'; END IF;

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF NOT public.is_d3_admin() THEN RAISE EXCEPTION 'real admin refused'; END IF;
  INSERT INTO public.clubs(slug,official_name,display_name) VALUES('admin-club','Admin Club','Admin Club');
  UPDATE public.teams SET display_name='Admin Team' WHERE id='40000000-0000-0000-0000-000000000001'; GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'admin update refused'; END IF;
  DELETE FROM public.venues WHERE id='60000000-0000-0000-0000-000000000001'; GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'admin delete refused'; END IF;
  INSERT INTO public.external_identities(entity_type,entity_id,provider,external_id) VALUES('club','30000000-0000-0000-0000-000000000001','ADMIN','allowed');
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO n FROM public.user_profiles WHERE id='10000000-0000-0000-0000-000000000001' AND d3_admin_role IS NULL;
  IF n<>1 THEN RAISE EXCEPTION 'normal user privilege changed'; END IF;
END $$;

SELECT 'ok ' || n || ' - behavioral RLS assertion ' || n FROM generate_series(1,28) AS n;
ROLLBACK;
