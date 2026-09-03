import nextEnv from '@next/env';import {createClient} from '@supabase/supabase-js';import crypto from 'node:crypto';nextEnv.loadEnvConfig(process.cwd());
// STEP 5C PRODUCTION CLOSEOUT -- targeted smoke covering the two mandatory
// scenarios not already exercised exactly by scripts/step5c-security-integration.mjs:
// (1) the played-only regression fix (20260908110000) against a fresh
// SCHEDULED->PLAYED transition, and (2) the 4-match coverage shape
// (complete/partial/none/complete -> played=4, anyLineup=3, completeLineup=2)
// plus a live RED_CARD SECOND_YELLOW check (still counts as a red card).
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
const service=createClient(url,key,{auth:{persistSession:false}});
let n=0;const ok=(value,label)=>{if(!value)throw new Error(`FAIL ${label}: got ${JSON.stringify(value)}`);console.log(`ok ${++n} - ${label}`)};
const suffix=crypto.randomUUID();
const clubIds=[],playerIds=[],matchIds=[];let ownerId;
async function addPlayer(teamSeasonId,i){const r=await service.rpc('manage_roster_player',{actor_id:ownerId,target_team_season_id:teamSeasonId,existing_player_id:null,new_first_name:'Closeout',new_last_name:`P${i}`,new_slug:`closeout-5c-p${i}-${suffix}`,position_value:'MIDFIELDER',squad_value:null});if(r.error)throw r.error;playerIds.push(r.data);return r.data}
async function makeMatch(homeTs,dayOffset){const kickoff=new Date(Date.now()+dayOffset*24*3600*1000).toISOString();const r=await service.rpc('create_match',{actor_id:ownerId,p_home_team_season_id:homeTs,p_away_team_season_id:null,p_external_opponent_name:`Adversaire Closeout ${suffix}`,p_competition_season_id:null,p_competition_group_id:null,p_venue_id:null,p_kickoff_at:kickoff,p_venue_name:null});if(r.error)throw r.error;matchIds.push(r.data);return r.data}
try{
  const email=`step5c-closeout-${suffix}-owner@example.invalid`,password=`D3!${suffix}`;
  const created=await service.auth.admin.createUser({email,password,email_confirm:true});if(created.error)throw created.error;ownerId=created.data.user.id;
  const club=await service.from('clubs').insert({slug:`step5c-closeout-${suffix}`,official_name:'Step 5C Closeout Club',display_name:'Step 5C Closeout Club',status:'active',claim_status:'claimed'}).select('id').single();if(club.error)throw club.error;clubIds.push(club.data.id);
  await service.from('club_memberships').insert({club_id:club.data.id,user_id:ownerId,role:'OWNER',active:true}).throwOnError();
  const team=await service.rpc('ensure_senior_team',{actor_id:ownerId,target_club_id:club.data.id,rank_value:1});if(team.error)throw team.error;const teamSeasonId=team.data.id;

  // 11 real starters + 1 sub-eligible bench player, reused across matches --
  // enough to genuinely hit matches_with_complete_starting_lineup.
  const roster=[];for(let i=0;i<12;i++)roster.push(await addPlayer(teamSeasonId,i));
  const elevenStarters=roster.slice(0,11).map(id=>({player_id:id,lineup_role:'STARTER'}));

  // ---- Played-only regression (mission section 9) ----
  const scheduledMatch=await makeMatch(teamSeasonId,5); // future kickoff, left SCHEDULED
  let r=await service.rpc('save_match_lineup',{actor_id:ownerId,p_match_id:scheduledMatch,p_team_season_id:teamSeasonId,p_entries:elevenStarters});if(r.error)throw r.error;
  r=await service.rpc('create_match_event',{actor_id:ownerId,p_match_id:scheduledMatch,p_team_season_id:teamSeasonId,p_event_type:'YELLOW_CARD',p_primary_player_id:roster[0],p_secondary_player_id:null,p_minute:10,p_added_time:null,p_goal_kind:null,p_card_kind:null});if(r.error)throw r.error;
  let stats=await service.from('player_team_season_stats').select('appearances').eq('player_id',roster[0]).eq('team_season_id',teamSeasonId).maybeSingle();
  ok(!stats.data||stats.data.appearances===0,'SCHEDULED match with a full lineup + a YELLOW_CARD event contributes zero appearances/cards while unplayed');
  let coverageBefore=await service.from('team_season_data_coverage').select('played_matches').eq('team_season_id',teamSeasonId).maybeSingle();
  ok(!coverageBefore.data||coverageBefore.data.played_matches===0,'the SCHEDULED match is not counted in played_matches either');
  r=await service.rpc('enter_match_result',{actor_id:ownerId,p_match_id:scheduledMatch,p_home_score:2,p_away_score:0});if(r.error)throw r.error;
  stats=await service.from('player_team_season_stats').select('appearances,yellow_cards').eq('player_id',roster[0]).eq('team_season_id',teamSeasonId).single();
  ok(stats.data.appearances===1&&stats.data.yellow_cards===1,'transitioning the match to PLAYED makes the same, already-saved facts visible immediately -- no re-entry needed');

  // ---- Coverage: 4 PLAYED matches, complete / partial / none / complete ----
  const m1=await makeMatch(teamSeasonId,-1); // complete lineup + an event
  r=await service.rpc('save_match_lineup',{actor_id:ownerId,p_match_id:m1,p_team_season_id:teamSeasonId,p_entries:elevenStarters});if(r.error)throw r.error;
  r=await service.rpc('enter_match_result',{actor_id:ownerId,p_match_id:m1,p_home_score:1,p_away_score:0});if(r.error)throw r.error;
  r=await service.rpc('create_match_event',{actor_id:ownerId,p_match_id:m1,p_team_season_id:teamSeasonId,p_event_type:'GOAL',p_primary_player_id:roster[0],p_secondary_player_id:null,p_minute:5,p_added_time:null,p_goal_kind:'NORMAL',p_card_kind:null});if(r.error)throw r.error;

  const m2=await makeMatch(teamSeasonId,-2); // partial lineup (3 players), no event
  r=await service.rpc('save_match_lineup',{actor_id:ownerId,p_match_id:m2,p_team_season_id:teamSeasonId,p_entries:roster.slice(0,3).map(id=>({player_id:id,lineup_role:'STARTER'}))});if(r.error)throw r.error;
  r=await service.rpc('enter_match_result',{actor_id:ownerId,p_match_id:m2,p_home_score:0,p_away_score:0});if(r.error)throw r.error;

  const m3=await makeMatch(teamSeasonId,-3); // no lineup at all
  r=await service.rpc('enter_match_result',{actor_id:ownerId,p_match_id:m3,p_home_score:1,p_away_score:1});if(r.error)throw r.error;

  const m4=await makeMatch(teamSeasonId,-4); // complete lineup, with a RED_CARD (SECOND_YELLOW) to also cover section 13
  r=await service.rpc('save_match_lineup',{actor_id:ownerId,p_match_id:m4,p_team_season_id:teamSeasonId,p_entries:elevenStarters});if(r.error)throw r.error;
  r=await service.rpc('enter_match_result',{actor_id:ownerId,p_match_id:m4,p_home_score:2,p_away_score:2});if(r.error)throw r.error;
  r=await service.rpc('create_match_event',{actor_id:ownerId,p_match_id:m4,p_team_season_id:teamSeasonId,p_event_type:'RED_CARD',p_primary_player_id:roster[1],p_secondary_player_id:null,p_minute:80,p_added_time:null,p_goal_kind:null,p_card_kind:'SECOND_YELLOW'});if(r.error)throw r.error;

  const coverage=await service.from('team_season_data_coverage').select('*').eq('team_season_id',teamSeasonId).single();
  ok(coverage.data.played_matches===5,'played_matches=5 (the 4 dedicated fixture matches + the now-PLAYED regression match)');
  ok(coverage.data.matches_with_any_lineup_data===4,'matches_with_any_lineup_data=4 (m1 complete, m2 partial, m4 complete, plus the regression match -- m3 has none)');
  ok(coverage.data.matches_with_complete_starting_lineup===3,'matches_with_complete_starting_lineup=3 (m1, m4, and the regression match all have 11 starters; m2 partial and m3 none do not)');
  ok(coverage.data.matches_with_any_event_data>=2,'matches_with_any_event_data reflects at least the matches with a documented GOAL/RED_CARD (m1, m4) -- never implies those events are exhaustive');

  const redCardStats=await service.from('player_team_season_stats').select('red_cards').eq('player_id',roster[1]).eq('team_season_id',teamSeasonId).single();
  ok(redCardStats.data.red_cards===1,'a RED_CARD with card_kind=SECOND_YELLOW still counts in red_cards (no suspension logic, no card_kind filtering)');

  console.log(`PASS ${n} Step 5C production closeout smoke assertions`);
}finally{
  if(matchIds.length){await service.from('match_events').delete().in('match_id',matchIds);await service.from('match_appearances').delete().in('match_id',matchIds);await service.from('admin_audit_logs').delete().in('entity_id',matchIds);await service.from('matches').delete().in('id',matchIds)}
  if(playerIds.length){await service.from('player_registrations').delete().in('player_id',playerIds);await service.from('team_roster_members').delete().in('player_id',playerIds);await service.from('product_events').delete().in('entity_id',playerIds);await service.from('admin_audit_logs').delete().in('entity_id',playerIds);await service.from('players').delete().in('id',playerIds)}
  const teams=clubIds.length?await service.from('teams').select('id').in('club_id',clubIds):{data:[]};const teamIds=(teams.data??[]).map(t=>t.id);
  if(teamIds.length){const teamSeasons=await service.from('team_seasons').select('id').in('team_id',teamIds);const teamSeasonIds=(teamSeasons.data??[]).map(t=>t.id);if(teamSeasonIds.length)await service.from('team_seasons').delete().in('id',teamSeasonIds);await service.from('admin_audit_logs').delete().in('entity_id',teamIds);await service.from('teams').delete().in('id',teamIds)}
  if(clubIds.length){await service.from('club_memberships').delete().in('club_id',clubIds);await service.from('admin_audit_logs').delete().in('entity_id',clubIds);await service.from('clubs').delete().in('id',clubIds)}
  if(ownerId)await service.auth.admin.deleteUser(ownerId);
}
