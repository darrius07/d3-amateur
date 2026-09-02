'use client';
import { useState } from 'react';
import { saveLineup } from '@/app/club-studio/actions';
import { computeCompleteness, validateLineupEntries, type LineupEntry, type LineupRole } from '@/lib/matches/lineup';

const positions = ['UNKNOWN', 'GOALKEEPER', 'DEFENDER', 'MIDFIELDER', 'FORWARD'];

export interface EligiblePlayer {
  playerId: string;
  displayName: string;
  primaryPosition: string | null;
  rosterTeamDisplayName: string | null;
  onOwnRoster: boolean;
}

export interface InitialEntry {
  playerId: string;
  displayName: string;
  lineupRole: LineupRole;
  position: string | null;
  squadNumber: number | null;
}

export function LineupEditor({
  clubId,
  matchId,
  teamSeasonId,
  initialEntries,
  eligiblePlayers,
  savedMessage,
}: {
  clubId: string;
  matchId: string;
  teamSeasonId: string;
  initialEntries: InitialEntry[];
  eligiblePlayers: EligiblePlayer[];
  savedMessage?: boolean;
}) {
  const [rows, setRows] = useState<Map<string, InitialEntry>>(new Map(initialEntries.map((e) => [e.playerId, e])));
  const [query, setQuery] = useState('');

  const addedIds = new Set(rows.keys());
  const candidates = query.trim().length >= 1
    ? eligiblePlayers.filter((p) => !addedIds.has(p.playerId) && p.displayName.toLowerCase().includes(query.trim().toLowerCase()))
    : [];

  const entries: LineupEntry[] = Array.from(rows.values()).map((r) => ({ playerId: r.playerId, lineupRole: r.lineupRole, position: r.position, squadNumber: r.squadNumber }));
  const validation = validateLineupEntries(entries);
  const completeness = computeCompleteness(entries);
  const starters = Array.from(rows.values()).filter((r) => r.lineupRole === 'STARTER');
  const bench = Array.from(rows.values()).filter((r) => r.lineupRole === 'BENCH');

  function addPlayer(player: EligiblePlayer) {
    const role: LineupRole = starters.length < 11 ? 'STARTER' : 'BENCH';
    setRows((prev) => new Map(prev).set(player.playerId, { playerId: player.playerId, displayName: player.displayName, lineupRole: role, position: player.primaryPosition, squadNumber: null }));
    setQuery('');
  }
  function moveTo(playerId: string, role: LineupRole) {
    setRows((prev) => { const next = new Map(prev); const row = next.get(playerId); if (row) next.set(playerId, { ...row, lineupRole: role }); return next; });
  }
  function remove(playerId: string) {
    setRows((prev) => { const next = new Map(prev); next.delete(playerId); return next; });
  }
  function updateField(playerId: string, field: 'position' | 'squadNumber', value: string) {
    setRows((prev) => { const next = new Map(prev); const row = next.get(playerId); if (!row) return prev; next.set(playerId, { ...row, [field]: field === 'squadNumber' ? (value ? Number(value) : null) : value }); return next; });
  }

  return (
    <div className="lineup-editor">
      {savedMessage && <p className="success">Composition enregistrée.</p>}
      <p className={`lineup-completeness completeness-${completeness.toLowerCase()}`}>
        Titulaires {starters.length}/11 · Remplaçants {bench.length} · {completeness === 'COMPLETE' ? 'Complète' : completeness === 'PARTIAL' ? 'Partielle' : 'Vide'}
      </p>
      <p className="message">Composition renseignée par le club — pas une feuille officielle.</p>

      <label>Ajouter un joueur
        <input className="field" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Chercher dans l'effectif du club…" />
      </label>
      {candidates.length > 0 && (
        <ul className="candidate-list">
          {candidates.map((p) => (
            <li key={p.playerId}>
              <button type="button" onClick={() => addPlayer(p)}>
                <strong>{p.displayName}</strong>
                <small>{[p.rosterTeamDisplayName, p.primaryPosition].filter(Boolean).join(' · ') || 'Effectif du club'}</small>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!validation.valid && <p className="message warning">{validation.error}</p>}

      <div className="lineup-columns">
        <section>
          <h3>Titulaires ({starters.length}/11)</h3>
          {starters.length === 0 && <p className="empty">Aucun titulaire pour le moment.</p>}
          <ul className="lineup-list">
            {starters.map((row) => (
              <li key={row.playerId}>
                <strong>{row.displayName}</strong>
                <select value={row.position ?? 'UNKNOWN'} onChange={(e) => updateField(row.playerId, 'position', e.target.value)} aria-label="Poste">
                  {positions.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <input type="number" min="1" max="99" value={row.squadNumber ?? ''} onChange={(e) => updateField(row.playerId, 'squadNumber', e.target.value)} aria-label="Numéro" placeholder="N°" />
                <button type="button" onClick={() => moveTo(row.playerId, 'BENCH')}>→ Banc</button>
                <button type="button" className="text-danger" onClick={() => remove(row.playerId)}>Retirer</button>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3>Remplaçants ({bench.length})</h3>
          {bench.length === 0 && <p className="empty">Aucun remplaçant pour le moment.</p>}
          <ul className="lineup-list">
            {bench.map((row) => (
              <li key={row.playerId}>
                <strong>{row.displayName}</strong>
                <select value={row.position ?? 'UNKNOWN'} onChange={(e) => updateField(row.playerId, 'position', e.target.value)} aria-label="Poste">
                  {positions.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <input type="number" min="1" max="99" value={row.squadNumber ?? ''} onChange={(e) => updateField(row.playerId, 'squadNumber', e.target.value)} aria-label="Numéro" placeholder="N°" />
                <button type="button" onClick={() => moveTo(row.playerId, 'STARTER')} disabled={starters.length >= 11}>→ Titulaire</button>
                <button type="button" className="text-danger" onClick={() => remove(row.playerId)}>Retirer</button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <form action={saveLineup}>
        <input type="hidden" name="club_id" value={clubId} />
        <input type="hidden" name="match_id" value={matchId} />
        <input type="hidden" name="team_season_id" value={teamSeasonId} />
        <input type="hidden" name="entries" value={JSON.stringify(entries)} />
        <button className="button" disabled={!validation.valid}>Enregistrer la composition</button>
      </form>
    </div>
  );
}
