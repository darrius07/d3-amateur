import nextEnv from '@next/env';import {createClient} from '@supabase/supabase-js';import crypto from 'node:crypto';nextEnv.loadEnvConfig(process.cwd());
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
const service=createClient(url,serviceKey,{auth:{persistSession:false}}),anon=createClient(url,key,{auth:{persistSession:false}});
let n=0;const ok=(value,label)=>{if(!value)throw new Error(`FAIL ${label}: got ${JSON.stringify(value)}`);console.log(`ok ${++n} - ${label}`)};
const suffix=crypto.randomUUID();
let ownerAId,ownerBId,clubAId,clubBId;
const validArgs=(clubId,actorId)=>({
  actor_id:actorId,target_club_id:clubId,
  p_display_name:'Smoke FC Officiel',p_short_description:'Le club qui monte',p_long_description:'Une longue histoire du club.',
  p_founded_year:1962,p_primary_color:'#0057B8',p_secondary_color:'#FFFFFF',
  p_website_url:'https://smokefc.example.com',p_facebook_url:null,p_instagram_url:'https://instagram.com/smokefc',p_x_url:null,p_tiktok_url:null,p_youtube_url:null,
  p_public_email:'contact@smokefc.example.com',p_public_phone:'02 40 00 00 00',
  p_venue_name:'Stade Municipal',p_venue_address:'1 rue du Stade',p_venue_postal_code:'44000',p_venue_city:'Nantes',
});
try{
  const emailA=`step6a-${suffix}-a@example.invalid`,emailB=`step6a-${suffix}-b@example.invalid`,password=`D3!${suffix}`;
  const createdA=await service.auth.admin.createUser({email:emailA,password,email_confirm:true});if(createdA.error)throw createdA.error;ownerAId=createdA.data.user.id;
  const createdB=await service.auth.admin.createUser({email:emailB,password,email_confirm:true});if(createdB.error)throw createdB.error;ownerBId=createdB.data.user.id;
  const authClient=createClient(url,key,{auth:{persistSession:false}});
  const loginA=await authClient.auth.signInWithPassword({email:emailA,password});if(loginA.error)throw loginA.error;
  const asOwnerA=createClient(url,key,{global:{headers:{Authorization:`Bearer ${loginA.data.session.access_token}`}},auth:{persistSession:false}});

  const clubA=await service.from('clubs').insert({slug:`step6a-a-${suffix}`,official_name:'ASSOCIATION SPORTIVE OFFICIELLE A',display_name:'Club A',status:'active',claim_status:'claimed'}).select('id').single();if(clubA.error)throw clubA.error;clubAId=clubA.data.id;
  const clubB=await service.from('clubs').insert({slug:`step6a-b-${suffix}`,official_name:'ASSOCIATION SPORTIVE OFFICIELLE B',display_name:'Club B',status:'active',claim_status:'claimed'}).select('id').single();if(clubB.error)throw clubB.error;clubBId=clubB.data.id;
  await service.from('club_memberships').insert([{club_id:clubAId,user_id:ownerAId,role:'OWNER',active:true},{club_id:clubBId,user_id:ownerBId,role:'OWNER',active:true}]).throwOnError();

  // --- OWNER A -> own profile: PASS ---
  let r=await service.rpc('update_club_profile',validArgs(clubAId,ownerAId));
  ok(!r.error,`OWNER A can update Club A's own profile (${r.error?.message})`);

  const clubRow=await service.from('clubs').select('display_name,official_name').eq('id',clubAId).single();
  ok(clubRow.data.display_name==='Smoke FC Officiel','display_name updated by the RPC');
  ok(clubRow.data.official_name==='ASSOCIATION SPORTIVE OFFICIELLE A','canonical official_name untouched by update_club_profile (no write path exists for it)');

  const audits=await service.from('admin_audit_logs').select('action').eq('entity_id',clubAId).eq('entity_type','club');
  ok(new Set(audits.data.map(a=>a.action)).size===6,'exactly 6 granular audit groups fired on first full save (not one row per field)');

  // --- Attacks (mission section 33) ---
  r=await service.rpc('update_club_profile',validArgs(clubBId,ownerAId));
  ok(Boolean(r.error),'OWNER A -> update Club B profile MUST FAIL');

  r=await service.rpc('update_club_profile',validArgs(clubAId,ownerBId));
  ok(Boolean(r.error),'OWNER B (non-owner of Club A) -> update Club A MUST FAIL');

  r=await asOwnerA.rpc('update_club_profile',validArgs(clubAId,ownerAId));
  ok(Boolean(r.error),'authenticated OWNER cannot call update_club_profile directly (service_role only -- server action resolves actor_id, RPC itself is not exposed to the client)');

  r=await anon.rpc('update_club_profile',validArgs(clubAId,ownerAId));
  ok(Boolean(r.error),'anon -> update_club_profile MUST FAIL');

  let ranonUpdate=await anon.from('club_profiles').update({primary_color:'#000000'}).eq('club_id',clubAId);
  ok(Boolean(ranonUpdate.error),'anon cannot UPDATE club_profiles directly (no grant)');
  let rauthUpdate=await asOwnerA.from('club_profiles').update({primary_color:'#000000'}).eq('club_id',clubAId);
  ok(Boolean(rauthUpdate.error),'authenticated OWNER cannot UPDATE club_profiles directly either -- update_club_profile is the only write path');

  // --- Public read (anon) -- via club_profiles_public, the only surface anon/authenticated can reach ---
  let ranon=await anon.from('club_profiles_public').select('short_description,primary_color,public_email').eq('club_id',clubAId).single();
  ok(ranon.data?.short_description==='Le club qui monte','anon can publicly read club_profiles_public');
  ok(ranon.data?.public_email==='contact@smokefc.example.com','anon can read the explicitly-published public_email (it exists only because OWNER typed it)');

  // --- GAP 2 (closure): updated_by must never reach anon/authenticated ---
  let ranonBase=await anon.from('club_profiles').select('updated_by').eq('club_id',clubAId).maybeSingle();
  ok(Boolean(ranonBase.error),'anon cannot SELECT club_profiles (the base table) at all -- updated_by is unreachable, not merely unrendered');
  let rauthBase=await asOwnerA.from('club_profiles').select('updated_by').eq('club_id',clubAId).maybeSingle();
  ok(Boolean(rauthBase.error),'authenticated (even the OWNER) cannot SELECT club_profiles directly either -- must go through club_profiles_public');
  let ranonViewStar=await anon.from('club_profiles_public').select('*').eq('club_id',clubAId).single();
  ok(!Object.prototype.hasOwnProperty.call(ranonViewStar.data??{},'updated_by'),'club_profiles_public never exposes updated_by, even via select(*)');
  const serviceStillSees=await service.from('club_profiles').select('updated_by').eq('club_id',clubAId).single();
  ok(typeof serviceStillSees.data?.updated_by==='string','service_role (admin/server) still has full access to updated_by -- only anon/authenticated are blocked');

  // --- Public/private separation (mission section 37) ---
  const columns=Object.keys((await service.from('club_profiles').select('*').eq('club_id',clubAId).single()).data);
  const forbidden=['auth_email','claim_note','admin_note','evidence','password'];
  ok(!columns.some(c=>forbidden.some(f=>c.toLowerCase().includes(f))),'no private/internal column exists on club_profiles by construction');
  ok(ranon.data.public_email!==emailA,"the published public_email is never silently the OWNER's own Auth email");

  // --- GAP 1 (closure): https:// only, no http:// ---
  r=await service.rpc('update_club_profile',{...validArgs(clubAId,ownerAId),p_website_url:'http://smokefc.example.com'});
  ok(Boolean(r.error),'http:// rejected (https-only per mission requirement)');
  r=await service.rpc('update_club_profile',{...validArgs(clubAId,ownerAId),p_instagram_url:'//instagram.com/smokefc'});
  ok(Boolean(r.error),'protocol-relative "//host" URL rejected');
  r=await service.rpc('update_club_profile',{...validArgs(clubAId,ownerAId),p_website_url:'HTTPS://SmokeFC.example.com'});
  ok(!r.error,'uppercase HTTPS scheme still accepted (case-insensitive)');

  // --- Validations (mission section 34) ---
  r=await service.rpc('update_club_profile',{...validArgs(clubAId,ownerAId),p_primary_color:'blue'});
  ok(Boolean(r.error),'invalid HEX color rejected');
  r=await service.rpc('update_club_profile',{...validArgs(clubAId,ownerAId),p_website_url:'javascript:alert(1)'});
  ok(Boolean(r.error),'javascript: URL rejected');
  r=await service.rpc('update_club_profile',{...validArgs(clubAId,ownerAId),p_instagram_url:'ftp://x.com'});
  ok(Boolean(r.error),'non-http(s) URL scheme rejected');
  r=await service.rpc('update_club_profile',{...validArgs(clubAId,ownerAId),p_short_description:'x'.repeat(201)});
  ok(Boolean(r.error),'oversized short_description (201 chars) rejected');
  r=await service.rpc('update_club_profile',{...validArgs(clubAId,ownerAId),p_long_description:'x'.repeat(2001)});
  ok(Boolean(r.error),'oversized long_description (2001 chars) rejected');
  r=await service.rpc('update_club_profile',{...validArgs(clubAId,ownerAId),p_public_email:'not-an-email'});
  ok(Boolean(r.error),'malformed email rejected');
  r=await service.rpc('update_club_profile',{...validArgs(clubAId,ownerAId),p_founded_year:1500});
  ok(Boolean(r.error),'founded_year before 1850 rejected');
  r=await service.rpc('update_club_profile',{...validArgs(clubAId,ownerAId),p_display_name:''});
  ok(Boolean(r.error),'empty display_name rejected (required field)');

  // empty strings -> NULL, whitespace normalization
  r=await service.rpc('update_club_profile',{...validArgs(clubAId,ownerAId),p_website_url:'   ',p_facebook_url:'',p_public_phone:'   '});
  ok(!r.error,'blank/whitespace-only optional fields accepted (normalized, not rejected)');
  const normalized=await service.from('club_profiles').select('website_url,facebook_url,public_phone').eq('club_id',clubAId).single();
  ok(normalized.data.website_url===null&&normalized.data.facebook_url===null&&normalized.data.public_phone===null,'whitespace-only optional fields normalize to NULL, never stored as blank strings');

  console.log(`PASS ${n} Step 6A club profile assertions`);
}finally{
  const clubIds=[clubAId,clubBId].filter(Boolean);
  if(clubIds.length){
    await service.from('admin_audit_logs').delete().in('entity_id',clubIds);
    await service.from('club_profiles').delete().in('club_id',clubIds);
    await service.from('club_memberships').delete().in('club_id',clubIds);
    await service.from('clubs').delete().in('id',clubIds);
  }
  for(const id of [ownerAId,ownerBId].filter(Boolean))await service.auth.admin.deleteUser(id);
}
