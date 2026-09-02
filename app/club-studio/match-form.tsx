'use client';
import { useEffect, useState } from 'react';
import { createMatch, updateMatch } from './actions';
import { utcIsoToParisLocalInput } from '@/lib/matches/identity';

type OpponentTeamSeason = { teamSeasonId: string; displayName: string; teamRank: number | null };
type OpponentClub = { clubId: string; clubDisplayName: string; clubSlug: string; teamSeasons: OpponentTeamSeason[] };
type DuplicateCandidate = { id: string; kickoffAt: string; opponentTeamSeasonId: string | null; externalOpponentName: string | null };

export interface MatchFormInitial {
  matchId: string;
  isHome: boolean;
  opponentTeamSeasonId: string | null;
  opponentLabel: string | null;
  externalOpponentName: string | null;
  kickoffAtIso: string;
  venueName: string | null;
}

export function MatchForm({ clubId, ourTeamSeasonId, initial }: { clubId: string; ourTeamSeasonId: string; initial?: MatchFormInitial }) {
  const editing = Boolean(initial);
  const [homeAway, setHomeAway] = useState<'HOME' | 'AWAY'>(initial ? (initial.isHome ? 'HOME' : 'AWAY') : 'HOME');
  const [opponentQuery, setOpponentQuery] = useState('');
  const [opponentClubs, setOpponentClubs] = useState<OpponentClub[]>([]);
  const [selected, setSelected] = useState<{ teamSeasonId: string; label: string } | null>(
    initial?.opponentTeamSeasonId ? { teamSeasonId: initial.opponentTeamSeasonId, label: initial.opponentLabel ?? '' } : null
  );
  const [freeTextMode, setFreeTextMode] = useState(Boolean(initial?.externalOpponentName));
  const [freeTextName, setFreeTextName] = useState(initial?.externalOpponentName ?? '');
  const [kickoffLocal, setKickoffLocal] = useState(initial ? utcIsoToParisLocalInput(initial.kickoffAtIso) : '');
  const [venueName, setVenueName] = useState(initial?.venueName ?? '');
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);

  useEffect(() => {
    if (freeTextMode || opponentQuery.trim().length < 2) { setOpponentClubs([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const response = await fetch(`/api/matches/opponent-search?q=${encodeURIComponent(opponentQuery)}`, { signal: controller.signal });
      if (response.ok) setOpponentClubs((await response.json()).clubs ?? []);
    }, 220);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [opponentQuery, freeTextMode]);

  useEffect(() => {
    const opponentTeamSeasonId = selected?.teamSeasonId ?? '';
    const externalName = freeTextMode ? freeTextName.trim() : '';
    if (!kickoffLocal || (!opponentTeamSeasonId && !externalName)) { setDuplicates([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ team_season_id: ourTeamSeasonId, kickoff_local: kickoffLocal });
      if (opponentTeamSeasonId) params.set('opponent_team_season_id', opponentTeamSeasonId);
      if (externalName) params.set('external_opponent_name', externalName);
      const response = await fetch(`/api/matches/duplicate-check?${params.toString()}`, { signal: controller.signal });
      if (response.ok) {
        const data: { candidates: DuplicateCandidate[] } = await response.json();
        setDuplicates(editing ? data.candidates.filter((c) => c.id !== initial!.matchId) : data.candidates);
      }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [selected, freeTextMode, freeTextName, kickoffLocal, ourTeamSeasonId, editing, initial]);

  const homeTeamSeasonId = homeAway === 'HOME' ? ourTeamSeasonId : (selected?.teamSeasonId ?? '');
  const awayTeamSeasonId = homeAway === 'AWAY' ? ourTeamSeasonId : (selected?.teamSeasonId ?? '');

  return (
    <details className="match-form">
      <summary>{editing ? 'Modifier' : 'Ajouter un match'}</summary>
      <form action={editing ? updateMatch : createMatch} className="match-add-form">
        <input type="hidden" name="club_id" value={clubId} />
        {editing && <input type="hidden" name="match_id" value={initial!.matchId} />}
        {/* homeTeamSeasonId/awayTeamSeasonId already resolve to '' on whichever
            side isn't ours when that side is a free-text opponent (selected
            stays null in freeTextMode) -- no extra conditional needed here. */}
        <input type="hidden" name="home_team_season_id" value={homeTeamSeasonId} />
        <input type="hidden" name="away_team_season_id" value={awayTeamSeasonId} />
        <input type="hidden" name="external_opponent_name" value={freeTextMode ? freeTextName : ''} />

        <fieldset className="home-away">
          <label><input type="radio" name={`home_away_choice_${initial?.matchId ?? 'new'}`} checked={homeAway === 'HOME'} onChange={() => setHomeAway('HOME')} /> À domicile</label>
          <label><input type="radio" name={`home_away_choice_${initial?.matchId ?? 'new'}`} checked={homeAway === 'AWAY'} onChange={() => setHomeAway('AWAY')} /> À l’extérieur</label>
        </fieldset>

        {!freeTextMode ? (
          <>
            <label>Adversaire (club D3)
              <input className="field" value={opponentQuery} onChange={(e) => { setOpponentQuery(e.target.value); setSelected(null); }} placeholder="Nom du club adverse" />
            </label>
            {opponentClubs.length > 0 && (
              <ul className="candidate-list">
                {opponentClubs.flatMap((club) => club.teamSeasons.map((ts) => (
                  <li key={ts.teamSeasonId}>
                    <button type="button" onClick={() => setSelected({ teamSeasonId: ts.teamSeasonId, label: `${club.clubDisplayName} — ${ts.displayName}` })}>
                      <strong>{club.clubDisplayName}</strong><small>{ts.displayName}</small>
                    </button>
                  </li>
                )))}
              </ul>
            )}
            {selected && <p className="selected-player">Adversaire sélectionné : <strong>{selected.label}</strong> <button type="button" onClick={() => setSelected(null)}>Changer</button></p>}
            <button type="button" className="text-link" onClick={() => { setFreeTextMode(true); setSelected(null); }}>Adversaire non trouvé — saisir un nom</button>
          </>
        ) : (
          <>
            <label>Nom de l’adversaire
              <input className="field" value={freeTextName} onChange={(e) => setFreeTextName(e.target.value)} required placeholder="FC Exemple" />
            </label>
            <button type="button" className="text-link" onClick={() => { setFreeTextMode(false); setFreeTextName(''); }}>Rechercher un club D3 à la place</button>
          </>
        )}

        <label>Date et heure (heure de Paris)
          <input className="field" type="datetime-local" name="kickoff_local" value={kickoffLocal} onChange={(e) => setKickoffLocal(e.target.value)} required />
        </label>
        <label>Lieu (facultatif)
          <input className="field" name="venue_name" value={venueName} onChange={(e) => setVenueName(e.target.value)} placeholder="Stade municipal…" />
        </label>

        {duplicates.length > 0 && (
          <p className="message warning">
            Un match très proche existe déjà avec cet adversaire ({new Date(duplicates[0].kickoffAt).toLocaleDateString('fr-FR')}). Vérifiez avant de continuer — cette {editing ? 'modification' : 'création'} n’est pas bloquée.
          </p>
        )}

        <button className="button">{editing ? 'Enregistrer les modifications' : 'Créer le match'}</button>
      </form>
    </details>
  );
}
