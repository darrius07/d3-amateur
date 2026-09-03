import nextEnv from '@next/env';import {createClient} from '@supabase/supabase-js';import crypto from 'node:crypto';nextEnv.loadEnvConfig(process.cwd());
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
const service=createClient(url,serviceKey,{auth:{persistSession:false}}),anon=createClient(url,key,{auth:{persistSession:false}});
let n=0;const ok=(value,label)=>{if(!value)throw new Error(`FAIL ${label}: got ${JSON.stringify(value)}`);console.log(`ok ${++n} - ${label}`)};
const suffix=crypto.randomUUID();
// A tiny valid PNG (1x1, transparent) -- real magic bytes, enough to pass
// both the bucket's MIME allow-list and our own validateLogo() sniffing.
const PNG_1PX=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
let ownerAId,ownerBId,clubAId,clubBId,asOwnerA,asOwnerB,sponsorAId,sponsorBId;
try{
  const emailA=`step6c-${suffix}-a@example.invalid`,emailB=`step6c-${suffix}-b@example.invalid`,password=`D3!${suffix}`;
  const createdA=await service.auth.admin.createUser({email:emailA,password,email_confirm:true});if(createdA.error)throw createdA.error;ownerAId=createdA.data.user.id;
  const createdB=await service.auth.admin.createUser({email:emailB,password,email_confirm:true});if(createdB.error)throw createdB.error;ownerBId=createdB.data.user.id;
  const loginA=await createClient(url,key,{auth:{persistSession:false}}).auth.signInWithPassword({email:emailA,password});if(loginA.error)throw loginA.error;
  asOwnerA=createClient(url,key,{global:{headers:{Authorization:`Bearer ${loginA.data.session.access_token}`}},auth:{persistSession:false}});
  const loginB=await createClient(url,key,{auth:{persistSession:false}}).auth.signInWithPassword({email:emailB,password});if(loginB.error)throw loginB.error;
  asOwnerB=createClient(url,key,{global:{headers:{Authorization:`Bearer ${loginB.data.session.access_token}`}},auth:{persistSession:false}});

  const clubA=await service.from('clubs').insert({slug:`step6c-a-${suffix}`,official_name:'Officielle A',display_name:'Club A',status:'active',claim_status:'claimed'}).select('id').single();if(clubA.error)throw clubA.error;clubAId=clubA.data.id;
  const clubB=await service.from('clubs').insert({slug:`step6c-b-${suffix}`,official_name:'Officielle B',display_name:'Club B',status:'active',claim_status:'claimed'}).select('id').single();if(clubB.error)throw clubB.error;clubBId=clubB.data.id;
  await service.from('club_memberships').insert([{club_id:clubAId,user_id:ownerAId,role:'OWNER',active:true},{club_id:clubBId,user_id:ownerBId,role:'OWNER',active:true}]).throwOnError();

  // --- OWNER A: own club, PASS ---
  let r=await service.rpc('add_club_sponsor',{actor_id:ownerAId,target_club_id:clubAId,p_name:'Boulangerie Martin',p_website_url:'https://boulangerie-martin.example.com',p_tier:'MAIN',p_custom_tier_label:null,p_short_message:'Partenaire historique du club depuis 2019.',p_public_visible:true});
  ok(!r.error,`OWNER A creates a MAIN sponsor on Club A (${r.error?.message})`);
  sponsorAId=r.data;
  r=await service.rpc('add_club_sponsor',{actor_id:ownerAId,target_club_id:clubAId,p_name:'Garage Dupont',p_website_url:null,p_tier:'SUPPORTER',p_custom_tier_label:null,p_short_message:null,p_public_visible:false});
  ok(!r.error,'OWNER A creates a private sponsor');
  const privateSponsorId=r.data;
  r=await service.rpc('add_club_sponsor',{actor_id:ownerBId,target_club_id:clubBId,p_name:'Club B Sponsor',p_website_url:null,p_tier:'MAIN',p_custom_tier_label:null,p_short_message:null,p_public_visible:true});
  ok(!r.error,'OWNER B creates their own sponsor on Club B (control)');
  sponsorBId=r.data;

  // --- Validation ---
  r=await service.rpc('add_club_sponsor',{actor_id:ownerAId,target_club_id:clubAId,p_name:'X',p_website_url:null,p_tier:'OTHER',p_custom_tier_label:null,p_short_message:null,p_public_visible:false});
  ok(Boolean(r.error),'tier=OTHER without custom_tier_label rejected');
  r=await service.rpc('add_club_sponsor',{actor_id:ownerAId,target_club_id:clubAId,p_name:'Fournisseur X',p_website_url:null,p_tier:'OTHER',p_custom_tier_label:'Fournisseur officiel',p_short_message:null,p_public_visible:false});
  ok(!r.error,'tier=OTHER with a custom_tier_label accepted');
  r=await service.rpc('add_club_sponsor',{actor_id:ownerAId,target_club_id:clubAId,p_name:'Test',p_website_url:null,p_tier:'PARTNER',p_custom_tier_label:'Should be nulled',p_short_message:null,p_public_visible:false});
  ok(!r.error,'a non-OTHER tier with a stray custom_tier_label is still accepted (RPC nulls it)');
  const nulledRow=await service.from('club_sponsors').select('custom_tier_label').eq('id',r.data).single();
  ok(nulledRow.data.custom_tier_label===null,'custom_tier_label silently nulled for a non-OTHER tier');
  r=await service.rpc('add_club_sponsor',{actor_id:ownerAId,target_club_id:clubAId,p_name:'   ',p_website_url:null,p_tier:'PARTNER',p_custom_tier_label:null,p_short_message:null,p_public_visible:false});
  ok(Boolean(r.error),'whitespace-only name rejected');
  r=await service.rpc('add_club_sponsor',{actor_id:ownerAId,target_club_id:clubAId,p_name:'x'.repeat(121),p_website_url:null,p_tier:'PARTNER',p_custom_tier_label:null,p_short_message:null,p_public_visible:false});
  ok(Boolean(r.error),'oversized name (121 chars) rejected');
  r=await service.rpc('add_club_sponsor',{actor_id:ownerAId,target_club_id:clubAId,p_name:'Bio Test',p_website_url:null,p_tier:'PARTNER',p_custom_tier_label:null,p_short_message:'x'.repeat(161),p_public_visible:false});
  ok(Boolean(r.error),'oversized short_message (161 chars) rejected');
  r=await service.rpc('add_club_sponsor',{actor_id:ownerAId,target_club_id:clubAId,p_name:'HTTP Test',p_website_url:'http://insecure.example.com',p_tier:'PARTNER',p_custom_tier_label:null,p_short_message:null,p_public_visible:false});
  ok(Boolean(r.error),'http:// website rejected (https-only)');
  r=await service.rpc('add_club_sponsor',{actor_id:ownerAId,target_club_id:clubAId,p_name:'Protocol Relative',p_website_url:'//example.com',p_tier:'PARTNER',p_custom_tier_label:null,p_short_message:null,p_public_visible:false});
  ok(Boolean(r.error),'protocol-relative website rejected');
  r=await service.rpc('add_club_sponsor',{actor_id:ownerAId,target_club_id:clubAId,p_name:'JS Test',p_website_url:'javascript:alert(1)',p_tier:'PARTNER',p_custom_tier_label:null,p_short_message:null,p_public_visible:false});
  ok(Boolean(r.error),'javascript: website rejected');

  // --- Cross-club attacks ---
  r=await service.rpc('add_club_sponsor',{actor_id:ownerAId,target_club_id:clubBId,p_name:'Intruder',p_website_url:null,p_tier:'MAIN',p_custom_tier_label:null,p_short_message:null,p_public_visible:true});
  ok(Boolean(r.error),'OWNER A -> create sponsor for Club B MUST FAIL');
  r=await service.rpc('update_club_sponsor',{actor_id:ownerAId,p_club_sponsor_id:sponsorBId,p_name:'Hacked',p_website_url:null,p_tier:'MAIN',p_custom_tier_label:null,p_short_message:null,p_public_visible:true,p_sort_order:null});
  ok(Boolean(r.error),'OWNER A -> edit Club B sponsor MUST FAIL');
  r=await service.rpc('deactivate_club_sponsor',{actor_id:ownerAId,p_club_sponsor_id:sponsorBId});
  ok(Boolean(r.error),'OWNER A -> deactivate Club B sponsor MUST FAIL');
  r=await service.rpc('add_club_sponsor',{actor_id:crypto.randomUUID(),target_club_id:clubAId,p_name:'Ghost',p_website_url:null,p_tier:'MAIN',p_custom_tier_label:null,p_short_message:null,p_public_visible:true});
  ok(Boolean(r.error),'a random non-member actor_id -> create MUST FAIL');
  r=await anon.rpc('add_club_sponsor',{actor_id:ownerAId,target_club_id:clubAId,p_name:'Anon',p_website_url:null,p_tier:'MAIN',p_custom_tier_label:null,p_short_message:null,p_public_visible:true});
  ok(Boolean(r.error),'anon -> add_club_sponsor MUST FAIL');
  r=await anon.from('club_sponsors').insert({club_id:clubAId,sponsor_id:sponsorAId,tier:'MAIN'});
  ok(Boolean(r.error),'anon cannot INSERT club_sponsors directly (no grant)');
  r=await asOwnerA.rpc('add_club_sponsor',{actor_id:ownerAId,target_club_id:clubAId,p_name:'Direct RPC',p_website_url:null,p_tier:'MAIN',p_custom_tier_label:null,p_short_message:null,p_public_visible:true});
  ok(Boolean(r.error),'authenticated OWNER cannot call add_club_sponsor directly (service_role only)');

  // --- Public read ---
  let pub=await anon.from('sponsors_public').select('*').eq('club_id',clubAId);
  ok(pub.data.length===1,`anon public sponsors read: sees exactly 1 (MAIN, public) -- got ${pub.data?.length}`);
  ok(pub.data[0].name==='Boulangerie Martin','the correct sponsor is visible');
  ok(!pub.data.some(s=>s.name==='Garage Dupont'),'the private sponsor is invisible to anon');
  ok(!Object.prototype.hasOwnProperty.call(pub.data[0],'created_by'),'sponsors_public never exposes created_by');
  ok(!Object.prototype.hasOwnProperty.call(pub.data[0],'source_id'),'sponsors_public never exposes source_id');

  let anonBase=await anon.from('club_sponsors').select('created_by').eq('id',sponsorAId).maybeSingle();
  ok(Boolean(anonBase.error),'anon cannot SELECT club_sponsors (base table) at all');
  let anonSponsorsBase=await anon.from('sponsors').select('name').eq('id',sponsorAId).maybeSingle();
  ok(Boolean(anonSponsorsBase.error),'anon cannot SELECT sponsors (base table) at all -- a not-yet-public sponsor name never leaks');
  const svcCheck=await service.from('club_sponsors').select('created_by').eq('id',sponsorAId).single();
  ok(svcCheck.data.created_by===ownerAId,'service_role/server still resolves created_by for internal/audit use');

  // --- inactive invisible ---
  r=await service.rpc('deactivate_club_sponsor',{actor_id:ownerAId,p_club_sponsor_id:sponsorAId});
  ok(!r.error,'OWNER A deactivates their own MAIN sponsor');
  pub=await anon.from('sponsors_public').select('name').eq('club_id',clubAId);
  ok(!pub.data.some(s=>s.name==='Boulangerie Martin'),'a deactivated sponsor is invisible to anon even though it was public_visible');

  // --- audit granularity ---
  const audits=await service.from('admin_audit_logs').select('action').eq('entity_id',sponsorAId).eq('entity_type','club_sponsor');
  const actions=new Set(audits.data.map(a=>a.action));
  ok(actions.has('sponsor_created'),'sponsor_created audited');
  ok(actions.has('sponsor_deactivated'),'sponsor_deactivated audited');

  // --- STORAGE SECURITY (mission section 34) ---
  const pathA=`sponsors/${clubAId}/${privateSponsorId}/${crypto.randomUUID()}.png`;
  const pathB=`sponsors/${clubBId}/${sponsorBId}/${crypto.randomUUID()}.png`;

  let up=await anon.storage.from('sponsor-assets').upload(pathA,PNG_1PX,{contentType:'image/png'});
  ok(Boolean(up.error),'anon upload denied');
  up=await asOwnerB.storage.from('sponsor-assets').upload(pathA,PNG_1PX,{contentType:'image/png'});
  ok(Boolean(up.error),'non-owner (OWNER B) upload to Club A path denied');
  up=await asOwnerA.storage.from('sponsor-assets').upload(pathA,PNG_1PX,{contentType:'image/png'});
  ok(!up.error,`OWNER A -> own sponsor (Club A path) upload PASS (${up.error?.message})`);
  up=await asOwnerA.storage.from('sponsor-assets').upload(pathA,PNG_1PX,{contentType:'image/png',upsert:true});
  ok(!up.error,'OWNER A -> replace (upsert) own logo PASS');
  let del=await asOwnerB.storage.from('sponsor-assets').remove([pathA]);
  ok(Boolean(del.data?.length===0||del.error),'OWNER B -> delete Club A logo denied (no rows removed / error)');
  del=await asOwnerA.storage.from('sponsor-assets').remove([pathA]);
  ok(!del.error&&del.data?.length===1,'OWNER A -> delete own logo PASS');

  // control: OWNER B CAN manage their own Club B path
  up=await asOwnerB.storage.from('sponsor-assets').upload(pathB,PNG_1PX,{contentType:'image/png'});
  ok(!up.error,'OWNER B -> own sponsor (Club B path) upload PASS (control)');
  await asOwnerB.storage.from('sponsor-assets').remove([pathB]);

  console.log(`PASS ${n} Step 6C club sponsors assertions`);
}finally{
  const clubIds=[clubAId,clubBId].filter(Boolean);
  if(clubIds.length){
    await service.from('admin_audit_logs').delete().in('entity_id',clubIds);
    const sponsorRows=await service.from('club_sponsors').select('id,sponsor_id').in('club_id',clubIds);
    if(sponsorRows.data?.length){
      await service.from('admin_audit_logs').delete().in('entity_id',sponsorRows.data.map(s=>s.id));
      await service.from('club_sponsors').delete().in('club_id',clubIds);
      await service.from('sponsors').delete().in('id',sponsorRows.data.map(s=>s.sponsor_id));
    }
    await service.from('club_memberships').delete().in('club_id',clubIds);
    await service.from('clubs').delete().in('id',clubIds);
  }
  for(const id of [ownerAId,ownerBId].filter(Boolean))await service.auth.admin.deleteUser(id);
}
