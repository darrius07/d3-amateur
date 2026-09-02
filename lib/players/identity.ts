const DIACRITICS=/[\u0300-\u036f]/g;
export type PlayerCandidate={id:string;normalizedName:string;clubId?:string|null;seasonId?:string|null};
export function normalizePlayerName(value:string){return value.normalize('NFD').replace(DIACRITICS,'').toLowerCase().replace(/[’']/g,' ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ')}
export function playerSlug(firstName:string,lastName:string,suffix:string){const base=normalizePlayerName(`${firstName} ${lastName}`).replace(/ /g,'-')||'joueur';return `${base}-${suffix.toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,8)}`}
export function classifyCandidate(query:string,candidate:PlayerCandidate,clubId:string,seasonId:string){const exact=normalizePlayerName(query)===candidate.normalizedName;if(!exact)return 'RELATED';if(candidate.clubId===clubId&&candidate.seasonId===seasonId)return 'VERY_LIKELY';return 'AMBIGUOUS'}
export function uniqueActiveRoster(playerIds:string[]){return new Set(playerIds).size===playerIds.length}
export function registrationKey(playerId:string,clubId:string,seasonId:string){return `${playerId}:${clubId}:${seasonId}`}
