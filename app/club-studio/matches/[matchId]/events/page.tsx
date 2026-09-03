import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { resolveOwnedMatchSide, getMatchLineupEntries } from '@/lib/matches/lineup-data';
import { getTeamMatchEvents } from '@/lib/matches/events-data';
import { formatKickoffParis } from '@/lib/matches/identity';
import { formatMinute } from '@/lib/matches/events';
import { createMatchEvent, updateMatchEvent, deleteMatchEvent } from '@/app/club-studio/actions';

type Props = { params: Promise<{ matchId: string }>; searchParams: Promise<{ message?: string }> };

const EVENT_LABELS: Record<string, string> = {
  GOAL: '⚽ But', OWN_GOAL: '⚽ Contre son camp', YELLOW_CARD: '🟨 Carton jaune', RED_CARD: '🔴 Carton rouge', SUBSTITUTION: '🔄 Remplacement',
};

export default async function ManageEventsPage({ params, searchParams }: Props) {
  const { matchId } = await params;
  const { message } = await searchParams;
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) redirect(`/login?returnTo=/club-studio/matches/${matchId}/events`);

  const side = await resolveOwnedMatchSide(matchId, user.id);
  if (!side) notFound();

  const [sheet, events] = await Promise.all([
    getMatchLineupEntries(matchId, side.teamSeasonId),
    getTeamMatchEvents(matchId, side.teamSeasonId),
  ]);

  return (
    <main className="main studio">
      <Link className="back-link" href="/club-studio">← Retour au Club Studio</Link>
      <p className="eyebrow">Événements du match</p>
      <h1>{side.teamDisplayName} vs {side.opponentLabel}</h1>
      <p>{formatKickoffParis(side.kickoffAt)}</p>
      {message === 'event-created' && <p className="success">Événement ajouté.</p>}
      <p className="message">Événements renseignés par le club — pas une feuille officielle.</p>

      {sheet.length === 0 && (
        <p className="message warning">
          Aucun joueur sur la feuille de match. <Link href={`/club-studio/matches/${matchId}/lineup`}>Gérer la composition</Link> d&apos;abord.
        </p>
      )}

      <section className="events-timeline">
        <h2>Chronologie ({side.teamDisplayName})</h2>
        {events.length === 0 ? <p className="empty">Aucun événement documenté pour le moment.</p> : (
          <ul className="event-list">
            {events.map((event) => (
              <li key={event.id}>
                <div>
                  <strong>{formatMinute(event.minute, event.addedTime)}</strong> — {EVENT_LABELS[event.eventType] ?? event.eventType} · {event.primaryPlayerName}
                  {event.eventType === 'GOAL' && event.secondaryPlayerName && <span> · Passe : {event.secondaryPlayerName}</span>}
                  {event.eventType === 'SUBSTITUTION' && <span> · {event.primaryPlayerName} sort · {event.secondaryPlayerName} entre</span>}
                </div>
                <details className="edit-event-form">
                  <summary>Modifier</summary>
                  <form action={updateMatchEvent} className="score-form">
                    <input type="hidden" name="club_id" value={side.clubId} />
                    <input type="hidden" name="match_id" value={matchId} />
                    <input type="hidden" name="event_id" value={event.id} />
                    {event.eventType !== 'SUBSTITUTION' ? (
                      <label>Joueur
                        <select name="primary_player_id" defaultValue={event.primaryPlayerId}>
                          {sheet.map((p) => <option key={p.playerId} value={p.playerId}>{p.displayName}</option>)}
                        </select>
                      </label>
                    ) : (
                      <>
                        <label>Sortant
                          <select name="primary_player_id" defaultValue={event.primaryPlayerId}>
                            {sheet.map((p) => <option key={p.playerId} value={p.playerId}>{p.displayName}</option>)}
                          </select>
                        </label>
                        <label>Entrant
                          <select name="secondary_player_id" defaultValue={event.secondaryPlayerId ?? ''}>
                            {sheet.map((p) => <option key={p.playerId} value={p.playerId}>{p.displayName}</option>)}
                          </select>
                        </label>
                      </>
                    )}
                    {event.eventType === 'GOAL' && (
                      <label>Passeur (facultatif)
                        <select name="secondary_player_id" defaultValue={event.secondaryPlayerId ?? ''}>
                          <option value="">Aucun</option>
                          {sheet.map((p) => <option key={p.playerId} value={p.playerId}>{p.displayName}</option>)}
                        </select>
                      </label>
                    )}
                    <label>Minute (facultatif)<input type="number" name="minute" min="0" max="130" defaultValue={event.minute ?? ''} /></label>
                    <label>Temps additionnel<input type="number" name="added_time" min="0" max="15" defaultValue={event.addedTime ?? ''} /></label>
                    {event.eventType === 'GOAL' && (
                      <label>Type de but
                        <select name="goal_kind" defaultValue={event.goalKind ?? 'NORMAL'}>
                          <option value="NORMAL">Normal</option><option value="PENALTY">Penalty</option><option value="FREE_KICK">Coup franc</option><option value="UNKNOWN">Inconnu</option>
                        </select>
                      </label>
                    )}
                    {event.eventType === 'RED_CARD' && (
                      <label>Type de rouge
                        <select name="card_kind" defaultValue={event.cardKind ?? 'DIRECT'}>
                          <option value="DIRECT">Direct</option><option value="SECOND_YELLOW">Deuxième jaune</option><option value="UNKNOWN">Inconnu</option>
                        </select>
                      </label>
                    )}
                    <button className="button">Enregistrer</button>
                  </form>
                </details>
                <form action={deleteMatchEvent}>
                  <input type="hidden" name="club_id" value={side.clubId} />
                  <input type="hidden" name="match_id" value={matchId} />
                  <input type="hidden" name="event_id" value={event.id} />
                  <button className="text-danger">Supprimer</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      {sheet.length > 0 && (
        <div className="add-event-forms">
          <details className="match-form">
            <summary>Ajouter un but</summary>
            <form action={createMatchEvent} className="roster-form">
              <input type="hidden" name="club_id" value={side.clubId} />
              <input type="hidden" name="match_id" value={matchId} />
              <input type="hidden" name="team_season_id" value={side.teamSeasonId} />
              <input type="hidden" name="event_type" value="GOAL" />
              <label>Buteur<select name="primary_player_id" required>{sheet.map((p) => <option key={p.playerId} value={p.playerId}>{p.displayName}</option>)}</select></label>
              <label>Passeur (facultatif)<select name="secondary_player_id"><option value="">Aucun</option>{sheet.map((p) => <option key={p.playerId} value={p.playerId}>{p.displayName}</option>)}</select></label>
              <label>Minute (facultatif)<input type="number" name="minute" min="0" max="130" /></label>
              <label>Temps additionnel<input type="number" name="added_time" min="0" max="15" /></label>
              <label>Type de but<select name="goal_kind" defaultValue="NORMAL"><option value="NORMAL">Normal</option><option value="PENALTY">Penalty</option><option value="FREE_KICK">Coup franc</option><option value="UNKNOWN">Inconnu</option></select></label>
              <button className="button">Ajouter le but</button>
            </form>
          </details>

          <details className="match-form">
            <summary>Ajouter un but contre son camp</summary>
            <form action={createMatchEvent} className="roster-form">
              <input type="hidden" name="club_id" value={side.clubId} />
              <input type="hidden" name="match_id" value={matchId} />
              <input type="hidden" name="team_season_id" value={side.teamSeasonId} />
              <input type="hidden" name="event_type" value="OWN_GOAL" />
              <label>Joueur<select name="primary_player_id" required>{sheet.map((p) => <option key={p.playerId} value={p.playerId}>{p.displayName}</option>)}</select></label>
              <label>Minute (facultatif)<input type="number" name="minute" min="0" max="130" /></label>
              <label>Temps additionnel<input type="number" name="added_time" min="0" max="15" /></label>
              <button className="button">Ajouter le CSC</button>
            </form>
          </details>

          <details className="match-form">
            <summary>Ajouter un carton</summary>
            <form action={createMatchEvent} className="roster-form">
              <input type="hidden" name="club_id" value={side.clubId} />
              <input type="hidden" name="match_id" value={matchId} />
              <input type="hidden" name="team_season_id" value={side.teamSeasonId} />
              <label>Joueur<select name="primary_player_id" required>{sheet.map((p) => <option key={p.playerId} value={p.playerId}>{p.displayName}</option>)}</select></label>
              <label>Type<select name="event_type" defaultValue="YELLOW_CARD"><option value="YELLOW_CARD">Jaune</option><option value="RED_CARD">Rouge</option></select></label>
              <label>Type de rouge (si rouge)<select name="card_kind" defaultValue="DIRECT"><option value="DIRECT">Direct</option><option value="SECOND_YELLOW">Deuxième jaune</option><option value="UNKNOWN">Inconnu</option></select></label>
              <label>Minute (facultatif)<input type="number" name="minute" min="0" max="130" /></label>
              <label>Temps additionnel<input type="number" name="added_time" min="0" max="15" /></label>
              <button className="button">Ajouter le carton</button>
            </form>
          </details>

          <details className="match-form">
            <summary>Ajouter un remplacement</summary>
            <form action={createMatchEvent} className="roster-form">
              <input type="hidden" name="club_id" value={side.clubId} />
              <input type="hidden" name="match_id" value={matchId} />
              <input type="hidden" name="team_season_id" value={side.teamSeasonId} />
              <input type="hidden" name="event_type" value="SUBSTITUTION" />
              <label>Sortant<select name="primary_player_id" required>{sheet.map((p) => <option key={p.playerId} value={p.playerId}>{p.displayName}</option>)}</select></label>
              <label>Entrant<select name="secondary_player_id" required>{sheet.map((p) => <option key={p.playerId} value={p.playerId}>{p.displayName}</option>)}</select></label>
              <label>Minute (facultatif)<input type="number" name="minute" min="0" max="130" /></label>
              <button className="button">Ajouter le remplacement</button>
            </form>
          </details>
        </div>
      )}
    </main>
  );
}
