'use server';
import crypto from 'node:crypto';import {redirect} from 'next/navigation';import {revalidatePath} from 'next/cache';import {createClient} from '@/lib/supabase/server';import {createAdminClient} from '@/lib/supabase/admin';import {clubLogoPath,validateLogo} from '@/lib/clubs/logo';import {playerSlug} from '@/lib/players/identity';import {parisLocalToUtcIso,validateOpponentShape,validateScore} from '@/lib/matches/identity';
import {validateDisplayName,validateEmail,validateExternalUrl,validateFoundedYear,validateHexColor,validateLongDescription,validatePhone,validatePostalCode,validateShortDescription} from '@/lib/clubs/profile';
async function ownerContext(clubId:string){const auth=await createClient();const {data:{user}}=await auth.auth.getUser();if(!user)throw new Error('Non authentifié');const admin=createAdminClient();const {data:membership}=await admin.from('club_memberships').select('id').eq('club_id',clubId).eq('user_id',user.id).eq('role','OWNER').eq('active',true).maybeSingle();const {data:profile}=await admin.from('user_profiles').select('d3_admin_role').eq('id',user.id).maybeSingle();if(!membership&&!profile?.d3_admin_role)throw new Error('Accès refusé');return {user,admin}}
export async function uploadClubLogo(formData:FormData){const clubId=String(formData.get('club_id'));const file=formData.get('logo');if(!(file instanceof File))throw new Error('Fichier requis');const {user,admin}=await ownerContext(clubId);const bytes=new Uint8Array(await file.arrayBuffer());const type=validateLogo({bytes,declaredMime:file.type,size:file.size});const path=clubLogoPath(clubId,crypto.randomUUID(),type.extension);const {data:club,error:clubError}=await admin.from('clubs').select('logo_path,slug').eq('id',clubId).single();if(clubError)throw clubError;const {error:uploadError}=await admin.storage.from('club-assets').upload(path,bytes,{contentType:type.mime,upsert:false});if(uploadError)throw uploadError;const {error:updateError}=await admin.from('clubs').update({logo_path:path,logo_source:'CLUB',logo_updated_at:new Date().toISOString()}).eq('id',clubId);if(updateError){await admin.storage.from('club-assets').remove([path]);throw updateError}if(club.logo_path&&club.logo_path.startsWith(`clubs/${clubId}/logo/`))await admin.storage.from('club-assets').remove([club.logo_path]);await admin.from('admin_audit_logs').insert({actor_user_id:user.id,action:club.logo_path?'logo_replaced':'logo_uploaded',entity_type:'club',entity_id:clubId,details:{before:{logo_path:club.logo_path},after:{logo_path:path},source:'CLUB'}});revalidatePath('/club-studio');revalidatePath(`/clubs/${club.slug}`)}
export async function deleteClubLogo(formData:FormData){const clubId=String(formData.get('club_id'));const {user,admin}=await ownerContext(clubId);const {data:club,error}=await admin.from('clubs').select('logo_path,slug').eq('id',clubId).single();if(error)throw error;if(club.logo_path&&!club.logo_path.startsWith(`clubs/${clubId}/logo/`))throw new Error('Chemin asset invalide');await admin.from('clubs').update({logo_path:null,logo_source:null,logo_updated_at:new Date().toISOString()}).eq('id',clubId);if(club.logo_path)await admin.storage.from('club-assets').remove([club.logo_path]);await admin.from('admin_audit_logs').insert({actor_user_id:user.id,action:'logo_deleted',entity_type:'club',entity_id:clubId,details:{before:{logo_path:club.logo_path},after:{logo_path:null}}});revalidatePath('/club-studio');revalidatePath(`/clubs/${club.slug}`)}
export async function ensureSeniorTeam(formData:FormData){const clubId=String(formData.get('club_id'));const rank=Number(formData.get('rank'));const {user,admin}=await ownerContext(clubId);const {error}=await admin.rpc('ensure_senior_team',{actor_id:user.id,target_club_id:clubId,rank_value:rank});if(error)throw error;revalidatePath('/club-studio')}
export async function addRosterPlayer(formData:FormData){const clubId=String(formData.get('club_id'));const teamSeasonId=String(formData.get('team_season_id'));const {user,admin}=await ownerContext(clubId);const existing=String(formData.get('existing_player_id')||'').trim()||null;const first=String(formData.get('first_name')||'').trim();const last=String(formData.get('last_name')||'').trim();const position=String(formData.get('primary_position')||'UNKNOWN');const squadRaw=String(formData.get('squad_number')||'').trim();const {data,error}=await admin.rpc('manage_roster_player',{actor_id:user.id,target_team_season_id:teamSeasonId,existing_player_id:existing,new_first_name:first,new_last_name:last,new_slug:playerSlug(first,last,crypto.randomUUID()),position_value:position,squad_value:squadRaw?Number(squadRaw):null});if(error)throw error;if(!data)redirect('/club-studio?message=registration-review');revalidatePath('/club-studio');redirect(`/club-studio?player=${data}`)}
export async function updateRosterPlayer(formData:FormData){const clubId=String(formData.get('club_id'));const {user,admin}=await ownerContext(clubId);const squadRaw=String(formData.get('squad_number')||'').trim();const {error}=await admin.rpc('update_roster_member',{actor_id:user.id,roster_member_id:String(formData.get('roster_member_id')),position_value:String(formData.get('primary_position')||'UNKNOWN'),squad_value:squadRaw?Number(squadRaw):null});if(error)throw error;revalidatePath('/club-studio')}
export async function removeRosterPlayer(formData:FormData){const clubId=String(formData.get('club_id'));const {user,admin}=await ownerContext(clubId);const {error}=await admin.rpc('remove_roster_member',{actor_id:user.id,roster_member_id:String(formData.get('roster_member_id'))});if(error)throw error;revalidatePath('/club-studio')}

function readOpponentFields(formData:FormData){
  const homeTeamSeasonId=String(formData.get('home_team_season_id')||'').trim()||null;
  const awayTeamSeasonId=String(formData.get('away_team_season_id')||'').trim()||null;
  const externalOpponentName=String(formData.get('external_opponent_name')||'').trim()||null;
  const shape=validateOpponentShape({homeTeamSeasonId,awayTeamSeasonId,externalOpponentName});
  if(!shape.valid)throw new Error(shape.error);
  const kickoffLocal=String(formData.get('kickoff_local')||'');
  if(!kickoffLocal)throw new Error('Date et heure requises');
  const kickoffAt=parisLocalToUtcIso(kickoffLocal);
  const venueName=String(formData.get('venue_name')||'').trim()||null;
  return {homeTeamSeasonId,awayTeamSeasonId,externalOpponentName,kickoffAt,venueName};
}

export async function createMatch(formData:FormData){
  const clubId=String(formData.get('club_id'));
  const {user,admin}=await ownerContext(clubId);
  const fields=readOpponentFields(formData);
  const {error}=await admin.rpc('create_match',{
    actor_id:user.id,
    p_home_team_season_id:fields.homeTeamSeasonId,
    p_away_team_season_id:fields.awayTeamSeasonId,
    p_external_opponent_name:fields.externalOpponentName,
    p_competition_season_id:null,
    p_competition_group_id:null,
    p_venue_id:null,
    p_kickoff_at:fields.kickoffAt,
    p_venue_name:fields.venueName,
  });
  if(error)throw error;
  revalidatePath('/club-studio');
  redirect('/club-studio?message=match-created');
}

export async function updateMatch(formData:FormData){
  const clubId=String(formData.get('club_id'));
  const {user,admin}=await ownerContext(clubId);
  const fields=readOpponentFields(formData);
  const {error}=await admin.rpc('update_match',{
    actor_id:user.id,
    p_match_id:String(formData.get('match_id')),
    p_home_team_season_id:fields.homeTeamSeasonId,
    p_away_team_season_id:fields.awayTeamSeasonId,
    p_external_opponent_name:fields.externalOpponentName,
    p_kickoff_at:fields.kickoffAt,
    p_venue_id:null,
    p_competition_season_id:null,
    p_competition_group_id:null,
    p_venue_name:fields.venueName,
  });
  if(error)throw error;
  revalidatePath('/club-studio');
  redirect('/club-studio?message=match-updated');
}

export async function enterMatchResult(formData:FormData){
  const clubId=String(formData.get('club_id'));
  const {user,admin}=await ownerContext(clubId);
  const homeScore=Number(formData.get('home_score'));
  const awayScore=Number(formData.get('away_score'));
  const check=validateScore(homeScore,awayScore);
  if(!check.valid)throw new Error(check.error);
  const {error}=await admin.rpc('enter_match_result',{actor_id:user.id,p_match_id:String(formData.get('match_id')),p_home_score:homeScore,p_away_score:awayScore});
  if(error)throw error;
  revalidatePath('/club-studio');
  revalidatePath('/');
  redirect('/club-studio?message=result-saved');
}

export async function postponeMatch(formData:FormData){
  const clubId=String(formData.get('club_id'));
  const {user,admin}=await ownerContext(clubId);
  const {error}=await admin.rpc('postpone_match',{actor_id:user.id,p_match_id:String(formData.get('match_id'))});
  if(error)throw error;
  revalidatePath('/club-studio');
}

export async function cancelMatch(formData:FormData){
  const clubId=String(formData.get('club_id'));
  const {user,admin}=await ownerContext(clubId);
  const {error}=await admin.rpc('cancel_match',{actor_id:user.id,p_match_id:String(formData.get('match_id'))});
  if(error)throw error;
  revalidatePath('/club-studio');
}

export async function saveLineup(formData:FormData){
  const clubId=String(formData.get('club_id'));
  const matchId=String(formData.get('match_id'));
  const teamSeasonId=String(formData.get('team_season_id'));
  const {user,admin}=await ownerContext(clubId);
  let entries:unknown;
  try{entries=JSON.parse(String(formData.get('entries')||'[]'))}catch{throw new Error('Données de composition invalides')}
  const {error}=await admin.rpc('save_match_lineup',{actor_id:user.id,p_match_id:matchId,p_team_season_id:teamSeasonId,p_entries:entries});
  if(error)throw error;
  revalidatePath(`/club-studio/matches/${matchId}/lineup`);
  revalidatePath(`/matches/${matchId}`);
  redirect(`/club-studio/matches/${matchId}/lineup?message=lineup-saved`);
}

function readEventFields(formData:FormData){
  const matchId=String(formData.get('match_id'));
  const primaryPlayerId=String(formData.get('primary_player_id')||'');
  const secondaryPlayerId=String(formData.get('secondary_player_id')||'').trim()||null;
  const minuteRaw=String(formData.get('minute')||'').trim();
  const addedTimeRaw=String(formData.get('added_time')||'').trim();
  const goalKind=String(formData.get('goal_kind')||'').trim()||null;
  const cardKind=String(formData.get('card_kind')||'').trim()||null;
  return {
    matchId,primaryPlayerId,secondaryPlayerId,
    minute:minuteRaw?Number(minuteRaw):null,
    addedTime:addedTimeRaw?Number(addedTimeRaw):null,
    goalKind,cardKind,
  };
}

export async function createMatchEvent(formData:FormData){
  const clubId=String(formData.get('club_id'));
  const {user,admin}=await ownerContext(clubId);
  const teamSeasonId=String(formData.get('team_season_id'));
  const eventType=String(formData.get('event_type'));
  const fields=readEventFields(formData);
  const {error}=await admin.rpc('create_match_event',{
    actor_id:user.id,p_match_id:fields.matchId,p_team_season_id:teamSeasonId,p_event_type:eventType,
    p_primary_player_id:fields.primaryPlayerId,p_secondary_player_id:fields.secondaryPlayerId,
    p_minute:fields.minute,p_added_time:fields.addedTime,p_goal_kind:fields.goalKind,p_card_kind:fields.cardKind,
  });
  if(error)throw error;
  revalidatePath(`/club-studio/matches/${fields.matchId}/events`);
  revalidatePath(`/matches/${fields.matchId}`);
  redirect(`/club-studio/matches/${fields.matchId}/events?message=event-created`);
}

export async function updateMatchEvent(formData:FormData){
  const clubId=String(formData.get('club_id'));
  const {user,admin}=await ownerContext(clubId);
  const eventId=String(formData.get('event_id'));
  const fields=readEventFields(formData);
  const {error}=await admin.rpc('update_match_event',{
    actor_id:user.id,p_event_id:eventId,
    p_primary_player_id:fields.primaryPlayerId,p_secondary_player_id:fields.secondaryPlayerId,
    p_minute:fields.minute,p_added_time:fields.addedTime,p_goal_kind:fields.goalKind,p_card_kind:fields.cardKind,
  });
  if(error)throw error;
  revalidatePath(`/club-studio/matches/${fields.matchId}/events`);
  revalidatePath(`/matches/${fields.matchId}`);
}

function readText(formData:FormData,key:string):string{return String(formData.get(key)||'')}

/** Validates every field client-visibly before ever calling the RPC -- the RPC/CHECK constraints remain the real authority (never trust this alone), but a clear French error here beats a raw Postgres error. */
export async function updateClubProfile(formData:FormData){
  const clubId=String(formData.get('club_id'));
  const {user,admin}=await ownerContext(clubId);

  const displayName=readText(formData,'display_name');
  const shortDescription=readText(formData,'short_description');
  const longDescription=readText(formData,'long_description');
  const foundedYearRaw=readText(formData,'founded_year').trim();
  const primaryColor=readText(formData,'primary_color');
  const secondaryColor=readText(formData,'secondary_color');
  const websiteUrl=readText(formData,'website_url');
  const facebookUrl=readText(formData,'facebook_url');
  const instagramUrl=readText(formData,'instagram_url');
  const xUrl=readText(formData,'x_url');
  const tiktokUrl=readText(formData,'tiktok_url');
  const youtubeUrl=readText(formData,'youtube_url');
  const publicEmail=readText(formData,'public_email');
  const publicPhone=readText(formData,'public_phone');
  const venueName=readText(formData,'venue_name');
  const venuePostalCode=readText(formData,'venue_postal_code');

  const checks=[
    validateDisplayName(displayName),
    validateShortDescription(shortDescription),
    validateLongDescription(longDescription),
    validateFoundedYear(foundedYearRaw),
    validateHexColor(primaryColor),
    validateHexColor(secondaryColor),
    validateExternalUrl(websiteUrl),validateExternalUrl(facebookUrl),validateExternalUrl(instagramUrl),validateExternalUrl(xUrl),validateExternalUrl(tiktokUrl),validateExternalUrl(youtubeUrl),
    validateEmail(publicEmail),
    validatePhone(publicPhone),
    validatePostalCode(venuePostalCode),
  ];
  const firstError=checks.find(c=>!c.valid);
  if(firstError)throw new Error(firstError.error);

  const {error}=await admin.rpc('update_club_profile',{
    actor_id:user.id,
    target_club_id:clubId,
    p_display_name:displayName,
    p_short_description:shortDescription,
    p_long_description:longDescription,
    p_founded_year:foundedYearRaw?Number(foundedYearRaw):null,
    p_primary_color:primaryColor,
    p_secondary_color:secondaryColor,
    p_website_url:websiteUrl,
    p_facebook_url:facebookUrl,
    p_instagram_url:instagramUrl,
    p_x_url:xUrl,
    p_tiktok_url:tiktokUrl,
    p_youtube_url:youtubeUrl,
    p_public_email:publicEmail,
    p_public_phone:publicPhone,
    p_venue_name:venueName,
    p_venue_address:readText(formData,'venue_address'),
    p_venue_postal_code:venuePostalCode,
    p_venue_city:readText(formData,'venue_city'),
  });
  if(error)throw error;

  const {data:club}=await admin.from('clubs').select('slug').eq('id',clubId).single();
  revalidatePath('/club-studio');
  revalidatePath('/club-studio/profile');
  if(club?.slug)revalidatePath(`/clubs/${club.slug}`);
  redirect(`/club-studio/profile?club_id=${clubId}&message=profile-updated`);
}

export async function deleteMatchEvent(formData:FormData){
  const clubId=String(formData.get('club_id'));
  const {user,admin}=await ownerContext(clubId);
  const matchId=String(formData.get('match_id'));
  const eventId=String(formData.get('event_id'));
  const {error}=await admin.rpc('delete_match_event',{actor_id:user.id,p_event_id:eventId});
  if(error)throw error;
  revalidatePath(`/club-studio/matches/${matchId}/events`);
  revalidatePath(`/matches/${matchId}`);
}
