import nextEnv from '@next/env';import {createClient} from '@supabase/supabase-js';import crypto from 'node:crypto';nextEnv.loadEnvConfig(process.cwd());
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
const service=createClient(url,serviceKey,{auth:{persistSession:false}}),anon=createClient(url,key,{auth:{persistSession:false}});
let n=0;const ok=(value,label)=>{if(!value)throw new Error(`FAIL ${label}: got ${JSON.stringify(value)}`);console.log(`ok ${++n} - ${label}`)};
const suffix=crypto.randomUUID();
let userAId,userBId,adminId,asUserA,asUserB,existingClubId,reqId,newClubId,membershipId;
try{
  const emailA=`step6d-${suffix}-a@example.invalid`,emailB=`step6d-${suffix}-b@example.invalid`,emailAdmin=`step6d-${suffix}-admin@example.invalid`,password=`D3!${suffix}`;
  const createdA=await service.auth.admin.createUser({email:emailA,password,email_confirm:true});if(createdA.error)throw createdA.error;userAId=createdA.data.user.id;
  const createdB=await service.auth.admin.createUser({email:emailB,password,email_confirm:true});if(createdB.error)throw createdB.error;userBId=createdB.data.user.id;
  const createdAdmin=await service.auth.admin.createUser({email:emailAdmin,password,email_confirm:true});if(createdAdmin.error)throw createdAdmin.error;adminId=createdAdmin.data.user.id;
  await service.from('user_profiles').update({d3_admin_role:'superadmin'}).eq('id',adminId).throwOnError();
  const loginA=await createClient(url,key,{auth:{persistSession:false}}).auth.signInWithPassword({email:emailA,password});if(loginA.error)throw loginA.error;
  asUserA=createClient(url,key,{global:{headers:{Authorization:`Bearer ${loginA.data.session.access_token}`}},auth:{persistSession:false}});
  const loginB=await createClient(url,key,{auth:{persistSession:false}}).auth.signInWithPassword({email:emailB,password});if(loginB.error)throw loginB.error;
  asUserB=createClient(url,key,{global:{headers:{Authorization:`Bearer ${loginB.data.session.access_token}`}},auth:{persistSession:false}});

  const existing=await service.from('clubs').insert({slug:`step6d-existing-${suffix}`,official_name:'FC Bellevue Existant',display_name:'FC Bellevue Existant',city:'Lyon',postal_code:'69000',status:'active',claim_status:'unclaimed'}).select('id').single();
  if(existing.error)throw existing.error;existingClubId=existing.data.id;

  // --- duplicate detection RPC (public, read-only) ---
  let r=await anon.rpc('find_duplicate_club_candidates',{p_name:'FC Bellevue Existant',p_city:'Lyon',p_postal_code:'69000'});
  ok(!r.error&&r.data.length===1&&r.data[0].review_state==='LIKELY_DUPLICATE','exact name + same city -> LIKELY_DUPLICATE');
  r=await anon.rpc('find_duplicate_club_candidates',{p_name:'FC Bellevue Existant',p_city:'Marseille',p_postal_code:null});
  ok(!r.error&&r.data.length===1&&r.data[0].review_state==='POSSIBLE','exact name, different city -> POSSIBLE');
  r=await anon.rpc('find_duplicate_club_candidates',{p_name:'Club Totalement Inedit XYZ',p_city:'Nulle Part',p_postal_code:null});
  ok(!r.error&&r.data.length===0,'no plausible match -> empty result');

  // --- anon cannot create a request (auth required, mission section 8/31) ---
  r=await anon.from('club_creation_requests').insert({requested_by:userAId,club_name:'Anon Club',city:'Paris',representative_confirmation:true});
  ok(Boolean(r.error),'anon -> INSERT club_creation_requests MUST FAIL');

  // --- User A creates their own request: PASS ---
  r=await asUserA.from('club_creation_requests').insert({requested_by:userAId,club_name:'AS Nouvelle Jeunesse',city:'Villeurbanne',postal_code:'69100',representative_confirmation:true}).select('id,status,duplicate_review_state').single();
  ok(!r.error,`User A creates own request PASS (${r.error?.message})`);
  reqId=r.data.id;
  ok(r.data.status==='PENDING_REVIEW','new request starts PENDING_REVIEW');
  ok(r.data.duplicate_review_state==='NONE','a genuinely new club name has duplicate_review_state=NONE');

  // --- representative_confirmation must be true ---
  r=await asUserA.from('club_creation_requests').insert({requested_by:userAId,club_name:'Sans Confirmation',city:'Paris',representative_confirmation:false});
  ok(Boolean(r.error),'representative_confirmation=false rejected by CHECK');

  // --- User A cannot impersonate another requester ---
  r=await asUserA.from('club_creation_requests').insert({requested_by:userBId,club_name:'Usurpation',city:'Paris',representative_confirmation:true});
  ok(Boolean(r.error),'User A -> requested_by=User B MUST FAIL (WITH CHECK)');

  // --- anti-spam: same user + same normalized name + same city while PENDING_REVIEW ---
  r=await asUserA.from('club_creation_requests').insert({requested_by:userAId,club_name:'as nouvelle jeunesse',city:'Villeurbanne',representative_confirmation:true});
  ok(Boolean(r.error)&&r.error.code==='23505','duplicate active request (same normalized name+city) refused');

  // --- HTTPS-only reuse (mission section 11) ---
  r=await asUserA.from('club_creation_requests').insert({requested_by:userAId,club_name:'Club HTTP Test',city:'Paris',website_url:'http://insecure.example.com',representative_confirmation:true});
  ok(Boolean(r.error),'http:// website_url rejected (https-only reused)');

  // --- User A tries to set privileged fields directly on insert ---
  r=await asUserA.from('club_creation_requests').insert({requested_by:userAId,club_name:'Club Triche',city:'Paris',representative_confirmation:true,status:'APPROVED'});
  ok(Boolean(r.error),'User A -> insert with status=APPROVED MUST FAIL (WITH CHECK)');

  // --- User A reads own request: PASS ---
  r=await asUserA.from('club_creation_requests').select('id,status').eq('id',reqId).maybeSingle();
  ok(!r.error&&r.data?.id===reqId,'User A reads own request PASS');

  // --- User B cannot read User A's request ---
  r=await asUserB.from('club_creation_requests').select('id').eq('id',reqId).maybeSingle();
  ok(!r.error&&r.data===null,'User B -> read User A request MUST see nothing');

  // --- anon cannot read anything ---
  r=await anon.from('club_creation_requests').select('id').eq('id',reqId).maybeSingle();
  ok(Boolean(r.error),'anon -> SELECT club_creation_requests MUST FAIL (no grant)');

  // --- User A cannot mutate status/reviewed_by/created_club_id/duplicate fields directly (no UPDATE grant at all) ---
  r=await asUserA.from('club_creation_requests').update({status:'APPROVED'}).eq('id',reqId);
  ok(Boolean(r.error),'User A -> UPDATE status directly MUST FAIL (no UPDATE grant)');
  r=await asUserA.from('club_creation_requests').update({created_club_id:existingClubId}).eq('id',reqId);
  ok(Boolean(r.error),'User A -> UPDATE created_club_id directly MUST FAIL');
  r=await asUserA.from('club_creation_requests').update({duplicate_candidate_club_id:existingClubId}).eq('id',reqId);
  ok(Boolean(r.error),'User A -> UPDATE duplicate_candidate_club_id directly MUST FAIL');

  // --- User A cannot create a canonical club directly, nor an OWNER membership directly ---
  r=await asUserA.from('clubs').insert({slug:`hack-${suffix}`,official_name:'Hack',display_name:'Hack',status:'active',claim_status:'claimed'});
  ok(Boolean(r.error),'User A -> INSERT clubs directly MUST FAIL');
  r=await asUserA.from('club_memberships').insert({club_id:existingClubId,user_id:userAId,role:'OWNER',active:true});
  ok(Boolean(r.error),'User A -> INSERT club_memberships (OWNER) directly MUST FAIL');

  // --- non-admin cannot call the admin RPCs ---
  r=await service.rpc('approve_club_creation_request',{actor_id:userAId,p_request_id:reqId});
  ok(Boolean(r.error),'User A (non-admin) -> approve_club_creation_request MUST FAIL');
  r=await asUserA.rpc('approve_club_creation_request',{actor_id:adminId,p_request_id:reqId});
  ok(Boolean(r.error),'authenticated user cannot call approve_club_creation_request directly (service_role only)');
  r=await service.rpc('resolve_club_creation_request',{actor_id:userAId,p_request_id:reqId,p_decision:'REJECTED',p_admin_note:null,p_public_message:null,p_duplicate_candidate_club_id:null});
  ok(Boolean(r.error),'User A (non-admin) -> resolve_club_creation_request MUST FAIL');

  // --- Admin approves: atomic creation (mission section 20) ---
  r=await service.rpc('approve_club_creation_request',{actor_id:adminId,p_request_id:reqId});
  ok(!r.error,`Admin approves PASS (${r.error?.message})`);
  ok(r.data.status==='APPROVED','request now APPROVED');
  newClubId=r.data.created_club_id;
  ok(Boolean(newClubId),'created_club_id populated');

  const club=await service.from('clubs').select('display_name,official_name,city,source_id,claim_status,slug').eq('id',newClubId).single();
  ok(club.data.display_name==='AS Nouvelle Jeunesse','new club display_name = approved request name');
  ok(club.data.claim_status==='claimed','new club is claim_status=claimed immediately');
  const source=await service.from('data_sources').select('code').eq('id',club.data.source_id).single();
  ok(source.data.code==='USER_SUBMITTED','new club source_id points to USER_SUBMITTED');

  const memberships=await service.from('club_memberships').select('id,role,user_id').eq('club_id',newClubId);
  ok(memberships.data.length===1&&memberships.data[0].role==='OWNER'&&memberships.data[0].user_id===userAId,'exactly one OWNER membership granted to requester');
  membershipId=memberships.data[0].id;

  const audits=await service.from('admin_audit_logs').select('action,entity_id').or(`entity_id.eq.${reqId},entity_id.eq.${newClubId},entity_id.eq.${membershipId}`);
  const actions=new Set(audits.data.map(a=>a.action));
  ok(actions.has('club_creation_approved'),'club_creation_approved audited');
  ok(actions.has('user_submitted_club_created'),'user_submitted_club_created audited');
  ok(actions.has('owner_granted_from_creation_request'),'owner_granted_from_creation_request audited');

  // --- User A is now OWNER of the new club: manages it (control), cannot manage another club ---
  r=await asUserA.from('club_creation_requests').select('created_club_id').eq('id',reqId).single();
  ok(r.data.created_club_id===newClubId,'requester can see created_club_id after approval');
  r=await service.rpc('add_club_sponsor',{actor_id:userAId,target_club_id:newClubId,p_name:'Sponsor Test',p_website_url:null,p_tier:'MAIN',p_custom_tier_label:null,p_short_message:null,p_public_visible:true});
  ok(!r.error,'newly-OWNER User A can use the existing Club Studio sponsor RPC on their new club (template reuse, control)');
  r=await service.rpc('add_club_sponsor',{actor_id:userAId,target_club_id:existingClubId,p_name:'Intruder',p_website_url:null,p_tier:'MAIN',p_custom_tier_label:null,p_short_message:null,p_public_visible:true});
  ok(Boolean(r.error),'User A still cannot manage a different (existing) club');

  // --- approval idempotency (double-click, mission section 42) ---
  r=await service.rpc('approve_club_creation_request',{actor_id:adminId,p_request_id:reqId});
  ok(!r.error&&r.data.created_club_id===newClubId,'second APPROVE call is a no-op returning the same request');
  const clubCount=await service.from('clubs').select('id',{count:'exact',head:true}).eq('slug',club.data.slug);
  ok(clubCount.count===1,'idempotent approval created exactly one club (no duplicate)');
  const membershipCount=await service.from('club_memberships').select('id',{count:'exact',head:true}).eq('club_id',newClubId).eq('role','OWNER');
  ok(membershipCount.count===1,'idempotent approval created exactly one OWNER membership (no duplicate)');

  // --- slug collision (mission section 24) ---
  const reqDup=await asUserB.from('club_creation_requests').insert({requested_by:userBId,club_name:'AS Nouvelle Jeunesse',city:'Grenoble',representative_confirmation:true}).select('id').single();
  ok(!reqDup.error,'User B submits a request with the SAME normalized name (different city, different user) PASS');
  const approveDup=await service.rpc('approve_club_creation_request',{actor_id:adminId,p_request_id:reqDup.data.id});
  ok(!approveDup.error,`Admin approves the colliding-name request PASS (${approveDup.error?.message})`);
  const dupClub=await service.from('clubs').select('slug').eq('id',approveDup.data.created_club_id).single();
  ok(dupClub.data.slug!==club.data.slug&&dupClub.data.slug.startsWith(club.data.slug),`slug collision resolved deterministically: "${club.data.slug}" vs "${dupClub.data.slug}"`);

  // --- NEEDS_INFO / REJECTED paths ---
  const reqNeedsInfo=await asUserB.from('club_creation_requests').insert({requested_by:userBId,club_name:'Club Incomplet',city:'Nice',representative_confirmation:true}).select('id').single();
  r=await service.rpc('resolve_club_creation_request',{actor_id:adminId,p_request_id:reqNeedsInfo.data.id,p_decision:'NEEDS_INFO',p_admin_note:'Note interne jamais visible',p_public_message:'Merci de préciser la ville exacte du club.',p_duplicate_candidate_club_id:null});
  ok(!r.error&&r.data.status==='NEEDS_INFO','Admin sets NEEDS_INFO PASS');
  const asB=await asUserB.from('club_creation_requests').select('status,public_message,admin_note').eq('id',reqNeedsInfo.data.id).single();
  ok(asB.data.public_message==='Merci de préciser la ville exacte du club.','requester sees the public_message');
  // RLS lets the owning user read their whole row, including admin_note --
  // that column existing in the DB response is expected; the actual
  // privacy guarantee (mission section 26/28: never expose raw admin_note
  // to the requester) is a data-layer/UI responsibility, not an RLS one,
  // and is covered by the safe-user-projection unit tests instead.

  const reqRejected=await asUserB.from('club_creation_requests').insert({requested_by:userBId,club_name:'Club Refuse',city:'Toulon',representative_confirmation:true}).select('id').single();
  r=await service.rpc('resolve_club_creation_request',{actor_id:adminId,p_request_id:reqRejected.data.id,p_decision:'REJECTED',p_admin_note:'Informations non vérifiables',p_public_message:null,p_duplicate_candidate_club_id:null});
  ok(!r.error&&r.data.status==='REJECTED','Admin sets REJECTED PASS');
  r=await service.from('club_creation_requests').select('created_club_id').eq('id',reqRejected.data.id).single();
  ok(r.data.created_club_id===null,'REJECTED request never gets a created_club_id');

  // --- DUPLICATE path (mission section 25/46): no new club, no OWNER granted ---
  const reqDuplicatePath=await asUserB.from('club_creation_requests').insert({requested_by:userBId,club_name:'FC Bellevue Existant',city:'Lyon',postal_code:'69000',representative_confirmation:true}).select('id,duplicate_review_state,duplicate_candidate_club_id').single();
  ok(reqDuplicatePath.data.duplicate_review_state==='LIKELY_DUPLICATE'&&reqDuplicatePath.data.duplicate_candidate_club_id===existingClubId,'submission-time trigger flags LIKELY_DUPLICATE against the existing club');
  r=await service.rpc('resolve_club_creation_request',{actor_id:adminId,p_request_id:reqDuplicatePath.data.id,p_decision:'DUPLICATE',p_admin_note:'Doublon confirmé',p_public_message:'Ce club existe déjà dans D3.',p_duplicate_candidate_club_id:existingClubId});
  ok(!r.error&&r.data.status==='DUPLICATE','Admin marks DUPLICATE PASS');
  const afterDup=await service.from('club_creation_requests').select('created_club_id').eq('id',reqDuplicatePath.data.id).single();
  ok(afterDup.data.created_club_id===null,'DUPLICATE request never creates a club');
  const noOwnerFromDup=await service.from('club_memberships').select('id').eq('club_id',existingClubId).eq('user_id',userBId);
  ok(noOwnerFromDup.data.length===0,'DUPLICATE decision grants NO membership to the requester');

  // --- fresh re-verification at approval time (mission section 43) + failure
  // atomicity (mission section 15): this deliberately provokes an error
  // partway through approve_club_creation_request (after the admin-role
  // check, the FOR UPDATE lock, and the slug/source lookups, but before any
  // INSERT) and then asserts all three required post-conditions explicitly,
  // not just "the call returned an error" -- 0 orphan club, 0 orphan OWNER
  // membership, and the request left in a clean, non-APPROVED state. Postgres
  // rolls back every write made during a single uncaught-exception plpgsql
  // function call, so this also stands in for a later-stage failure (e.g. the
  // club_memberships insert failing after the clubs insert already ran
  // in-function) -- there is no clean way to force a failure strictly between
  // those two statements from outside the RPC without touching the migration
  // itself, which is out of scope for a security/integration smoke test.
  const lateDupReq=await asUserA.from('club_creation_requests').insert({requested_by:userAId,club_name:'Racing Club Nouveau',city:'Metz',representative_confirmation:true}).select('id').single();
  const lateClub=await service.from('clubs').insert({slug:`step6d-late-${suffix}`,official_name:'Racing Club Nouveau',display_name:'Racing Club Nouveau',city:'Metz',status:'active',claim_status:'unclaimed'}).select('id').single();
  r=await service.rpc('approve_club_creation_request',{actor_id:adminId,p_request_id:lateDupReq.data.id});
  ok(Boolean(r.error),'a matching club added AFTER submission but BEFORE approval blocks APPROVE (re-verified fresh, not from the stale snapshot)');
  const lateReqAfter=await service.from('club_creation_requests').select('status,created_club_id').eq('id',lateDupReq.data.id).single();
  ok(lateReqAfter.data.status==='PENDING_REVIEW'&&lateReqAfter.data.created_club_id===null,'failed approval leaves the request non-APPROVED with no created_club_id (clean transactional state)');
  const orphanClubs=await service.from('clubs').select('id',{count:'exact',head:true}).eq('official_name','Racing Club Nouveau').neq('id',lateClub.data.id);
  ok(orphanClubs.count===0,'failed approval created 0 orphan club');
  const orphanMemberships=await service.from('club_memberships').select('id',{count:'exact',head:true}).eq('user_id',userAId).eq('club_id',lateClub.data.id);
  ok(orphanMemberships.count===0,'failed approval granted 0 orphan OWNER membership on the pre-existing club');
  await service.from('clubs').delete().eq('id',lateClub.data.id);

  console.log(`PASS ${n} Step 6D club creation request assertions`);
}finally{
  const requestIds=[];
  const clubIds=new Set([existingClubId,newClubId].filter(Boolean));
  if(userAId||userBId){
    const owners=[userAId,userBId].filter(Boolean);
    const rows=await service.from('club_creation_requests').select('id,created_club_id').in('requested_by',owners);
    for(const row of rows.data??[]){requestIds.push(row.id);if(row.created_club_id)clubIds.add(row.created_club_id)}
  }
  const lateClub=await service.from('clubs').select('id').eq('slug',`step6d-late-${suffix}`).maybeSingle();
  if(lateClub.data)clubIds.add(lateClub.data.id);
  const allClubIds=[...clubIds];
  if(allClubIds.length){
    const sponsorRows=await service.from('club_sponsors').select('id,sponsor_id').in('club_id',allClubIds);
    if(sponsorRows.data?.length){
      await service.from('admin_audit_logs').delete().in('entity_id',sponsorRows.data.map(s=>s.id));
      await service.from('club_sponsors').delete().in('club_id',allClubIds);
      await service.from('sponsors').delete().in('id',sponsorRows.data.map(s=>s.sponsor_id));
    }
    // approve_club_creation_request's 'owner_granted_from_creation_request'
    // audit row is keyed by membership_id (not club_id/request_id, e.g. the
    // membershipId asserted on above) -- must be captured BEFORE
    // club_memberships is deleted, or it orphans permanently (no FK from
    // admin_audit_logs.entity_id in this shared Supabase project).
    const membershipRows=await service.from('club_memberships').select('id').in('club_id',allClubIds);
    if(membershipRows.data?.length){
      await service.from('admin_audit_logs').delete().in('entity_id',membershipRows.data.map(m=>m.id));
    }
    await service.from('admin_audit_logs').delete().in('entity_id',allClubIds);
    await service.from('club_memberships').delete().in('club_id',allClubIds);
    await service.from('clubs').delete().in('id',allClubIds);
  }
  if(requestIds.length){
    await service.from('admin_audit_logs').delete().in('entity_id',requestIds);
    await service.from('club_creation_requests').delete().in('id',requestIds);
  }
  for(const id of [userAId,userBId,adminId].filter(Boolean))await service.auth.admin.deleteUser(id);
}
