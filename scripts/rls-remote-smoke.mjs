import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

nextEnv.loadEnvConfig(process.cwd());
const url=process.env.SUPABASE_URL; const anonKey=process.env.SUPABASE_ANON_KEY; const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!anonKey||!serviceKey) throw new Error('Missing local Supabase test environment');
const service=createClient(url,serviceKey,{auth:{persistSession:false}}); const anon=createClient(url,anonKey,{auth:{persistSession:false}});
const suffix=crypto.randomUUID(); const password=`D3!${crypto.randomBytes(18).toString('hex')}`;
const ids=[]; const rows=[]; let passed=0;
const ok=(value,label)=>{if(!value) throw new Error(`FAIL: ${label}`); passed++; console.log(`ok ${passed} - ${label}`)};
const tableNames=['seasons','clubs','teams','competitions','venues'];
try {
  for(const kind of ['normal','other','admin']) { const {data,error}=await service.auth.admin.createUser({email:`rls-${kind}-${suffix}@example.invalid`,password,email_confirm:true}); if(error) throw error; ids.push(data.user.id); }
  await service.from('user_profiles').update({d3_admin_role:'superadmin'}).eq('id',ids[2]).throwOnError();
  const season=crypto.randomUUID(),club=crypto.randomUUID(),team=crypto.randomUUID(),competition=crypto.randomUUID(),venue=crypto.randomUUID();
  rows.push(['seasons',season],['clubs',club],['teams',team],['competitions',competition],['venues',venue]);
  await service.from('seasons').insert({id:season,label:`RLS ${suffix}`,start_date:'2026-01-01',end_date:'2026-12-31'}).throwOnError();
  await service.from('clubs').insert({id:club,slug:`rls-${suffix}`,official_name:'RLS Club',display_name:'RLS Club'}).throwOnError();
  await service.from('teams').insert({id:team,club_id:club,display_name:'RLS Team',gender:'mixed',category:'senior',football_format:'11'}).throwOnError();
  await service.from('competitions').insert({id:competition,name:'RLS Competition',short_name:'RLS',competition_type:'league',gender:'mixed',category:'senior'}).throwOnError();
  await service.from('venues').insert({id:venue,name:'RLS Venue'}).throwOnError();
  for(const table of tableNames){const {error}=await anon.from(table).select('*').limit(1);ok(!error,`anon SELECT ${table}`)}
  for(const op of ['insert','update','delete']) { let q=op==='insert'?anon.from('clubs').insert({slug:`anon-${suffix}`,official_name:'X',display_name:'X'}):op==='update'?anon.from('clubs').update({display_name:'X'}).eq('id',club):anon.from('clubs').delete().eq('id',club); const {error}=await q; ok(Boolean(error),`anon ${op.toUpperCase()} denied`); }
  const signIn=async(i)=>{const email=`rls-${i===0?'normal':i===1?'other':'admin'}-${suffix}@example.invalid`;const {data,error}=await anon.auth.signInWithPassword({email,password});if(error)throw error;return createClient(url,anonKey,{global:{headers:{Authorization:`Bearer ${data.session.access_token}`}},auth:{persistSession:false}})};
  const normal=await signIn(0);
  for(const table of tableNames){const {error}=await normal.from(table).select('*').limit(1);ok(!error,`user SELECT ${table}`)}
  let res=await normal.from('user_profiles').select('id');ok(!res.error&&res.data.length===1&&res.data[0].id===ids[0],'user reads own profile only');
  res=await normal.from('user_profiles').update({display_name:'Safe name'}).eq('id',ids[0]).select();ok(!res.error&&res.data.length===1,'user updates display_name');
  res=await normal.from('user_profiles').update({d3_admin_role:'superadmin'}).eq('id',ids[0]);ok(Boolean(res.error),'self-promotion denied');
  res=await normal.rpc('is_d3_admin');ok(!res.error&&res.data===false,'is_d3_admin remains false');
  for(const [table,action] of [['clubs','insert'],['teams','update'],['competitions','delete'],['venues','update'],['external_identities','insert'],['data_sources','delete']]) { let q;if(action==='insert'&&table==='clubs')q=normal.from(table).insert({slug:`user-${suffix}`,official_name:'X',display_name:'X'});else if(action==='insert')q=normal.from(table).insert({entity_type:'club',entity_id:club,provider:'USER',external_id:suffix});else if(action==='delete')q=normal.from(table).delete().eq(table==='competitions'?'id':'code',table==='competitions'?competition:'RNA').select();else q=normal.from(table).update({[table==='teams'?'display_name':'name']:'User write'}).eq('id',table==='teams'?team:venue).select();const {data,error}=await q;ok(Boolean(error)||(Array.isArray(data)&&data.length===0),`user ${action.toUpperCase()} ${table} denied`)}
  const admin=await signIn(2);res=await admin.rpc('is_d3_admin');ok(!res.error&&res.data===true,'real admin recognized');
  res=await admin.from('clubs').insert({slug:`admin-${suffix}`,official_name:'Admin',display_name:'Admin'}).select();ok(!res.error&&res.data.length===1,'admin canonical INSERT allowed');if(res.data?.[0])rows.push(['clubs',res.data[0].id]);
  res=await admin.from('teams').update({display_name:'Admin Team'}).eq('id',team).select();ok(!res.error&&res.data.length===1,'admin canonical UPDATE allowed');
  res=await admin.from('venues').delete().eq('id',venue).select();ok(!res.error&&res.data.length===1,'admin canonical DELETE allowed');
  res=await service.from('user_profiles').select('d3_admin_role').eq('id',ids[0]).single();ok(!res.error&&res.data.d3_admin_role===null,'normal privilege remains null');
  console.log(`PASS ${passed} behavioral assertions on ${process.env.SUPABASE_PROJECT_REF}`);
} finally { for(const [table,id] of rows.reverse()) await service.from(table).delete().eq('id',id); for(const id of ids) await service.auth.admin.deleteUser(id); }
