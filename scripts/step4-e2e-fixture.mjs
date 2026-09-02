import nextEnv from '@next/env';import {createClient} from '@supabase/supabase-js';import crypto from 'node:crypto';nextEnv.loadEnvConfig(process.cwd());
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;const service=createClient(url,key,{auth:{persistSession:false}});const mode=process.argv[2];
if(mode==='setup'){
  const suffix=crypto.randomUUID().slice(0,8),password=`D3!${crypto.randomUUID()}aA1`;
  const email=`step4-e2e-${suffix}-owner@example.invalid`;
  const created=await service.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{display_name:'E2E Owner'}});if(created.error)throw created.error;
  const ownerId=created.data.user.id;
  const club=await service.from('clubs').insert({slug:`d3-test-club-step4-e2e-${suffix}`,official_name:`D3 Test Club Step4 E2E ${suffix}`,display_name:`D3 Test Club Step4 E2E ${suffix}`,status:'active',claim_status:'claimed'}).select('id,slug,display_name').single();if(club.error)throw club.error;
  await service.from('club_memberships').insert({club_id:club.data.id,user_id:ownerId,role:'OWNER',active:true}).throwOnError();
  console.log(JSON.stringify({suffix,email,password,ownerId,club:club.data}));
}else if(mode==='cleanup'){
  const suffix=process.argv[3];if(!suffix)throw new Error('suffix required');
  const listed=await service.auth.admin.listUsers({perPage:1000});
  const users=listed.data.users.filter(u=>u.email?.includes(`step4-e2e-${suffix}-`));
  const clubs=await service.from('clubs').select('id').ilike('slug',`d3-test-club-step4-e2e-${suffix}%`);
  const clubIds=(clubs.data??[]).map(c=>c.id);
  if(clubIds.length){
    const teams=await service.from('teams').select('id').in('club_id',clubIds);const teamIds=(teams.data??[]).map(t=>t.id);
    const teamSeasons=teamIds.length?await service.from('team_seasons').select('id').in('team_id',teamIds):{data:[]};const teamSeasonIds=(teamSeasons.data??[]).map(t=>t.id);
    const rosterMembers=teamSeasonIds.length?await service.from('team_roster_members').select('id,player_id').in('team_season_id',teamSeasonIds):{data:[]};
    const playerIds=[...new Set((rosterMembers.data??[]).map(r=>r.player_id))];
    if(teamSeasonIds.length)await service.from('team_roster_members').delete().in('team_season_id',teamSeasonIds);
    if(playerIds.length){await service.from('player_registrations').delete().in('player_id',playerIds);await service.from('product_events').delete().in('entity_id',playerIds);await service.from('admin_audit_logs').delete().in('entity_id',playerIds);await service.from('players').delete().in('id',playerIds)}
    if(teamSeasonIds.length)await service.from('team_seasons').delete().in('id',teamSeasonIds);
    if(teamIds.length){await service.from('admin_audit_logs').delete().in('entity_id',teamIds);await service.from('teams').delete().in('id',teamIds)}
    await service.from('club_memberships').delete().in('club_id',clubIds);
    await service.from('admin_audit_logs').delete().in('entity_id',clubIds);
    await service.from('clubs').delete().in('id',clubIds);
  }
  for(const u of users)await service.auth.admin.deleteUser(u.id);
  console.log(JSON.stringify({cleanedUsers:users.length,clubs:clubIds.length}));
}else throw new Error('Use setup or cleanup <suffix>');
