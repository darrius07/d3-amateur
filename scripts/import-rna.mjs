import nextEnv from '@next/env';
import {createClient} from '@supabase/supabase-js';
import {parse} from 'csv-parse';
import iconv from 'iconv-lite';
import {createReadStream} from 'node:fs';
import {normalizeClubName,stableClubSlug,isFootballCandidate,matchClub} from '../lib/clubs/registry.ts';
nextEnv.loadEnvConfig(process.cwd());
const files=process.argv.slice(2);if(!files.length)throw new Error('Usage: npm run import:rna -- <csv...>');
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const stats={staged:0,candidates:0,created:0,review:0,rejected:0,duplicates:0};
const {data:existing}=await db.from('clubs').select('id,display_name,city,postal_code');
const clubs=(existing??[]).map(c=>({id:c.id,name:c.display_name,city:c.city,postalCode:c.postal_code}));
for(const file of files){
  let accepted=0;const encoding=file.includes('rna-football-sample')?'utf8':'win1252';
  const parser=createReadStream(file).pipe(iconv.decodeStream(encoding)).pipe(parse({columns:true,delimiter:';',relax_quotes:true,skip_empty_lines:true,bom:true}));
  for await(const row of parser){
    if(accepted>=1000)break;const purpose=row.objet??'';if(!/foot(ball|\s*ball)|futsal/i.test(`${row.titre} ${purpose}`))continue;accepted++;const externalId=row.id??row[Object.keys(row)[0]];
    const staged={external_rna_id:externalId,raw_name:row.titre,normalized_name:normalizeClubName(row.titre),acronym:row.titre_court&&row.titre_court!==row.titre?row.titre_court:null,association_purpose:purpose,address_line:[row.adrs_numvoie,row.adrs_typevoie,row.adrs_libvoie].filter(Boolean).join(' '),postal_code:row.adrs_codepostal||null,city:row.adrs_libcommune||null,website:row.siteweb||null,raw_payload:row,source_updated_at:row.maj_time?new Date(row.maj_time.replace(' ','T')+'Z').toISOString():null,imported_at:new Date().toISOString()};
    const {data:stage,error:stageError}=await db.from('staging_rna_associations').upsert(staged,{onConflict:'external_rna_id'}).select('id').single();if(stageError)throw stageError;stats.staged++;
    if(!isFootballCandidate(row.titre,purpose)){await db.from('staging_rna_associations').update({processing_status:'rejected',match_decision:'rejected',match_reason:'Pas un club de football exploitable'}).eq('id',stage.id).throwOnError();stats.rejected++;continue}
    stats.candidates++;const {data:identity}=await db.from('external_identities').select('entity_id').eq('provider','RNA').eq('entity_type','club').eq('external_id',externalId).maybeSingle();
    if(identity){await db.from('staging_rna_associations').update({processing_status:'matched',match_decision:'auto_match',matched_club_id:identity.entity_id,match_score:1,match_reason:'Identité RNA déjà importée'}).eq('id',stage.id).throwOnError();stats.duplicates++;continue}
    const result=matchClub({name:row.titre,acronym:row.titre_court,city:row.adrs_libcommune,postalCode:row.adrs_codepostal,website:row.siteweb},clubs);
    if(result.decision==='auto_match'){await db.from('external_identities').insert({entity_type:'club',entity_id:result.clubId,provider:'RNA',external_id:externalId,metadata:{source:'Ministère de l’Intérieur RNA'}}).throwOnError();await db.from('staging_rna_associations').update({processing_status:'matched',match_decision:'auto_match',matched_club_id:result.clubId,match_score:result.score,match_reason:result.reason}).eq('id',stage.id).throwOnError();stats.duplicates++;continue}
    if(result.decision==='needs_review'){await db.from('staging_rna_associations').update({processing_status:'needs_review',match_decision:'needs_review',match_score:result.score,match_reason:result.reason}).eq('id',stage.id).throwOnError();stats.review++;continue}
    const {data:club,error}=await db.from('clubs').insert({slug:stableClubSlug(row.titre,externalId),official_name:row.titre,display_name:row.titre,city:row.adrs_libcommune||null,postal_code:row.adrs_codepostal||null,department_code:(row.adrs_codepostal||'').slice(0,2)||null,country_code:'FR',status:'active',claim_status:'unclaimed'}).select('id').single();if(error)throw error;
    await db.from('external_identities').insert({entity_type:'club',entity_id:club.id,provider:'RNA',external_id:externalId,metadata:{source:'Ministère de l’Intérieur RNA',source_updated_at:row.maj_time}}).throwOnError();
    await db.from('staging_rna_associations').update({processing_status:'matched',match_decision:'create_candidate',matched_club_id:club.id,match_score:result.score,match_reason:result.reason}).eq('id',stage.id).throwOnError();clubs.push({id:club.id,name:row.titre,city:row.adrs_libcommune,postalCode:row.adrs_codepostal});stats.created++;
  }
}
console.log(JSON.stringify(stats));
