import {describe,expect,it} from 'vitest';
import {isFootballCandidate,matchClub,normalizeClubName,stableClubSlug} from './registry';

describe('club registry',()=>{
  it.each([['F.C. Exemple','fc exemple'],['  AS  Saint-Étienne ','as saint etienne'],["U.S. L'Île-Rousse",'us l ile rousse']])('normalizes %s', (raw,expected)=>expect(normalizeClubName(raw)).toBe(expected));
  it('keeps Saint and St distinct',()=>expect(normalizeClubName('Saint Malo')).not.toBe(normalizeClubName('St Malo')));
  it('creates stable unique slugs',()=>expect(stableClubSlug('F.C. Exemple','W123456789')).toBe('fc-exemple-56789'));
  it('auto matches only name and location',()=>expect(matchClub({name:'F.C. Exemple',city:'Nantes'},[{id:'1',name:'FC Exemple',city:'Nantes'}]).decision).toBe('auto_match'));
  it('does not merge homonyms across cities',()=>expect(matchClub({name:'FC Exemple',city:'Lyon'},[{id:'1',name:'FC Exemple',city:'Nantes'}]).decision).toBe('needs_review'));
  it('uses acronyms without aggressive merging',()=>expect(matchClub({name:'F.C. Exemple',acronym:'FCE'},[{id:'1',name:'FC Exemple',acronym:'FCE',city:'Paris'}]).decision).toBe('needs_review'));
  it('rejects non-football and supporter associations',()=>{expect(isFootballCandidate('Club de tennis','Pratique du tennis')).toBe(false);expect(isFootballCandidate('Les amis du FC','Supporters de football')).toBe(false)});
});
