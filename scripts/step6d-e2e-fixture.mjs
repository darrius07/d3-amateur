import nextEnv from '@next/env';import {createClient} from '@supabase/supabase-js';import crypto from 'node:crypto';nextEnv.loadEnvConfig(process.cwd());
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;const service=createClient(url,key,{auth:{persistSession:false}});const mode=process.argv[2];

if(mode==='setup'){
  const suffix=crypto.randomUUID().slice(0,8);const password=`D3!${crypto.randomUUID()}aA1`;

  const requesterEmail=`step6d-e2e-${suffix}-requester@example.invalid`;
  const requester=await service.auth.admin.createUser({email:requesterEmail,password,email_confirm:true,user_metadata:{display_name:'E2E Requester 6D'}});if(requester.error)throw requester.error;

  const otherEmail=`step6d-e2e-${suffix}-other@example.invalid`;
  const other=await service.auth.admin.createUser({email:otherEmail,password,email_confirm:true,user_metadata:{display_name:'E2E Other 6D'}});if(other.error)throw other.error;

  const adminEmail=`step6d-e2e-${suffix}-admin@example.invalid`;
  const admin=await service.auth.admin.createUser({email:adminEmail,password,email_confirm:true,user_metadata:{display_name:'E2E Admin 6D'}});if(admin.error)throw admin.error;
  await service.from('user_profiles').update({d3_admin_role:'superadmin'}).eq('id',admin.data.user.id).throwOnError();

  // A pre-existing, unrelated D3 club used for the Duplicate Golden Path:
  // the requester will submit a request with the SAME name + city, which
  // the trigger must flag as LIKELY_DUPLICATE.
  const existingClub=await service.from('clubs').insert({
    slug:`d3-test-club-step6d-e2e-existing-${suffix}`,
    official_name:`FC Test Existant ${suffix}`,display_name:`FC Test Existant ${suffix}`,
    city:'Nantes',postal_code:'44000',status:'active',claim_status:'unclaimed',
  }).select('id,slug,display_name,city').single();
  if(existingClub.error)throw existingClub.error;

  console.log(JSON.stringify({
    suffix,password,
    requesterEmail,requesterId:requester.data.user.id,
    otherEmail,otherId:other.data.user.id,
    adminEmail,adminId:admin.data.user.id,
    existingClub:existingClub.data,
  }));
}else if(mode==='cleanup'){
  const suffix=process.argv[3];if(!suffix)throw new Error('suffix required');
  const listed=await service.auth.admin.listUsers({perPage:1000});
  const users=listed.data.users.filter(u=>u.email?.includes(`step6d-e2e-${suffix}-`));
  const userIds=users.map(u=>u.id);

  const requestRows=userIds.length?(await service.from('club_creation_requests').select('id,created_club_id').in('requested_by',userIds)).data??[]:[];
  const requestIds=requestRows.map(r=>r.id);
  const createdClubIds=requestRows.map(r=>r.created_club_id).filter(Boolean);

  const existingClubs=await service.from('clubs').select('id').ilike('slug',`d3-test-club-step6d-e2e-existing-%${suffix}`);
  const existingClubIds=(existingClubs.data??[]).map(c=>c.id);

  const clubIds=[...new Set([...createdClubIds,...existingClubIds])];
  if(clubIds.length){
    const sponsorRows=await service.from('club_sponsors').select('id,sponsor_id').in('club_id',clubIds);
    if(sponsorRows.data?.length){
      await service.from('admin_audit_logs').delete().in('entity_id',sponsorRows.data.map(s=>s.id));
      await service.from('club_sponsors').delete().in('club_id',clubIds);
      await service.from('sponsors').delete().in('id',sponsorRows.data.map(s=>s.sponsor_id));
    }
    // approve_club_creation_request's 'owner_granted_from_creation_request'
    // audit row is keyed by membership_id, not club_id/request_id -- must be
    // captured BEFORE club_memberships is deleted, or it orphans permanently
    // (this shared Supabase project has no FK from admin_audit_logs.entity_id).
    const membershipRows=await service.from('club_memberships').select('id').in('club_id',clubIds);
    if(membershipRows.data?.length){
      await service.from('admin_audit_logs').delete().in('entity_id',membershipRows.data.map(m=>m.id));
    }
    await service.from('club_profiles').delete().in('club_id',clubIds);
    await service.from('admin_audit_logs').delete().in('entity_id',clubIds);
    await service.from('club_memberships').delete().in('club_id',clubIds);
    await service.from('clubs').delete().in('id',clubIds);
  }
  if(requestIds.length){
    await service.from('admin_audit_logs').delete().in('entity_id',requestIds);
    await service.from('club_creation_requests').delete().in('id',requestIds);
  }
  for(const u of users)await service.auth.admin.deleteUser(u.id);
  console.log(JSON.stringify({cleanedUsers:users.length,clubs:clubIds.length,requests:requestIds.length}));
}else throw new Error('Use setup or cleanup <suffix>');
