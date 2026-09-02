export type ClubCandidate = { name:string; acronym?:string|null; city?:string|null; postalCode?:string|null; website?:string|null };
export type ExistingClub = ClubCandidate & { id:string };

export function normalizeClubName(value:string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/\b(f\s*\.?\s*c|a\s*\.?\s*s|u\s*\.?\s*s)\b/g,(token)=>token.replace(/[^a-z]/g,''))
    .replace(/[’']/g,' ').replace(/-/g,' ').replace(/[^a-z0-9\s]/g,' ')
    .replace(/\s+/g,' ').trim();
}

export function stableClubSlug(name:string, externalId:string) {
  const base=normalizeClubName(name).replace(/\s+/g,'-').slice(0,62).replace(/-+$/,'')||'club';
  const suffix=externalId.replace(/[^a-z0-9]/gi,'').toLowerCase().slice(-5);
  return `${base}-${suffix}`;
}

export function isFootballCandidate(name:string,purpose:string|null|undefined) {
  const text=normalizeClubName(`${name} ${purpose??''}`);
  if(!/\b(football|foot ball|futsal)\b/.test(text)) return false;
  return !/\b(supporter|supporters|supporterisme|baby foot|football americain)\b/.test(text);
}

export function matchClub(candidate:ClubCandidate,clubs:ExistingClub[]) {
  const name=normalizeClubName(candidate.name);
  const sameName=clubs.filter((club)=>normalizeClubName(club.name)===name);
  const samePlace=sameName.filter((club)=>(candidate.postalCode&&club.postalCode===candidate.postalCode)||(candidate.city&&normalizeClubName(club.city??'')===normalizeClubName(candidate.city)));
  if(samePlace.length===1) return {decision:'auto_match' as const,clubId:samePlace[0].id,score:.98,reason:'nom et localisation identiques'};
  if(sameName.length>0) return {decision:'needs_review' as const,clubId:null,score:.72,reason:'nom identique, localisation différente ou absente'};
  return {decision:'create_candidate' as const,clubId:null,score:.55,reason:'aucun club canonique correspondant'};
}
