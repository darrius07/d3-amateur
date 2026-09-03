import nextEnv from '@next/env';import {createClient} from '@supabase/supabase-js';import crypto from 'node:crypto';nextEnv.loadEnvConfig(process.cwd());
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
const service=createClient(url,serviceKey,{auth:{persistSession:false}}),anon=createClient(url,key,{auth:{persistSession:false}});
let n=0;const ok=(value,label)=>{if(!value)throw new Error(`FAIL ${label}: got ${JSON.stringify(value)}`);console.log(`ok ${++n} - ${label}`)};
const suffix=crypto.randomUUID();
let ownerAId,ownerBId,clubAId,clubBId,teamSeasonA,teamSeasonB,asOwnerA;
try{
  const emailA=`step6b-${suffix}-a@example.invalid`,emailB=`step6b-${suffix}-b@example.invalid`,password=`D3!${suffix}`;
  const createdA=await service.auth.admin.createUser({email:emailA,password,email_confirm:true});if(createdA.error)throw createdA.error;ownerAId=createdA.data.user.id;
  const createdB=await service.auth.admin.createUser({email:emailB,password,email_confirm:true});if(createdB.error)throw createdB.error;ownerBId=createdB.data.user.id;
  const authClient=createClient(url,key,{auth:{persistSession:false}});
  const loginA=await authClient.auth.signInWithPassword({email:emailA,password});if(loginA.error)throw loginA.error;
  asOwnerA=createClient(url,key,{global:{headers:{Authorization:`Bearer ${loginA.data.session.access_token}`}},auth:{persistSession:false}});

  const clubA=await service.from('clubs').insert({slug:`step6b-a-${suffix}`,official_name:'Officielle A',display_name:'Club A',status:'active',claim_status:'claimed'}).select('id').single();if(clubA.error)throw clubA.error;clubAId=clubA.data.id;
  const clubB=await service.from('clubs').insert({slug:`step6b-b-${suffix}`,official_name:'Officielle B',display_name:'Club B',status:'active',claim_status:'claimed'}).select('id').single();if(clubB.error)throw clubB.error;clubBId=clubB.data.id;
  await service.from('club_memberships').insert([{club_id:clubAId,user_id:ownerAId,role:'OWNER',active:true},{club_id:clubBId,user_id:ownerBId,role:'OWNER',active:true}]).throwOnError();
  let r=await service.rpc('ensure_senior_team',{actor_id:ownerAId,target_club_id:clubAId,rank_value:1});if(r.error)throw r.error;teamSeasonA=r.data.id;
  r=await service.rpc('ensure_senior_team',{actor_id:ownerBId,target_club_id:clubBId,rank_value:1});if(r.error)throw r.error;teamSeasonB=r.data.id;

  // --- OWNER A: own club, club-wide + team-specific, PASS ---
  r=await service.rpc('add_club_staff',{actor_id:ownerAId,target_club_id:clubAId,p_team_season_id:null,p_display_name:'Jean Dupont',p_role_type:'PRESIDENT',p_custom_role:null,p_short_bio:'President depuis 2020',p_public_visible:true});
  ok(!r.error,`OWNER A creates club-wide staff on Club A (${r.error?.message})`);
  const presidentId=r.data;
  r=await service.rpc('add_club_staff',{actor_id:ownerAId,target_club_id:clubAId,p_team_season_id:teamSeasonA,p_display_name:'Marc Martin',p_role_type:'HEAD_COACH',p_custom_role:null,p_short_bio:null,p_public_visible:true});
  ok(!r.error,'OWNER A creates team-specific staff on Club A');
  const coachId=r.data;
  r=await service.rpc('add_club_staff',{actor_id:ownerAId,target_club_id:clubAId,p_team_season_id:teamSeasonA,p_display_name:'Paul Durand',p_role_type:'ASSISTANT_COACH',p_custom_role:null,p_short_bio:null,p_public_visible:false});
  ok(!r.error,'OWNER A creates a private (public_visible=false) staff member');

  // --- Role / OTHER validation ---
  r=await service.rpc('add_club_staff',{actor_id:ownerAId,target_club_id:clubAId,p_team_season_id:null,p_display_name:'X',p_role_type:'OTHER',p_custom_role:null,p_short_bio:null,p_public_visible:false});
  ok(Boolean(r.error),'role=OTHER without custom_role rejected');
  r=await service.rpc('add_club_staff',{actor_id:ownerAId,target_club_id:clubAId,p_team_season_id:null,p_display_name:'Responsable buvette',p_role_type:'OTHER',p_custom_role:'Responsable buvette',p_short_bio:null,p_public_visible:false});
  ok(!r.error,'role=OTHER with a custom_role accepted');
  const otherId=r.data;
  const otherRow=await service.from('club_staff').select('custom_role').eq('id',otherId).single();
  ok(otherRow.data.custom_role==='Responsable buvette','custom_role stored correctly for OTHER');
  r=await service.rpc('add_club_staff',{actor_id:ownerAId,target_club_id:clubAId,p_team_season_id:null,p_display_name:'Test',p_role_type:'HEAD_COACH',p_custom_role:'Should be nulled',p_short_bio:null,p_public_visible:false});
  ok(!r.error,'a non-OTHER role with a stray custom_role value is still accepted (RPC nulls it, mirrors 5B.2 defensive-normalization pattern)');
  const nulledRow=await service.from('club_staff').select('custom_role').eq('id',r.data).single();
  ok(nulledRow.data.custom_role===null,'custom_role is silently nulled for a non-OTHER role, never stored');

  // --- display_name / short_bio validation ---
  r=await service.rpc('add_club_staff',{actor_id:ownerAId,target_club_id:clubAId,p_team_season_id:null,p_display_name:'   ',p_role_type:'HEAD_COACH',p_custom_role:null,p_short_bio:null,p_public_visible:false});
  ok(Boolean(r.error),'whitespace-only display_name rejected');
  r=await service.rpc('add_club_staff',{actor_id:ownerAId,target_club_id:clubAId,p_team_season_id:null,p_display_name:'x'.repeat(121),p_role_type:'HEAD_COACH',p_custom_role:null,p_short_bio:null,p_public_visible:false});
  ok(Boolean(r.error),'oversized display_name (121 chars) rejected');
  r=await service.rpc('add_club_staff',{actor_id:ownerAId,target_club_id:clubAId,p_team_season_id:null,p_display_name:'Bio Test',p_role_type:'HEAD_COACH',p_custom_role:null,p_short_bio:'x'.repeat(281),p_public_visible:false});
  ok(Boolean(r.error),'oversized short_bio (281 chars) rejected');

  // --- Team/club integrity (mission section 25) ---
  r=await service.rpc('add_club_staff',{actor_id:ownerAId,target_club_id:clubAId,p_team_season_id:teamSeasonB,p_display_name:'Cross Team',p_role_type:'HEAD_COACH',p_custom_role:null,p_short_bio:null,p_public_visible:false});
  ok(Boolean(r.error),"Club A staff referencing Club B's team_season MUST FAIL (team/club integrity trigger)");
  r=await service.rpc('update_club_staff',{actor_id:ownerAId,p_staff_id:coachId,p_team_season_id:teamSeasonB,p_display_name:'Marc Martin',p_role_type:'HEAD_COACH',p_custom_role:null,p_short_bio:null,p_public_visible:true,p_sort_order:null});
  ok(Boolean(r.error),"updating an existing Club A staff member to point at Club B's team MUST FAIL too");

  // --- Cross-club attacks (mission section 24) ---
  r=await service.rpc('add_club_staff',{actor_id:ownerAId,target_club_id:clubBId,p_team_season_id:null,p_display_name:'Intruder',p_role_type:'PRESIDENT',p_custom_role:null,p_short_bio:null,p_public_visible:true});
  ok(Boolean(r.error),'OWNER A -> create staff Club B MUST FAIL');
  r=await service.rpc('update_club_staff',{actor_id:ownerAId,p_staff_id:presidentId,p_team_season_id:null,p_display_name:'Hacked',p_role_type:'PRESIDENT',p_custom_role:null,p_short_bio:null,p_public_visible:true,p_sort_order:null});
  // (this one is actually OWNER A editing OWNER A's own staff -- verify it PASSES, the real cross-club edit test is OWNER B below)
  ok(!r.error,'OWNER A editing their OWN staff (sanity check before the real cross-club edit test)');
  r=await service.rpc('update_club_staff',{actor_id:ownerBId,p_staff_id:presidentId,p_team_season_id:null,p_display_name:'Hacked by B',p_role_type:'PRESIDENT',p_custom_role:null,p_short_bio:null,p_public_visible:true,p_sort_order:null});
  ok(Boolean(r.error),'OWNER B -> edit Staff Club A MUST FAIL');
  r=await service.rpc('deactivate_club_staff',{actor_id:ownerBId,p_staff_id:presidentId});
  ok(Boolean(r.error),'OWNER B -> deactivate Staff Club A MUST FAIL');
  r=await service.rpc('add_club_staff',{actor_id:crypto.randomUUID(),target_club_id:clubAId,p_team_season_id:null,p_display_name:'Ghost',p_role_type:'PRESIDENT',p_custom_role:null,p_short_bio:null,p_public_visible:true});
  ok(Boolean(r.error),'a random non-member actor_id -> create MUST FAIL');

  // --- anon mutation denial ---
  r=await anon.rpc('add_club_staff',{actor_id:ownerAId,target_club_id:clubAId,p_team_season_id:null,p_display_name:'Anon',p_role_type:'PRESIDENT',p_custom_role:null,p_short_bio:null,p_public_visible:true});
  ok(Boolean(r.error),'anon -> add_club_staff MUST FAIL');
  r=await anon.from('club_staff').insert({club_id:clubAId,display_name:'Direct insert',role_type:'PRESIDENT'});
  ok(Boolean(r.error),'anon cannot INSERT club_staff directly (no grant)');
  r=await asOwnerA.rpc('add_club_staff',{actor_id:ownerAId,target_club_id:clubAId,p_team_season_id:null,p_display_name:'Direct RPC',p_role_type:'PRESIDENT',p_custom_role:null,p_short_bio:null,p_public_visible:true});
  ok(Boolean(r.error),'authenticated OWNER cannot call add_club_staff directly (service_role only)');

  // --- Public read: anon sees only active+public_visible, safe columns only ---
  let pub=await anon.from('club_staff_public').select('*').eq('club_id',clubAId);
  ok(pub.data.length===2,`anon public Staff read: sees exactly 2 (President+Coach, both public) -- got ${pub.data?.length}`);
  ok(!pub.data.some(s=>s.display_name==='Paul Durand'),'the private (public_visible=false) assistant is invisible to anon');
  ok(!Object.prototype.hasOwnProperty.call(pub.data[0],'created_by'),'club_staff_public never exposes created_by');
  ok(!Object.prototype.hasOwnProperty.call(pub.data[0],'source_id'),'club_staff_public never exposes source_id');

  let anonBase=await anon.from('club_staff').select('created_by').eq('id',presidentId).maybeSingle();
  ok(Boolean(anonBase.error),'anon cannot SELECT club_staff (the base table) at all -- created_by is unreachable');
  const svcCreatedBy=await service.from('club_staff').select('created_by').eq('id',presidentId).single();
  ok(svcCreatedBy.data.created_by===ownerAId,'service_role/server still resolves created_by correctly for internal/audit use');

  // --- inactive staff invisible to anon ---
  r=await service.rpc('deactivate_club_staff',{actor_id:ownerAId,p_staff_id:coachId});
  ok(!r.error,'OWNER A deactivates their own Club A staff (coach)');
  pub=await anon.from('club_staff_public').select('display_name').eq('club_id',clubAId);
  ok(!pub.data.some(s=>s.display_name==='Marc Martin'),'a deactivated staff member is invisible to anon, even though public_visible was true');

  // --- audit granularity ---
  const audits=await service.from('admin_audit_logs').select('action').eq('entity_id',presidentId).eq('entity_type','club_staff');
  const actions=new Set(audits.data.map(a=>a.action));
  ok(actions.has('staff_created'),'staff_created audited');
  ok(actions.has('staff_updated')||actions.has('staff_visibility_changed'),'update produced a granular audit row (staff_updated and/or staff_visibility_changed, never one per keystroke)');

  console.log(`PASS ${n} Step 6B club staff assertions`);
}finally{
  const clubIds=[clubAId,clubBId].filter(Boolean);
  if(clubIds.length){
    await service.from('admin_audit_logs').delete().in('entity_id',clubIds);
    const staffRows=await service.from('club_staff').select('id').in('club_id',clubIds);
    if(staffRows.data?.length)await service.from('admin_audit_logs').delete().in('entity_id',staffRows.data.map(s=>s.id));
    await service.from('club_staff').delete().in('club_id',clubIds);
    const teamSeasons=[teamSeasonA,teamSeasonB].filter(Boolean);
    if(teamSeasons.length)await service.from('team_seasons').delete().in('id',teamSeasons);
    const teams=await service.from('teams').select('id').in('club_id',clubIds);
    if(teams.data?.length){await service.from('admin_audit_logs').delete().in('entity_id',teams.data.map(t=>t.id));await service.from('teams').delete().in('id',teams.data.map(t=>t.id))}
    await service.from('club_memberships').delete().in('club_id',clubIds);
    await service.from('clubs').delete().in('id',clubIds);
  }
  for(const id of [ownerAId,ownerBId].filter(Boolean))await service.auth.admin.deleteUser(id);
}
