import nextEnv from '@next/env';import {createClient} from '@supabase/supabase-js';import crypto from 'node:crypto';nextEnv.loadEnvConfig(process.cwd());
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;const service=createClient(url,key,{auth:{persistSession:false}});const mode=process.argv[2];
if(mode==='setup'){
  const suffix=crypto.randomUUID().slice(0,8),password=`D3!${crypto.randomUUID()}aA1`;
  const email=`step5c-e2e-${suffix}-owner@example.invalid`;
  const created=await service.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{display_name:'E2E Owner 5C'}});if(created.error)throw created.error;
  const ownerId=created.data.user.id;
  const club=await service.from('clubs').insert({slug:`d3-test-club-step5c-e2e-${suffix}`,official_name:`D3 Test Club Step5C E2E ${suffix}`,display_name:`D3 Test Club Step5C E2E ${suffix}`,status:'active',claim_status:'claimed'}).select('id,slug,display_name').single();if(club.error)throw club.error;
  await service.from('club_memberships').insert({club_id:club.data.id,user_id:ownerId,role:'OWNER',active:true}).throwOnError();
  const team=await service.rpc('ensure_senior_team',{actor_id:ownerId,target_club_id:club.data.id,rank_value:1});if(team.error)throw team.error;
  const teamSeasonId=team.data.id;
  // players[0] = A, the starter who will score. players[1]/[2] = filler
  // starters (one of them goes out for the substitution). players[3] = B,
  // the bench player who comes on and assists -- the substitution event is
  // created BEFORE the goal in the Golden Path script itself so B is
  // genuinely "on the pitch" (a documented substitute appearance) at the
  // moment they are credited with the assist.
  const players=[],slugs=[];
  for(let i=0;i<4;i++){
    const slug=`fixture-statsplayer${i}-${suffix}`;
    const p=await service.rpc('manage_roster_player',{actor_id:ownerId,target_team_season_id:teamSeasonId,existing_player_id:null,new_first_name:'Stats',new_last_name:`Player${i}${suffix}`,new_slug:slug,position_value:'MIDFIELDER',squad_value:null});
    if(p.error)throw p.error;
    players.push(p.data);slugs.push(slug);
  }
  const kickoff=new Date(Date.now()-3600*1000).toISOString();
  const match=await service.rpc('create_match',{actor_id:ownerId,p_home_team_season_id:teamSeasonId,p_away_team_season_id:null,p_external_opponent_name:`FC Fixture ${suffix}`,p_competition_season_id:null,p_competition_group_id:null,p_venue_id:null,p_kickoff_at:kickoff,p_venue_name:null});
  if(match.error)throw match.error;
  const matchId=match.data;
  const result=await service.rpc('enter_match_result',{actor_id:ownerId,p_match_id:matchId,p_home_score:1,p_away_score:0});if(result.error)throw result.error;
  const lineup=await service.rpc('save_match_lineup',{actor_id:ownerId,p_match_id:matchId,p_team_season_id:teamSeasonId,p_entries:[
    {player_id:players[0],lineup_role:'STARTER'},{player_id:players[1],lineup_role:'STARTER'},{player_id:players[2],lineup_role:'STARTER'},{player_id:players[3],lineup_role:'BENCH'},
  ]});if(lineup.error)throw lineup.error;
  console.log(JSON.stringify({suffix,email,password,ownerId,club:club.data,teamSeasonId,matchId,players,slugs}));
}else if(mode==='cleanup'){
  const suffix=process.argv[3];if(!suffix)throw new Error('suffix required');
  const listed=await service.auth.admin.listUsers({perPage:1000});
  const users=listed.data.users.filter(u=>u.email?.includes(`step5c-e2e-${suffix}-`));
  const clubs=await service.from('clubs').select('id').ilike('slug',`d3-test-club-step5c-e2e-${suffix}%`);
  const clubIds=(clubs.data??[]).map(c=>c.id);
  if(clubIds.length){
    const teams=await service.from('teams').select('id').in('club_id',clubIds);const teamIds=(teams.data??[]).map(t=>t.id);
    const teamSeasons=teamIds.length?await service.from('team_seasons').select('id').in('team_id',teamIds):{data:[]};const teamSeasonIds=(teamSeasons.data??[]).map(t=>t.id);
    let matchIds=[];
    if(teamSeasonIds.length){
      const matches=await service.from('matches').select('id').or(teamSeasonIds.map(id=>`home_team_season_id.eq.${id}`).concat(teamSeasonIds.map(id=>`away_team_season_id.eq.${id}`)).join(','));
      matchIds=(matches.data??[]).map(m=>m.id);
      if(matchIds.length){await service.from('match_events').delete().in('match_id',matchIds);await service.from('match_appearances').delete().in('match_id',matchIds);await service.from('admin_audit_logs').delete().in('entity_id',matchIds);await service.from('matches').delete().in('id',matchIds)}
    }
    const rosterMembers=teamSeasonIds.length?await service.from('team_roster_members').select('id,player_id').in('team_season_id',teamSeasonIds):{data:[]};
    const playerIds=[...new Set((rosterMembers.data??[]).map(r=>r.player_id))];
    if(teamSeasonIds.length)await service.from('team_roster_members').delete().in('team_season_id',teamSeasonIds);
    if(playerIds.length){await service.from('match_events').delete().in('primary_player_id',playerIds);await service.from('player_registrations').delete().in('player_id',playerIds);await service.from('match_appearances').delete().in('player_id',playerIds);await service.from('product_events').delete().in('entity_id',playerIds);await service.from('admin_audit_logs').delete().in('entity_id',playerIds);await service.from('players').delete().in('id',playerIds)}
    if(teamSeasonIds.length)await service.from('team_seasons').delete().in('id',teamSeasonIds);
    if(teamIds.length){await service.from('admin_audit_logs').delete().in('entity_id',teamIds);await service.from('teams').delete().in('id',teamIds)}
    await service.from('club_memberships').delete().in('club_id',clubIds);
    await service.from('admin_audit_logs').delete().in('entity_id',clubIds);
    await service.from('clubs').delete().in('id',clubIds);
  }
  for(const u of users)await service.auth.admin.deleteUser(u.id);
  console.log(JSON.stringify({cleanedUsers:users.length,clubs:clubIds.length}));
}else throw new Error('Use setup or cleanup <suffix>');
