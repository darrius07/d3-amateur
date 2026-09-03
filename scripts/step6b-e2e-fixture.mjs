import nextEnv from '@next/env';import {createClient} from '@supabase/supabase-js';import crypto from 'node:crypto';nextEnv.loadEnvConfig(process.cwd());
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;const service=createClient(url,key,{auth:{persistSession:false}});const mode=process.argv[2];
if(mode==='setup'){
  const suffix=crypto.randomUUID().slice(0,8),password=`D3!${crypto.randomUUID()}aA1`;
  const email=`step6b-e2e-${suffix}-owner@example.invalid`;
  const created=await service.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{display_name:'E2E Owner 6B'}});if(created.error)throw created.error;
  const ownerId=created.data.user.id;
  const club=await service.from('clubs').insert({slug:`d3-test-club-step6b-e2e-${suffix}`,official_name:`D3 Test Club Step6B E2E ${suffix}`,display_name:`D3 Test Club Step6B E2E ${suffix}`,city:'Nantes',status:'active',claim_status:'claimed'}).select('id,slug').single();if(club.error)throw club.error;
  await service.from('club_memberships').insert({club_id:club.data.id,user_id:ownerId,role:'OWNER',active:true}).throwOnError();
  const team=await service.rpc('ensure_senior_team',{actor_id:ownerId,target_club_id:club.data.id,rank_value:1});if(team.error)throw team.error;

  const intruderEmail=`step6b-e2e-${suffix}-intruder@example.invalid`;
  const intruderPassword=`D3!${crypto.randomUUID()}aA1`;
  const intruder=await service.auth.admin.createUser({email:intruderEmail,password:intruderPassword,email_confirm:true,user_metadata:{display_name:'E2E Intruder 6B'}});if(intruder.error)throw intruder.error;

  console.log(JSON.stringify({suffix,email,password,ownerId,club:club.data,teamSeasonId:team.data.id,intruderEmail,intruderPassword}));
}else if(mode==='cleanup'){
  const suffix=process.argv[3];if(!suffix)throw new Error('suffix required');
  const listed=await service.auth.admin.listUsers({perPage:1000});
  const users=listed.data.users.filter(u=>u.email?.includes(`step6b-e2e-${suffix}-`));
  const clubs=await service.from('clubs').select('id').ilike('slug',`d3-test-club-step6b-e2e-%${suffix}`);
  const clubIds=(clubs.data??[]).map(c=>c.id);
  if(clubIds.length){
    await service.from('admin_audit_logs').delete().in('entity_id',clubIds);
    const staffRows=await service.from('club_staff').select('id').in('club_id',clubIds);
    if(staffRows.data?.length)await service.from('admin_audit_logs').delete().in('entity_id',staffRows.data.map(s=>s.id));
    await service.from('club_staff').delete().in('club_id',clubIds);
    const teams=await service.from('teams').select('id').in('club_id',clubIds);const teamIds=(teams.data??[]).map(t=>t.id);
    const teamSeasons=teamIds.length?await service.from('team_seasons').select('id').in('team_id',teamIds):{data:[]};const teamSeasonIds=(teamSeasons.data??[]).map(t=>t.id);
    if(teamSeasonIds.length)await service.from('team_seasons').delete().in('id',teamSeasonIds);
    if(teamIds.length){await service.from('admin_audit_logs').delete().in('entity_id',teamIds);await service.from('teams').delete().in('id',teamIds)}
    await service.from('club_profiles').delete().in('club_id',clubIds);
    await service.from('club_memberships').delete().in('club_id',clubIds);
    await service.from('admin_audit_logs').delete().in('entity_id',clubIds);
    await service.from('clubs').delete().in('id',clubIds);
  }
  for(const u of users)await service.auth.admin.deleteUser(u.id);
  console.log(JSON.stringify({cleanedUsers:users.length,clubs:clubIds.length}));
}else throw new Error('Use setup or cleanup <suffix>');
