import {createClient} from '@supabase/supabase-js';import {createAdminClient} from '@/lib/supabase/admin';
function publicClient(){return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false}})}
// The admin client (lib/supabase/admin.ts) is intentionally untyped (no
// generated Database generic), so Postgrest-js cannot infer relationship
// cardinality on embedded selects and defaults every `foo(...)` embed to an
// array — even genuine to-one foreign keys like player_registrations.club_id
// -> clubs.id. `one()` collapses that back to a single row (or null) right
// where the raw response is read, so every consumer downstream gets the real
// shape instead of re-deriving it (and re-triggering the same TS error) at
// each call site.
export function one<T>(value:T|T[]|null|undefined):T|null{return Array.isArray(value)?(value[0]??null):(value??null)}

export interface PlayerSearchResult{id:string;display_name:string;slug:string;primary_position:string|null;club_id:string|null;club_name:string|null;season_id:string|null;team_name:string|null;rank:number}
export async function searchPlayers(query:string):Promise<PlayerSearchResult[]>{if(query.trim().length<2)return [];const {data,error}=await publicClient().rpc('search_players',{query:query.trim(),result_limit:12});if(error)throw error;return data??[]}

export interface RosterMemberPlayer{id:string;slug:string;display_name:string;primary_position:string|null}
export interface RosterMember{id:string;player_id:string;squad_number:number|null;primary_position:string|null;verification_status:string;players:RosterMemberPlayer}
export interface ClubRosterTeam{id:string;display_name:string;team_rank:number|null;teamSeason:{id:string;season_id:string;seasons:{label:string;active:boolean}|null};members:RosterMember[]}

export async function getClubRosters(clubId:string):Promise<ClubRosterTeam[]>{
  const admin=createAdminClient();
  const {data:teams,error}=await admin.from('teams').select('id,display_name,team_rank').eq('club_id',clubId).eq('active',true).eq('gender','male').eq('category','senior').eq('football_format','11').order('team_rank');
  if(error)throw error;
  const result:ClubRosterTeam[]=[];
  for(const team of teams??[]){
    const {data:season}=await admin.from('team_seasons').select('id,season_id,seasons(label,active)').eq('team_id',team.id).order('created_at',{ascending:false}).limit(1).maybeSingle();
    if(!season)continue;
    const {data:members}=await admin.from('team_roster_members').select('id,player_id,squad_number,primary_position,verification_status,players(id,slug,display_name,primary_position)').eq('team_season_id',season.id).eq('active',true).order('squad_number');
    result.push({
      ...team,
      teamSeason:{id:season.id,season_id:season.season_id,seasons:one(season.seasons)},
      members:(members??[]).flatMap(member=>{const player=one(member.players);return player?[{...member,players:player}]:[]}),
    });
  }
  return result;
}

export interface PlayerRegistration{id:string;status:string;verification_status:string;season_id:string;club_id:string;seasons:{label:string;start_date:string}|null;clubs:{display_name:string;slug:string;city:string|null}|null}
export interface PlayerRosterEntry{id:string;team_season_id:string;primary_position:string|null;squad_number:number|null;team_seasons:{season_id:string;club_id:string|null;teams:{display_name:string;club_id:string}|null}|null}
export interface PlayerDetail{id:string;slug:string;first_name:string;last_name:string;display_name:string;normalized_name:string;primary_position:string|null;profile_status:string;claim_status:string;created_at:string;updated_at:string;registrations:PlayerRegistration[];rosters:PlayerRosterEntry[]}

export async function getPlayer(slug:string):Promise<PlayerDetail|null>{
  const admin=createAdminClient();
  const {data:player,error}=await admin.from('players').select('*').eq('slug',slug).eq('profile_status','PUBLIC').maybeSingle();
  if(error)throw error;
  if(!player)return null;
  const {data:registrations}=await admin.from('player_registrations').select('id,status,verification_status,season_id,club_id,seasons(label,start_date),clubs(display_name,slug,city)').eq('player_id',player.id).order('created_at',{ascending:false});
  const {data:rosters}=await admin.from('team_roster_members').select('id,team_season_id,primary_position,squad_number,team_seasons(season_id,teams(display_name,club_id))').eq('player_id',player.id).eq('active',true);
  return {
    ...player,
    registrations:(registrations??[]).map(registration=>({...registration,seasons:one(registration.seasons),clubs:one(registration.clubs)})),
    rosters:(rosters??[]).map(roster=>{const teamSeason=one(roster.team_seasons);const teams=teamSeason?one(teamSeason.teams):null;return {...roster,team_seasons:teamSeason?{season_id:teamSeason.season_id,club_id:teams?.club_id??null,teams}:null}}),
  };
}
