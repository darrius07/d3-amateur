import nextEnv from '@next/env';import {createClient} from '@supabase/supabase-js';import crypto from 'node:crypto';nextEnv.loadEnvConfig(process.cwd());
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key||!serviceKey)throw new Error('Supabase env missing');const service=createClient(url,serviceKey,{auth:{persistSession:false}}),anon=createClient(url,key,{auth:{persistSession:false}});let n=0;const ok=(value,label)=>{if(!value)throw new Error(`FAIL ${label}`);console.log(`ok ${++n} - ${label}`)};
const suffix=crypto.randomUUID(),password=`D3!${suffix}`;
let ownerId,otherId,ownerBId,clubA,clubB,teamSeasonA,teamSeasonB,matchId,scorer,assister,cscPlayer,cardedPlayer,subOut,subIn,notOnSheet,playerB;
const clubIds=[],playerIds=[],matchIds=[],eventIds=[];
async function makeUser(label){const email=`step5b2-${label}-${suffix}@example.invalid`;const created=await service.auth.admin.createUser({email,password,email_confirm:true});if(created.error)throw created.error;const authClient=createClient(url,key,{auth:{persistSession:false}});const login=await authClient.auth.signInWithPassword({email,password});if(login.error)throw login.error;return {id:created.data.user.id,client:createClient(url,key,{global:{headers:{Authorization:`Bearer ${login.data.session.access_token}`}},auth:{persistSession:false}})}}
async function addPlayer(teamSeasonId,first,last,actorId=ownerId){const r=await service.rpc('manage_roster_player',{actor_id:actorId,target_team_season_id:teamSeasonId,existing_player_id:null,new_first_name:first,new_last_name:last,new_slug:`${first}-${last}-${crypto.randomUUID()}`.toLowerCase(),position_value:'MIDFIELDER',squad_value:null});if(r.error)throw r.error;playerIds.push(r.data);return r.data}
try{
  const owner=await makeUser('owner'),other=await makeUser('other'),ownerB=await makeUser('ownerb');ownerId=owner.id;otherId=other.id;ownerBId=ownerB.id;
  const clubs=await service.from('clubs').insert([{slug:`step5b2-a-${suffix}`,official_name:'Step 5B2 Test Club A',display_name:'Step 5B2 Test Club A',status:'active',claim_status:'claimed'},{slug:`step5b2-b-${suffix}`,official_name:'Step 5B2 Test Club B',display_name:'Step 5B2 Test Club B',status:'active',claim_status:'claimed'}]).select('id');if(clubs.error)throw clubs.error;[clubA,clubB]=clubs.data.map(c=>c.id);clubIds.push(clubA,clubB);
  await service.from('club_memberships').insert([{club_id:clubA,user_id:ownerId,role:'OWNER',active:true},{club_id:clubB,user_id:ownerBId,role:'OWNER',active:true}]).throwOnError();
  let r=await service.rpc('ensure_senior_team',{actor_id:ownerId,target_club_id:clubA,rank_value:1});if(r.error)throw r.error;teamSeasonA=r.data.id;
  r=await service.rpc('ensure_senior_team',{actor_id:ownerBId,target_club_id:clubB,rank_value:1});if(r.error)throw r.error;teamSeasonB=r.data.id;

  scorer=await addPlayer(teamSeasonA,'Scorer','TestA');
  assister=await addPlayer(teamSeasonA,'Assist','TestA');
  cscPlayer=await addPlayer(teamSeasonA,'Csc','TestA');
  cardedPlayer=await addPlayer(teamSeasonA,'Carded','TestA');
  subOut=await addPlayer(teamSeasonA,'SubOut','TestA');
  subIn=await addPlayer(teamSeasonA,'SubIn','TestA');
  notOnSheet=await addPlayer(teamSeasonA,'NotOnSheet','TestA'); // registered/rostered but never added to the match sheet
  playerB=await addPlayer(teamSeasonB,'Player','TestB',ownerBId);

  const kickoff=new Date(Date.now()-3600*1000).toISOString(); // in the past, played
  r=await service.rpc('create_match',{actor_id:ownerId,p_home_team_season_id:teamSeasonA,p_away_team_season_id:teamSeasonB,p_external_opponent_name:null,p_competition_season_id:null,p_competition_group_id:null,p_venue_id:null,p_kickoff_at:kickoff,p_venue_name:null});if(r.error)throw r.error;matchId=r.data;matchIds.push(matchId);
  r=await service.rpc('enter_match_result',{actor_id:ownerId,p_match_id:matchId,p_home_score:2,p_away_score:0});if(r.error)throw r.error;

  // put everyone except notOnSheet on Club A's match sheet
  const sheetEntries=[scorer,assister,cscPlayer,cardedPlayer,subOut].map(id=>({player_id:id,lineup_role:'STARTER'})).concat([{player_id:subIn,lineup_role:'BENCH'}]);
  r=await service.rpc('save_match_lineup',{actor_id:ownerId,p_match_id:matchId,p_team_season_id:teamSeasonA,p_entries:sheetEntries});if(r.error)throw r.error;
  r=await service.rpc('save_match_lineup',{actor_id:ownerBId,p_match_id:matchId,p_team_season_id:teamSeasonB,p_entries:[{player_id:playerB,lineup_role:'STARTER'}]});if(r.error)throw r.error;

  // --- RPC grant boundary ---
  const goalArgs={actor_id:ownerId,p_match_id:matchId,p_team_season_id:teamSeasonA,p_event_type:'GOAL',p_primary_player_id:scorer,p_secondary_player_id:null,p_minute:23,p_added_time:null,p_goal_kind:'NORMAL',p_card_kind:null};
  r=await anon.rpc('create_match_event',goalArgs);ok(Boolean(r.error),'anon cannot call create_match_event');
  r=await owner.client.rpc('create_match_event',goalArgs);ok(Boolean(r.error),'authenticated OWNER session cannot call create_match_event directly (service-role only)');
  r=await other.client.rpc('create_match_event',{...goalArgs,actor_id:otherId});ok(Boolean(r.error),'normal authenticated user without Club A membership cannot create an event -> MUST FAIL');

  // --- Cross-club: OWNER A -> event for Club B -> MUST FAIL ---
  r=await service.rpc('create_match_event',{actor_id:ownerId,p_match_id:matchId,p_team_season_id:teamSeasonB,p_event_type:'GOAL',p_primary_player_id:playerB,p_secondary_player_id:null,p_minute:10,p_added_time:null,p_goal_kind:'NORMAL',p_card_kind:null});ok(Boolean(r.error),'OWNER A -> create event for Club B -> MUST FAIL');
  // --- OWNER A uses Player B in a Club A event -> MUST FAIL (not on Club A sheet) ---
  r=await service.rpc('create_match_event',{...goalArgs,p_primary_player_id:playerB});ok(Boolean(r.error),'OWNER A -> use Player B in event A -> MUST FAIL');
  // --- Player not on the match sheet -> MUST FAIL ---
  r=await service.rpc('create_match_event',{...goalArgs,p_primary_player_id:notOnSheet});ok(Boolean(r.error),'OWNER A -> use player not on match sheet -> MUST FAIL');

  // --- Legitimate GOAL + assist ---
  r=await service.rpc('create_match_event',{...goalArgs,p_secondary_player_id:assister});if(r.error)throw r.error;const goalEventId=r.data;eventIds.push(goalEventId);ok(Boolean(goalEventId),'OWNER A records own-team GOAL with assist -> PASS');
  r=await anon.from('match_events').select('event_type,primary_player_id,secondary_player_id,minute').eq('id',goalEventId).single();ok(r.data?.event_type==='GOAL'&&r.data.primary_player_id===scorer&&r.data.secondary_player_id===assister&&r.data.minute===23,'anon can publicly read the goal event with correct scorer/assist/minute');

  // --- Goal without assist (assist optional, absence != no assist recorded) ---
  r=await service.rpc('create_match_event',{...goalArgs,p_minute:50,p_secondary_player_id:null});if(r.error)throw r.error;eventIds.push(r.data);ok(true,'GOAL without an assist is valid -> PASS');

  // --- Scorer == assist rejected ---
  r=await service.rpc('create_match_event',{...goalArgs,p_secondary_player_id:scorer});ok(Boolean(r.error),'scorer and assist cannot be the same player -> MUST FAIL');

  // --- OWN_GOAL ---
  r=await service.rpc('create_match_event',{actor_id:ownerId,p_match_id:matchId,p_team_season_id:teamSeasonA,p_event_type:'OWN_GOAL',p_primary_player_id:cscPlayer,p_secondary_player_id:null,p_minute:60,p_added_time:null,p_goal_kind:null,p_card_kind:null});if(r.error)throw r.error;const ownGoalId=r.data;eventIds.push(ownGoalId);ok(Boolean(ownGoalId),'OWN_GOAL recorded for the player who scored on their own goal -> PASS');
  const matchAfterOwnGoal=await service.from('matches').select('home_score,away_score').eq('id',matchId).single();ok(matchAfterOwnGoal.data.home_score===2&&matchAfterOwnGoal.data.away_score===0,'recording an OWN_GOAL never touches matches.home_score/away_score (score stays the independently-declared result)');

  // --- Yellow and red cards, same player can have several ---
  r=await service.rpc('create_match_event',{actor_id:ownerId,p_match_id:matchId,p_team_season_id:teamSeasonA,p_event_type:'YELLOW_CARD',p_primary_player_id:cardedPlayer,p_secondary_player_id:null,p_minute:30,p_added_time:null,p_goal_kind:null,p_card_kind:null});if(r.error)throw r.error;eventIds.push(r.data);
  r=await service.rpc('create_match_event',{actor_id:ownerId,p_match_id:matchId,p_team_season_id:teamSeasonA,p_event_type:'RED_CARD',p_primary_player_id:cardedPlayer,p_secondary_player_id:null,p_minute:75,p_added_time:2,p_goal_kind:null,p_card_kind:'SECOND_YELLOW'});if(r.error)throw r.error;const redCardId=r.data;eventIds.push(redCardId);ok(true,'a second yellow followed by a red for the same player is accepted (no naive one-card-max rule) -> PASS');

  // --- Substitution ---
  r=await service.rpc('create_match_event',{actor_id:ownerId,p_match_id:matchId,p_team_season_id:teamSeasonA,p_event_type:'SUBSTITUTION',p_primary_player_id:subOut,p_secondary_player_id:subIn,p_minute:67,p_added_time:null,p_goal_kind:null,p_card_kind:null});if(r.error)throw r.error;const subId=r.data;eventIds.push(subId);ok(true,'substitution (out != in, both on the sheet) -> PASS');
  r=await service.rpc('create_match_event',{actor_id:ownerId,p_match_id:matchId,p_team_season_id:teamSeasonA,p_event_type:'SUBSTITUTION',p_primary_player_id:subOut,p_secondary_player_id:subOut,p_minute:70,p_added_time:null,p_goal_kind:null,p_card_kind:null});ok(Boolean(r.error),'substitution with out === in -> MUST FAIL');
  r=await service.rpc('create_match_event',{actor_id:ownerId,p_match_id:matchId,p_team_season_id:teamSeasonA,p_event_type:'SUBSTITUTION',p_primary_player_id:subOut,p_secondary_player_id:playerB,p_minute:70,p_added_time:null,p_goal_kind:null,p_card_kind:null});ok(Boolean(r.error),'substitution bringing in a Club B player -> MUST FAIL');

  // --- Minute validation ---
  r=await service.rpc('create_match_event',{...goalArgs,p_minute:null});if(r.error)throw r.error;eventIds.push(r.data);ok(true,'NULL minute accepted -- amateur football often has no precise minute -> PASS');
  r=await service.rpc('create_match_event',{...goalArgs,p_minute:-1});ok(Boolean(r.error),'negative minute rejected -> MUST FAIL');
  r=await service.rpc('create_match_event',{...goalArgs,p_minute:9999});ok(Boolean(r.error),'absurd minute rejected -> MUST FAIL');
  r=await service.rpc('create_match_event',{...goalArgs,p_minute:45,p_added_time:2});if(r.error)throw r.error;eventIds.push(r.data);ok(true,'minute + added_time (45+2) accepted -> PASS');

  // --- Cross-club edit/delete on Club A's events ---
  r=await service.rpc('update_match_event',{actor_id:ownerBId,p_event_id:goalEventId,p_primary_player_id:scorer,p_secondary_player_id:null,p_minute:24,p_added_time:null,p_goal_kind:'NORMAL',p_card_kind:null});ok(Boolean(r.error),'OWNER B -> edit Club A event -> MUST FAIL');
  r=await service.rpc('delete_match_event',{actor_id:ownerBId,p_event_id:goalEventId});ok(Boolean(r.error),'OWNER B -> delete Club A event -> MUST FAIL');
  r=await anon.rpc('update_match_event',{actor_id:ownerId,p_event_id:goalEventId,p_primary_player_id:scorer,p_secondary_player_id:null,p_minute:24,p_added_time:null,p_goal_kind:'NORMAL',p_card_kind:null});ok(Boolean(r.error),'anon cannot call update_match_event');
  r=await anon.from('match_events').insert({match_id:matchId,team_season_id:teamSeasonA,event_type:'GOAL',primary_player_id:scorer});ok(Boolean(r.error),'anon cannot insert a match_event row directly');
  r=await owner.client.from('match_events').delete().eq('id',goalEventId);ok(Boolean(r.error)||!r.data?.length,'authenticated OWNER cannot delete a match_event row directly (must go through delete_match_event)');

  // --- Legitimate update by the rightful OWNER ---
  r=await service.rpc('update_match_event',{actor_id:ownerId,p_event_id:goalEventId,p_primary_player_id:scorer,p_secondary_player_id:assister,p_minute:24,p_added_time:null,p_goal_kind:'PENALTY',p_card_kind:null});if(r.error)throw r.error;
  const updated=await service.from('match_events').select('minute,goal_kind').eq('id',goalEventId).single();ok(updated.data?.minute===24&&updated.data.goal_kind==='PENALTY','OWNER A updates own event (minute + goal_kind) -> PASS');

  // --- Legitimate hard delete with full audit before-state ---
  const toDelete=eventIds.pop();
  r=await service.rpc('delete_match_event',{actor_id:ownerId,p_event_id:toDelete});if(r.error)throw r.error;
  const gone=await service.from('match_events').select('id').eq('id',toDelete);ok((gone.data?.length??0)===0,'OWNER A deletes own event -> hard-deleted -> PASS');
  const deleteAudit=await service.from('admin_audit_logs').select('details').eq('entity_id',toDelete).eq('action','match_event_deleted').single();ok(Boolean(deleteAudit.data?.details?.before?.id),'deletion audit captures the full before-state of the deleted event');

  // --- Timeline ordering sanity (server just stores; ordering is a read-side concern, verify raw data supports it) ---
  const all=await service.from('match_events').select('minute,added_time').eq('match_id',matchId).eq('team_season_id',teamSeasonA);
  ok((all.data?.length??0)>=5,'multiple events of different types coexist for the same match/team');

  // --- Audit coverage ---
  const audit=await service.from('admin_audit_logs').select('action').eq('entity_id',goalEventId);const actions=new Set((audit.data??[]).map(a=>a.action));ok(actions.has('match_event_created')&&actions.has('match_event_updated'),'audit covers created + updated for the same event');

  console.log(`PASS ${n} Step 5B.2 RLS and integration assertions`);
}finally{
  if(matchIds.length){await service.from('match_events').delete().in('match_id',matchIds);await service.from('match_appearances').delete().in('match_id',matchIds);await service.from('admin_audit_logs').delete().in('entity_id',matchIds);await service.from('matches').delete().in('id',matchIds)}
  if(playerIds.length){await service.from('match_events').delete().in('primary_player_id',playerIds);await service.from('player_registrations').delete().in('player_id',playerIds);await service.from('team_roster_members').delete().in('player_id',playerIds);await service.from('product_events').delete().in('entity_id',playerIds);await service.from('admin_audit_logs').delete().in('entity_id',playerIds);await service.from('players').delete().in('id',playerIds)}
  const teams=clubIds.length?await service.from('teams').select('id').in('club_id',clubIds):{data:[]};const teamIds=(teams.data??[]).map(t=>t.id);
  if(teamIds.length){const teamSeasons=await service.from('team_seasons').select('id').in('team_id',teamIds);const teamSeasonIds=(teamSeasons.data??[]).map(t=>t.id);if(teamSeasonIds.length)await service.from('team_seasons').delete().in('id',teamSeasonIds);await service.from('admin_audit_logs').delete().in('entity_id',teamIds);await service.from('teams').delete().in('id',teamIds)}
  if(clubIds.length){await service.from('club_memberships').delete().in('club_id',clubIds);await service.from('admin_audit_logs').delete().in('entity_id',clubIds);await service.from('clubs').delete().in('id',clubIds)}
  for(const id of [ownerId,otherId,ownerBId].filter(Boolean))await service.auth.admin.deleteUser(id);
}
