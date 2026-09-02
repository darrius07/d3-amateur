import nextEnv from '@next/env';import {createClient} from '@supabase/supabase-js';import crypto from 'node:crypto';nextEnv.loadEnvConfig(process.cwd());
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key||!serviceKey)throw new Error('Supabase env missing');const service=createClient(url,serviceKey,{auth:{persistSession:false}}),anon=createClient(url,key,{auth:{persistSession:false}});let n=0;const ok=(value,label)=>{if(!value)throw new Error(`FAIL ${label}`);console.log(`ok ${++n} - ${label}`)};
const suffix=crypto.randomUUID(),password=`D3!${suffix}`;
let ownerId,otherId,ownerBId,clubA,clubB,teamSeasonA,teamSeasonB,matchId,playerA1,playerA2,playerB1,playerOtherClub,otherClubId;
const clubIds=[],playerIds=[],matchIds=[];
async function makeUser(label){const email=`step5b1-${label}-${suffix}@example.invalid`;const created=await service.auth.admin.createUser({email,password,email_confirm:true});if(created.error)throw created.error;const authClient=createClient(url,key,{auth:{persistSession:false}});const login=await authClient.auth.signInWithPassword({email,password});if(login.error)throw login.error;return {id:created.data.user.id,client:createClient(url,key,{global:{headers:{Authorization:`Bearer ${login.data.session.access_token}`}},auth:{persistSession:false}})}}
async function addPlayer(teamSeasonId,first,last,actorId=ownerId){const r=await service.rpc('manage_roster_player',{actor_id:actorId,target_team_season_id:teamSeasonId,existing_player_id:null,new_first_name:first,new_last_name:last,new_slug:`${first}-${last}-${crypto.randomUUID()}`.toLowerCase(),position_value:'MIDFIELDER',squad_value:null});if(r.error)throw r.error;playerIds.push(r.data);return r.data}
try{
  const owner=await makeUser('owner'),other=await makeUser('other'),ownerB=await makeUser('ownerb');ownerId=owner.id;otherId=other.id;ownerBId=ownerB.id;
  const clubs=await service.from('clubs').insert([{slug:`step5b1-a-${suffix}`,official_name:'Step 5B1 Test Club A',display_name:'Step 5B1 Test Club A',status:'active',claim_status:'claimed'},{slug:`step5b1-b-${suffix}`,official_name:'Step 5B1 Test Club B',display_name:'Step 5B1 Test Club B',status:'active',claim_status:'claimed'},{slug:`step5b1-c-${suffix}`,official_name:'Step 5B1 Test Club C',display_name:'Step 5B1 Test Club C',status:'active',claim_status:'claimed'}]).select('id');if(clubs.error)throw clubs.error;[clubA,clubB,otherClubId]=clubs.data.map(c=>c.id);clubIds.push(clubA,clubB,otherClubId);
  await service.from('club_memberships').insert([{club_id:clubA,user_id:ownerId,role:'OWNER',active:true},{club_id:clubB,user_id:ownerBId,role:'OWNER',active:true}]).throwOnError();
  let r=await service.rpc('ensure_senior_team',{actor_id:ownerId,target_club_id:clubA,rank_value:1});if(r.error)throw r.error;teamSeasonA=r.data.id;
  r=await service.rpc('ensure_senior_team',{actor_id:ownerId,target_club_id:clubA,rank_value:2});if(r.error)throw r.error;const teamSeasonA2=r.data.id;
  r=await service.rpc('ensure_senior_team',{actor_id:ownerBId,target_club_id:clubB,rank_value:1});if(r.error)throw r.error;teamSeasonB=r.data.id;

  playerA1=await addPlayer(teamSeasonA,'Amara','TestA1');
  playerA2=await addPlayer(teamSeasonA2,'Boubacar','TestA2'); // same club, Seniors B roster
  playerB1=await addPlayer(teamSeasonB,'Chris','TestB1',ownerBId); // different club entirely
  // playerOtherClub: exists but has NO registration with club A/B at all
  await service.from('club_memberships').insert({club_id:otherClubId,user_id:otherId,role:'OWNER',active:true}).throwOnError();
  r=await service.rpc('ensure_senior_team',{actor_id:otherId,target_club_id:otherClubId,rank_value:1});if(r.error)throw r.error;const teamSeasonC=r.data.id;
  playerOtherClub=await addPlayer(teamSeasonC,'David','TestC1',otherId);

  const kickoff=new Date(Date.now()+7*24*3600*1000).toISOString();
  r=await service.rpc('create_match',{actor_id:ownerId,p_home_team_season_id:teamSeasonA,p_away_team_season_id:teamSeasonB,p_external_opponent_name:null,p_competition_season_id:null,p_competition_group_id:null,p_venue_id:null,p_kickoff_at:kickoff,p_venue_name:null});if(r.error)throw r.error;matchId=r.data;matchIds.push(matchId);

  // --- RPC grant boundary ---
  const goodEntries=[{player_id:playerA1,lineup_role:'STARTER'}];
  r=await anon.rpc('save_match_lineup',{actor_id:ownerId,p_match_id:matchId,p_team_season_id:teamSeasonA,p_entries:goodEntries});ok(Boolean(r.error),'anon cannot call save_match_lineup');
  r=await owner.client.rpc('save_match_lineup',{actor_id:ownerId,p_match_id:matchId,p_team_season_id:teamSeasonA,p_entries:goodEntries});ok(Boolean(r.error),'authenticated OWNER session cannot call save_match_lineup directly (service-role only)');
  r=await other.client.rpc('save_match_lineup',{actor_id:otherId,p_match_id:matchId,p_team_season_id:teamSeasonA,p_entries:goodEntries});ok(Boolean(r.error),'normal authenticated user without Club A membership cannot mutate Club A lineup -> MUST FAIL');

  // --- Cross-club: OWNER A -> Club B lineup -> MUST FAIL ---
  r=await service.rpc('save_match_lineup',{actor_id:ownerId,p_match_id:matchId,p_team_season_id:teamSeasonB,p_entries:[{player_id:playerB1,lineup_role:'STARTER'}]});ok(Boolean(r.error),'OWNER A -> lineup Club B -> MUST FAIL');
  // --- OWNER A tries to add a Club B player into Club A's own lineup -> MUST FAIL (not registered with club A) ---
  r=await service.rpc('save_match_lineup',{actor_id:ownerId,p_match_id:matchId,p_team_season_id:teamSeasonA,p_entries:[{player_id:playerB1,lineup_role:'STARTER'}]});ok(Boolean(r.error),'OWNER A -> add Club B player to Club A lineup -> MUST FAIL (not registered with club A)');
  // --- OWNER A tries to add a player from an unrelated third club -> MUST FAIL ---
  r=await service.rpc('save_match_lineup',{actor_id:ownerId,p_match_id:matchId,p_team_season_id:teamSeasonA,p_entries:[{player_id:playerOtherClub,lineup_role:'STARTER'}]});ok(Boolean(r.error),'OWNER A -> add unregistered external player -> MUST FAIL');

  // --- Legitimate: OWNER A's own roster player -> PASS ---
  r=await service.rpc('save_match_lineup',{actor_id:ownerId,p_match_id:matchId,p_team_season_id:teamSeasonA,p_entries:[{player_id:playerA1,lineup_role:'STARTER',position:'MIDFIELDER',squad_number:8}]});if(r.error)throw r.error;ok(true,'OWNER A adds own Seniors A roster player as STARTER -> PASS');
  const row1=await service.from('match_appearances').select('lineup_role,position,squad_number').eq('match_id',matchId).eq('team_season_id',teamSeasonA).eq('player_id',playerA1).single();ok(row1.data?.lineup_role==='STARTER'&&row1.data.squad_number===8,'snapshot squad_number/position saved on the appearance row');

  // --- Same-club Seniors B player is eligible for Seniors A matchday squad -> PASS ---
  r=await service.rpc('save_match_lineup',{actor_id:ownerId,p_match_id:matchId,p_team_season_id:teamSeasonA,p_entries:[{player_id:playerA1,lineup_role:'STARTER'},{player_id:playerA2,lineup_role:'BENCH'}]});if(r.error)throw r.error;ok(true,'OWNER A adds a same-club Seniors B registered player to the Seniors A matchday squad -> PASS');

  // --- Duplicate player in the same submitted set -> MUST FAIL ---
  r=await service.rpc('save_match_lineup',{actor_id:ownerId,p_match_id:matchId,p_team_season_id:teamSeasonA,p_entries:[{player_id:playerA1,lineup_role:'STARTER'},{player_id:playerA1,lineup_role:'BENCH'}]});ok(Boolean(r.error),'same player listed twice in one submission -> MUST FAIL');

  // --- Partial lineup allowed (fewer than 11 starters) ---
  r=await service.rpc('save_match_lineup',{actor_id:ownerId,p_match_id:matchId,p_team_season_id:teamSeasonA,p_entries:[{player_id:playerA1,lineup_role:'STARTER'}]});if(r.error)throw r.error;
  const partialCount=await service.from('match_appearances').select('id',{count:'exact',head:true}).eq('match_id',matchId).eq('team_season_id',teamSeasonA).eq('lineup_role','STARTER');ok(partialCount.count===1,'a lineup with 1/11 starters is accepted (partial, historical/incomplete sheets allowed)');
  // and the earlier BENCH entry (playerA2) was removed by the replace-set semantics since it wasn't resubmitted
  const stillThere=await service.from('match_appearances').select('id').eq('match_id',matchId).eq('team_season_id',teamSeasonA).eq('player_id',playerA2);ok((stillThere.data?.length??0)===0,'replace-set save removes entries not resubmitted (no stale rows)');

  // --- Exactly 11 starters allowed ---
  const elevenIds=[playerA1];
  for(let i=0;i<10;i++)elevenIds.push(await addPlayer(teamSeasonA,'Extra',`Player${i}`));
  const elevenEntries=elevenIds.map(id=>({player_id:id,lineup_role:'STARTER'}));
  r=await service.rpc('save_match_lineup',{actor_id:ownerId,p_match_id:matchId,p_team_season_id:teamSeasonA,p_entries:elevenEntries});if(r.error)throw r.error;ok(true,'exactly 11 starters accepted -> PASS');

  // --- 12 starters rejected ---
  const twelfth=await addPlayer(teamSeasonA,'Twelfth','Player');
  const twelveEntries=[...elevenEntries,{player_id:twelfth,lineup_role:'STARTER'}];
  r=await service.rpc('save_match_lineup',{actor_id:ownerId,p_match_id:matchId,p_team_season_id:teamSeasonA,p_entries:twelveEntries});ok(Boolean(r.error),'12 starters rejected -> MUST FAIL');

  // --- Idempotent resave: same set submitted twice produces the same end state, no duplicate rows ---
  r=await service.rpc('save_match_lineup',{actor_id:ownerId,p_match_id:matchId,p_team_season_id:teamSeasonA,p_entries:elevenEntries});if(r.error)throw r.error;
  r=await service.rpc('save_match_lineup',{actor_id:ownerId,p_match_id:matchId,p_team_season_id:teamSeasonA,p_entries:elevenEntries});if(r.error)throw r.error;
  const finalCount=await service.from('match_appearances').select('id',{count:'exact',head:true}).eq('match_id',matchId).eq('team_season_id',teamSeasonA);ok(finalCount.count===11,'resubmitting the identical 11-player lineup twice is idempotent (still exactly 11 rows)');

  // --- STARTER -> BENCH move (role change) via resubmission ---
  const movedEntries=elevenEntries.map((e,i)=>i===0?{...e,lineup_role:'BENCH'}:e);
  r=await service.rpc('save_match_lineup',{actor_id:ownerId,p_match_id:matchId,p_team_season_id:teamSeasonA,p_entries:movedEntries});if(r.error)throw r.error;
  const moved=await service.from('match_appearances').select('lineup_role').eq('match_id',matchId).eq('team_season_id',teamSeasonA).eq('player_id',playerA1).single();ok(moved.data?.lineup_role==='BENCH','moving a starter to bench via resubmission works (role changed in place, not duplicated)');

  // --- Direct table writes forbidden ---
  r=await anon.from('match_appearances').insert({match_id:matchId,team_season_id:teamSeasonA,player_id:playerA1,lineup_role:'STARTER'});ok(Boolean(r.error),'anon cannot insert a match_appearance row directly');
  r=await owner.client.from('match_appearances').insert({match_id:matchId,team_season_id:teamSeasonA,player_id:playerA1,lineup_role:'STARTER'});ok(Boolean(r.error),'authenticated OWNER cannot insert a match_appearance row directly (must go through save_match_lineup)');

  // --- Public read ---
  r=await anon.from('match_appearances').select('id,lineup_role').eq('match_id',matchId).eq('team_season_id',teamSeasonA);ok((r.data?.length??0)===11,'anon can publicly read the lineup');

  // --- Audit: one synthetic lineup_updated event per save, with before/after ---
  const audit=await service.from('admin_audit_logs').select('action,details').eq('entity_id',matchId).eq('action','lineup_updated');ok((audit.data?.length??0)>=1&&audit.data.every(a=>Array.isArray(a.details?.before)&&Array.isArray(a.details?.after)),'lineup_updated audit events recorded with before/after arrays');

  console.log(`PASS ${n} Step 5B.1 RLS and integration assertions`);
}finally{
  if(matchIds.length){await service.from('match_appearances').delete().in('match_id',matchIds);await service.from('admin_audit_logs').delete().in('entity_id',matchIds);await service.from('matches').delete().in('id',matchIds)}
  if(playerIds.length){await service.from('player_registrations').delete().in('player_id',playerIds);await service.from('team_roster_members').delete().in('player_id',playerIds);await service.from('product_events').delete().in('entity_id',playerIds);await service.from('admin_audit_logs').delete().in('entity_id',playerIds);await service.from('players').delete().in('id',playerIds)}
  const teams=clubIds.length?await service.from('teams').select('id').in('club_id',clubIds):{data:[]};const teamIds=(teams.data??[]).map(t=>t.id);
  if(teamIds.length){const teamSeasons=await service.from('team_seasons').select('id').in('team_id',teamIds);const teamSeasonIds=(teamSeasons.data??[]).map(t=>t.id);if(teamSeasonIds.length)await service.from('team_seasons').delete().in('id',teamSeasonIds);await service.from('admin_audit_logs').delete().in('entity_id',teamIds);await service.from('teams').delete().in('id',teamIds)}
  if(clubIds.length){await service.from('club_memberships').delete().in('club_id',clubIds);await service.from('admin_audit_logs').delete().in('entity_id',clubIds);await service.from('clubs').delete().in('id',clubIds)}
  for(const id of [ownerId,otherId,ownerBId].filter(Boolean))await service.auth.admin.deleteUser(id);
}
