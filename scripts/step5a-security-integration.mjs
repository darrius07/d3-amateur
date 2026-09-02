import nextEnv from '@next/env';import {createClient} from '@supabase/supabase-js';import crypto from 'node:crypto';nextEnv.loadEnvConfig(process.cwd());
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key||!serviceKey)throw new Error('Supabase env missing');const service=createClient(url,serviceKey,{auth:{persistSession:false}}),anon=createClient(url,key,{auth:{persistSession:false}});let n=0;const ok=(value,label)=>{if(!value)throw new Error(`FAIL ${label}`);console.log(`ok ${++n} - ${label}`)};
const suffix=crypto.randomUUID(),password=`D3!${suffix}`;let ownerId,otherId,ownerBId,clubA,clubB,teamSeasonA,teamSeasonB,matchExternalId,matchDvDId;const clubIds=[];const matchIds=[];
async function makeUser(label){const email=`step5a-${label}-${suffix}@example.invalid`;const created=await service.auth.admin.createUser({email,password,email_confirm:true});if(created.error)throw created.error;const authClient=createClient(url,key,{auth:{persistSession:false}});const login=await authClient.auth.signInWithPassword({email,password});if(login.error)throw login.error;return {id:created.data.user.id,client:createClient(url,key,{global:{headers:{Authorization:`Bearer ${login.data.session.access_token}`}},auth:{persistSession:false}})}}
try{
  const owner=await makeUser('owner'),other=await makeUser('other'),ownerB=await makeUser('ownerb');ownerId=owner.id;otherId=other.id;ownerBId=ownerB.id;
  const clubs=await service.from('clubs').insert([{slug:`step5a-a-${suffix}`,official_name:'Step 5A Test Club A',display_name:'Step 5A Test Club A',status:'active',claim_status:'claimed'},{slug:`step5a-b-${suffix}`,official_name:'Step 5A Test Club B',display_name:'Step 5A Test Club B',status:'active',claim_status:'claimed'}]).select('id');if(clubs.error)throw clubs.error;[clubA,clubB]=clubs.data.map(c=>c.id);clubIds.push(clubA,clubB);
  await service.from('club_memberships').insert([{club_id:clubA,user_id:ownerId,role:'OWNER',active:true},{club_id:clubB,user_id:ownerBId,role:'OWNER',active:true}]).throwOnError();
  let r=await service.rpc('ensure_senior_team',{actor_id:ownerId,target_club_id:clubA,rank_value:1});if(r.error)throw r.error;teamSeasonA=r.data.id;
  r=await service.rpc('ensure_senior_team',{actor_id:ownerBId,target_club_id:clubB,rank_value:1});if(r.error)throw r.error;teamSeasonB=r.data.id;
  const kickoff=new Date(Date.now()+7*24*3600*1000).toISOString();

  // --- RPC grant boundary ---
  r=await anon.rpc('create_match',{actor_id:ownerId,p_home_team_season_id:teamSeasonA,p_away_team_season_id:null,p_external_opponent_name:'FC Anon',p_competition_season_id:null,p_competition_group_id:null,p_venue_id:null,p_kickoff_at:kickoff});ok(Boolean(r.error),'anon cannot call create_match');
  r=await owner.client.rpc('create_match',{actor_id:ownerId,p_home_team_season_id:teamSeasonA,p_away_team_season_id:null,p_external_opponent_name:'FC Session',p_competition_season_id:null,p_competition_group_id:null,p_venue_id:null,p_kickoff_at:kickoff});ok(Boolean(r.error),'authenticated OWNER session cannot call create_match directly (service-role only)');
  r=await other.client.rpc('create_match',{actor_id:otherId,p_home_team_season_id:teamSeasonA,p_away_team_season_id:null,p_external_opponent_name:'FC Other',p_competition_season_id:null,p_competition_group_id:null,p_venue_id:null,p_kickoff_at:kickoff});ok(Boolean(r.error),'normal authenticated user without membership cannot create match -> MUST FAIL');

  // --- Unauthorized create: neither side owned by actor ---
  r=await service.rpc('create_match',{actor_id:otherId,p_home_team_season_id:teamSeasonA,p_away_team_season_id:null,p_external_opponent_name:'FC Nobody',p_competition_season_id:null,p_competition_group_id:null,p_venue_id:null,p_kickoff_at:kickoff});ok(Boolean(r.error),'user with no club ownership cannot create a match for club A');
  r=await service.rpc('create_match',{actor_id:ownerId,p_home_team_season_id:teamSeasonB,p_away_team_season_id:null,p_external_opponent_name:'FC X',p_competition_season_id:null,p_competition_group_id:null,p_venue_id:null,p_kickoff_at:kickoff});ok(Boolean(r.error),'OWNER A -> create match for Club B only -> MUST FAIL');

  // --- Legitimate creation: OWNER A, external opponent, home ---
  r=await service.rpc('create_match',{actor_id:ownerId,p_home_team_season_id:teamSeasonA,p_away_team_season_id:null,p_external_opponent_name:'FC Externe',p_competition_season_id:null,p_competition_group_id:null,p_venue_id:null,p_kickoff_at:kickoff});if(r.error)throw r.error;matchExternalId=r.data;matchIds.push(matchExternalId);ok(Boolean(matchExternalId),'OWNER A creates own team match vs external opponent -> PASS');
  const created=await service.from('matches').select('status,home_score,away_score,verification_status,season_id').eq('id',matchExternalId).single();ok(created.data.status==='SCHEDULED'&&created.data.home_score===null&&created.data.away_score===null,'new match is SCHEDULED with NULL score');
  ok(created.data.verification_status==='CLUB_DECLARED'&&Boolean(created.data.season_id),'match tagged CLUB_DECLARED and linked to a season');

  // --- D3 vs D3 match (OWNER A home, Club B away) ---
  r=await service.rpc('create_match',{actor_id:ownerId,p_home_team_season_id:teamSeasonA,p_away_team_season_id:teamSeasonB,p_external_opponent_name:null,p_competition_season_id:null,p_competition_group_id:null,p_venue_id:null,p_kickoff_at:kickoff});if(r.error)throw r.error;matchDvDId=r.data;matchIds.push(matchDvDId);ok(Boolean(matchDvDId),'OWNER A creates a D3-vs-D3 match against Club B -> PASS (both are real clubs, ownership only required on one side)');

  // --- Invalid shapes rejected ---
  r=await service.rpc('create_match',{actor_id:ownerId,p_home_team_season_id:teamSeasonA,p_away_team_season_id:teamSeasonB,p_external_opponent_name:'Should not be allowed',p_competition_season_id:null,p_competition_group_id:null,p_venue_id:null,p_kickoff_at:kickoff});ok(Boolean(r.error),'cannot set both a D3 opponent and a free-text opponent name');
  r=await service.rpc('create_match',{actor_id:ownerId,p_home_team_season_id:teamSeasonA,p_away_team_season_id:null,p_external_opponent_name:null,p_competition_season_id:null,p_competition_group_id:null,p_venue_id:null,p_kickoff_at:kickoff});ok(Boolean(r.error),'opponent required: neither D3 team nor free text given');
  r=await service.rpc('create_match',{actor_id:ownerId,p_home_team_season_id:null,p_away_team_season_id:null,p_external_opponent_name:'FC X',p_competition_season_id:null,p_competition_group_id:null,p_venue_id:null,p_kickoff_at:kickoff});ok(Boolean(r.error),'at least one side must be a D3 team');
  r=await service.rpc('enter_match_result',{actor_id:ownerId,p_match_id:matchExternalId,p_home_score:-1,p_away_score:0});ok(Boolean(r.error),'negative score rejected');

  // --- Cross-club attacks on an existing match ---
  r=await service.rpc('update_match',{actor_id:ownerBId,p_match_id:matchExternalId,p_home_team_season_id:teamSeasonA,p_away_team_season_id:null,p_external_opponent_name:'Hijacked',p_kickoff_at:kickoff,p_venue_id:null,p_competition_season_id:null,p_competition_group_id:null});ok(Boolean(r.error),'OWNER B -> edit Club A match -> MUST FAIL (cross-club edit denied)');
  r=await service.rpc('enter_match_result',{actor_id:ownerBId,p_match_id:matchExternalId,p_home_score:9,p_away_score:0});ok(Boolean(r.error),'OWNER B -> set score on Club A match -> MUST FAIL (cross-club score denied)');
  r=await anon.from('matches').update({home_score:5,away_score:0}).eq('id',matchExternalId);ok(Boolean(r.error)||!r.data?.length,'anon direct table mutation -> MUST FAIL');
  r=await other.client.from('matches').insert({season_id:created.data.season_id,home_team_season_id:teamSeasonA,kickoff_at:kickoff,external_opponent_name:'Direct insert'});ok(Boolean(r.error),'authenticated direct table insert -> MUST FAIL');

  // --- Legitimate schedule edit + result entry by the rightful OWNER ---
  const newKickoff=new Date(Date.now()+10*24*3600*1000).toISOString();
  r=await service.rpc('update_match',{actor_id:ownerId,p_match_id:matchExternalId,p_home_team_season_id:teamSeasonA,p_away_team_season_id:null,p_external_opponent_name:'FC Externe Renomme',p_kickoff_at:newKickoff,p_venue_id:null,p_competition_season_id:null,p_competition_group_id:null});if(r.error)throw r.error;ok(true,'OWNER A edits own match (kickoff + opponent name) -> PASS');
  r=await service.rpc('enter_match_result',{actor_id:ownerId,p_match_id:matchExternalId,p_home_score:3,p_away_score:1});if(r.error)throw r.error;ok(true,'OWNER A enters result on own match -> PASS');
  const played=await service.from('matches').select('status,home_score,away_score').eq('id',matchExternalId).single();ok(played.data.status==='PLAYED'&&played.data.home_score===3&&played.data.away_score===1,'match now PLAYED with correct score');
  r=await service.rpc('update_match',{actor_id:ownerId,p_match_id:matchExternalId,p_home_team_season_id:teamSeasonA,p_away_team_season_id:null,p_external_opponent_name:'Trying to edit after PLAYED',p_kickoff_at:newKickoff,p_venue_id:null,p_competition_season_id:null,p_competition_group_id:null});ok(Boolean(r.error),'schedule can no longer be edited once the match is PLAYED');
  r=await service.rpc('enter_match_result',{actor_id:ownerId,p_match_id:matchExternalId,p_home_score:4,p_away_score:1});if(r.error)throw r.error;ok(true,'OWNER A corrects an already-PLAYED score -> PASS');

  // --- Postpone/cancel on the D3-vs-D3 match, never a hard delete ---
  // matchDvDId is Club A (home) vs Club B (away): Club B is a legitimate
  // party via the away side, so the real cross-club check here is a user
  // with ownership on *neither* side.
  r=await service.rpc('postpone_match',{actor_id:otherId,p_match_id:matchDvDId});ok(Boolean(r.error),'user with no ownership on either side cannot postpone the match -> MUST FAIL');
  r=await service.rpc('cancel_match',{actor_id:ownerId,p_match_id:matchDvDId});if(r.error)throw r.error;ok(true,'OWNER A cancels the D3-vs-D3 match (own side) -> PASS');
  const cancelled=await service.from('matches').select('status').eq('id',matchDvDId).single();ok(cancelled.data.status==='CANCELLED','cancelled match keeps its row (soft state, never hard-deleted)');
  r=await anon.from('matches').select('id').eq('id',matchDvDId);ok(r.data?.length===1,'cancelled match still publicly readable (history preserved)');

  // --- Public read ---
  r=await anon.from('matches').select('id,status,home_score,away_score').eq('id',matchExternalId).single();ok(r.data?.status==='PLAYED'&&r.data.home_score===4,'anon can publicly read the final score');

  // --- Audit trail ---
  const audit=await service.from('admin_audit_logs').select('action').or(`entity_id.eq.${matchExternalId},entity_id.eq.${matchDvDId}`);const actions=new Set((audit.data??[]).map(a=>a.action));
  ok(['match_created','match_edited','kickoff_changed','opponent_changed','result_entered','result_corrected','match_cancelled'].every(a=>actions.has(a)),'audit log covers created/edited/kickoff/opponent/result-entered/result-corrected/cancelled');

  console.log(`PASS ${n} Step 5A RLS and integration assertions`);
}finally{
  if(matchIds.length){await service.from('admin_audit_logs').delete().in('entity_id',matchIds);await service.from('matches').delete().in('id',matchIds)}
  const teamSeasonIds=[teamSeasonA,teamSeasonB].filter(Boolean);
  if(teamSeasonIds.length){const teamIds=(await service.from('team_seasons').select('team_id').in('id',teamSeasonIds)).data?.map(t=>t.team_id)??[];await service.from('team_seasons').delete().in('id',teamSeasonIds);if(teamIds.length){await service.from('admin_audit_logs').delete().in('entity_id',teamIds);await service.from('teams').delete().in('id',teamIds)}}
  if(clubIds.length){await service.from('club_memberships').delete().in('club_id',clubIds);await service.from('admin_audit_logs').delete().in('entity_id',clubIds);await service.from('clubs').delete().in('id',clubIds)}
  for(const id of [ownerId,otherId,ownerBId].filter(Boolean))await service.auth.admin.deleteUser(id);
}
