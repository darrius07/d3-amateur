import nextEnv from '@next/env';import {createClient} from '@supabase/supabase-js';import crypto from 'node:crypto';nextEnv.loadEnvConfig(process.cwd());
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key||!serviceKey)throw new Error('Supabase env missing');const service=createClient(url,serviceKey,{auth:{persistSession:false}}),anon=createClient(url,key,{auth:{persistSession:false}});let n=0;const ok=(value,label)=>{if(!value)throw new Error(`FAIL ${label}`);console.log(`ok ${++n} - ${label}`)};
const suffix=crypto.randomUUID(),password=`D3!${suffix}`;let ownerId,otherId,ownerBId,clubA,clubB,teamSeasonA1,teamSeasonB1,playerId,rosterId,activeSeasonId;const clubIds=[];
async function makeUser(label){const email=`step4-${label}-${suffix}@example.invalid`;const created=await service.auth.admin.createUser({email,password,email_confirm:true});if(created.error)throw created.error;const authClient=createClient(url,key,{auth:{persistSession:false}});const login=await authClient.auth.signInWithPassword({email,password});if(login.error)throw login.error;return {id:created.data.user.id,client:createClient(url,key,{global:{headers:{Authorization:`Bearer ${login.data.session.access_token}`}},auth:{persistSession:false}})}}
try{
  const owner=await makeUser('owner'),other=await makeUser('other'),ownerB=await makeUser('ownerb');ownerId=owner.id;otherId=other.id;ownerBId=ownerB.id;
  const season=await service.from('seasons').select('id').eq('active',true).single();if(season.error)throw season.error;activeSeasonId=season.data.id;
  const clubs=await service.from('clubs').insert([{slug:`step4-a-${suffix}`,official_name:'Step 4 Test Club A',display_name:'Step 4 Test Club A',status:'active',claim_status:'claimed'},{slug:`step4-b-${suffix}`,official_name:'Step 4 Test Club B',display_name:'Step 4 Test Club B',status:'active',claim_status:'claimed'}]).select('id');if(clubs.error)throw clubs.error;[clubA,clubB]=clubs.data.map(c=>c.id);clubIds.push(clubA,clubB);
  await service.from('club_memberships').insert([{club_id:clubA,user_id:ownerId,role:'OWNER',active:true},{club_id:clubB,user_id:ownerBId,role:'OWNER',active:true}]).throwOnError();

  // --- RPC grant boundary: only service_role has EXECUTE, never anon/authenticated ---
  let r=await anon.rpc('ensure_senior_team',{actor_id:ownerId,target_club_id:clubA,rank_value:1});ok(Boolean(r.error),'anon cannot call ensure_senior_team');
  r=await owner.client.rpc('ensure_senior_team',{actor_id:ownerId,target_club_id:clubA,rank_value:1});ok(Boolean(r.error),'authenticated OWNER session cannot call ensure_senior_team directly (service-role only, no service key on client)');

  // --- Team creation (simulating the real server action after ownerContext already verified the caller) ---
  r=await service.rpc('ensure_senior_team',{actor_id:ownerId,target_club_id:clubA,rank_value:1});if(r.error)throw r.error;teamSeasonA1=r.data.id;ok(Boolean(teamSeasonA1),'OWNER creates Seniors A for own club');
  r=await service.rpc('ensure_senior_team',{actor_id:ownerId,target_club_id:clubA,rank_value:1});if(r.error)throw r.error;ok(r.data.id===teamSeasonA1,'ensure_senior_team is idempotent (no duplicate team on repeat call)');
  r=await service.rpc('ensure_senior_team',{actor_id:ownerId,target_club_id:clubB,rank_value:1});ok(Boolean(r.error),'OWNER A cannot create a team for club B (cross-club attack denied)');
  r=await service.rpc('ensure_senior_team',{actor_id:ownerBId,target_club_id:clubB,rank_value:1});if(r.error)throw r.error;teamSeasonB1=r.data.id;ok(Boolean(teamSeasonB1),'OWNER B creates Seniors A for own club');

  // --- Direct table writes are never allowed, even for the OWNER's own session: everything must go through the RPCs ---
  r=await anon.from('players').insert({slug:`x-${suffix}`,first_name:'X',last_name:'Y'});ok(Boolean(r.error),'anon cannot insert a player row directly');
  r=await owner.client.from('players').insert({slug:`x2-${suffix}`,first_name:'X',last_name:'Y'});ok(Boolean(r.error),'authenticated OWNER cannot insert a player row directly (must go through manage_roster_player)');
  r=await other.client.from('players').insert({slug:`x3-${suffix}`,first_name:'X',last_name:'Y'});ok(Boolean(r.error),'normal user direct create player unauthorized -> MUST FAIL');
  r=await anon.rpc('manage_roster_player',{actor_id:ownerId,target_team_season_id:teamSeasonA1,existing_player_id:null,new_first_name:'Jean',new_last_name:'Test',new_slug:`jean-test-${suffix}`,position_value:'MIDFIELDER',squad_value:10});ok(Boolean(r.error),'anon cannot call manage_roster_player');
  r=await owner.client.rpc('manage_roster_player',{actor_id:ownerId,target_team_season_id:teamSeasonA1,existing_player_id:null,new_first_name:'Jean',new_last_name:'Test',new_slug:`jean-test-${suffix}`,position_value:'MIDFIELDER',squad_value:10});ok(Boolean(r.error),'authenticated OWNER session cannot call manage_roster_player directly (service-role only)');
  r=await other.client.rpc('manage_roster_player',{actor_id:otherId,target_team_season_id:teamSeasonA1,existing_player_id:null,new_first_name:'Jean',new_last_name:'Test',new_slug:`jean-test2-${suffix}`,position_value:'MIDFIELDER',squad_value:11});ok(Boolean(r.error),'authenticated user without membership cannot add roster to club A');

  // --- OWNER A adds a player to own roster -> PASS (this is the path the real server action takes) ---
  r=await service.rpc('manage_roster_player',{actor_id:ownerId,target_team_season_id:teamSeasonA1,existing_player_id:null,new_first_name:'Jean',new_last_name:`Test${suffix.slice(0,6)}`,new_slug:`jean-test-${suffix}`,position_value:'MIDFIELDER',squad_value:10});if(r.error)throw r.error;playerId=r.data;ok(Boolean(playerId),'OWNER A creates and attaches a new player to own roster -> PASS');
  r=await anon.from('players').select('id').eq('id',playerId).eq('profile_status','PUBLIC');ok(r.data?.length===1,'anon can read the newly created player (public profile)');
  r=await anon.rpc('search_players',{query:'Jean',result_limit:12});if(r.error)throw r.error;ok(r.data.some(p=>p.id===playerId),'anon can find the player through search_players (public search)');

  // --- Duplicate roster prevention: re-adding the same player to the same roster updates in place, never duplicates ---
  r=await service.rpc('manage_roster_player',{actor_id:ownerId,target_team_season_id:teamSeasonA1,existing_player_id:playerId,new_first_name:null,new_last_name:null,new_slug:null,position_value:'DEFENDER',squad_value:11});if(r.error)throw r.error;
  const rosterCount=await service.from('team_roster_members').select('id',{count:'exact',head:true}).eq('team_season_id',teamSeasonA1).eq('player_id',playerId).eq('active',true);ok(rosterCount.count===1,'same player cannot appear twice in the same active roster (upsert, not duplicate)');
  const rosterRow=await service.from('team_roster_members').select('id').eq('team_season_id',teamSeasonA1).eq('player_id',playerId).eq('active',true).single();if(rosterRow.error)throw rosterRow.error;rosterId=rosterRow.data.id;

  // --- Cross-club roster attack: OWNER A -> roster B -> MUST FAIL ---
  r=await service.rpc('manage_roster_player',{actor_id:ownerId,target_team_season_id:teamSeasonB1,existing_player_id:null,new_first_name:'Hacker',new_last_name:'Attempt',new_slug:`hacker-${suffix}`,position_value:'FORWARD',squad_value:9});ok(Boolean(r.error),'OWNER A -> roster B -> MUST FAIL (cross-club roster attack denied)');
  r=await service.rpc('update_roster_member',{actor_id:ownerBId,roster_member_id:rosterId,position_value:'FORWARD',squad_value:1});ok(Boolean(r.error),'OWNER B cannot update a Club A roster member -> MUST FAIL');
  r=await service.rpc('remove_roster_member',{actor_id:ownerBId,roster_member_id:rosterId});ok(Boolean(r.error),'OWNER B cannot remove a Club A roster member -> MUST FAIL');

  // --- Ambiguous registration: same player, same season, a second club -> sent to review, never silently merged/overwritten ---
  r=await service.rpc('manage_roster_player',{actor_id:ownerBId,target_team_season_id:teamSeasonB1,existing_player_id:playerId,new_first_name:null,new_last_name:null,new_slug:null,position_value:'FORWARD',squad_value:7});if(r.error)throw r.error;ok(r.data===null,'ambiguous cross-club registration (same season) returns null instead of merging');
  const reviewReg=await service.from('player_registrations').select('status,verification_status').eq('player_id',playerId).eq('club_id',clubB).eq('season_id',activeSeasonId).maybeSingle();ok(reviewReg.data?.status==='REVIEW'&&reviewReg.data?.verification_status==='NEEDS_REVIEW','ambiguous registration recorded as REVIEW/NEEDS_REVIEW, never silently ACTIVE');
  const rosterB=await service.from('team_roster_members').select('id').eq('team_season_id',teamSeasonB1).eq('player_id',playerId).eq('active',true);ok((rosterB.data?.length??0)===0,'ambiguous registration does not create a Club B roster membership');

  // --- Canonical player can never be deleted, by anyone, through any client-reachable path ---
  r=await owner.client.from('players').delete().eq('id',playerId);ok(Boolean(r.error)||!r.data?.length,'OWNER A cannot delete the canonical player -> MUST FAIL');
  r=await anon.from('players').delete().eq('id',playerId);ok(Boolean(r.error)||!r.data?.length,'anon cannot delete the canonical player -> MUST FAIL');

  // --- Legitimate roster management by the rightful OWNER -> PASS ---
  r=await service.rpc('update_roster_member',{actor_id:ownerId,roster_member_id:rosterId,position_value:'FORWARD',squad_value:4});if(r.error)throw r.error;ok(true,'OWNER A updates own roster member -> PASS');
  r=await service.rpc('remove_roster_member',{actor_id:ownerId,roster_member_id:rosterId});if(r.error)throw r.error;ok(true,'OWNER A removes own roster member -> PASS (soft removal)');
  const stillExists=await service.from('players').select('id').eq('id',playerId).maybeSingle();ok(Boolean(stillExists.data),'removing a roster member never deletes the canonical player');
  const rosterAfterRemoval=await anon.from('team_roster_members').select('id').eq('id',rosterId).eq('active',true);ok((rosterAfterRemoval.data?.length??0)===0,'removed roster member is no longer publicly visible');

  // --- Audit trail and analytics ---
  const audit=await service.from('admin_audit_logs').select('action').or(`entity_id.eq.${playerId},entity_id.eq.${rosterId}`);const actions=new Set((audit.data??[]).map(a=>a.action));ok(actions.has('player_created')&&actions.has('player_attached')&&actions.has('roster_member_added')&&actions.has('roster_position_changed')&&actions.has('squad_number_changed')&&actions.has('roster_member_removed'),'audit log records created/attached/added/position/squad/removed');
  const events=await service.from('product_events').select('event_name').or(`entity_id.eq.${playerId},entity_id.eq.${rosterId}`);const eventNames=new Set((events.data??[]).map(e=>e.event_name));ok(eventNames.has('player_created')&&eventNames.has('player_attached')&&eventNames.has('roster_member_added')&&eventNames.has('roster_member_removed'),'product_events records created/attached/added/removed');

  console.log(`PASS ${n} Step 4 RLS and integration assertions`);
}finally{
  const teamSeasonIds=[teamSeasonA1,teamSeasonB1].filter(Boolean);
  if(playerId){await service.from('team_roster_members').delete().eq('player_id',playerId);await service.from('player_registrations').delete().eq('player_id',playerId);await service.from('product_events').delete().eq('entity_id',playerId);if(rosterId)await service.from('product_events').delete().eq('entity_id',rosterId);await service.from('admin_audit_logs').delete().in('entity_id',[playerId,rosterId].filter(Boolean));await service.from('players').delete().eq('id',playerId)}
  if(teamSeasonIds.length){const teamIds=(await service.from('team_seasons').select('team_id').in('id',teamSeasonIds)).data?.map(t=>t.team_id)??[];await service.from('team_seasons').delete().in('id',teamSeasonIds);if(teamIds.length){await service.from('admin_audit_logs').delete().in('entity_id',teamIds);await service.from('teams').delete().in('id',teamIds)}}
  if(clubIds.length){await service.from('club_memberships').delete().in('club_id',clubIds);await service.from('admin_audit_logs').delete().in('entity_id',clubIds);await service.from('clubs').delete().in('id',clubIds)}
  for(const id of [ownerId,otherId,ownerBId].filter(Boolean))await service.auth.admin.deleteUser(id);
}
