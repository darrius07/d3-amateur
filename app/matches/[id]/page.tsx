import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getMatch } from '@/lib/matches/data';
import { getPublicMatchLineups, type PublicLineupEntry } from '@/lib/matches/lineup-data';
import { getPublicMatchTimeline } from '@/lib/matches/events-data';
import { formatKickoffParis } from '@/lib/matches/identity';
import { buildScorers, formatMinute } from '@/lib/matches/events';

type Props = { params: Promise<{ id: string }> };

const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: 'À venir',
  PLAYED: 'Joué',
  POSTPONED: 'Reporté',
  CANCELLED: 'Annulé',
};

const EVENT_LABELS: Record<string, string> = {
  GOAL: '⚽ But', OWN_GOAL: '⚽ Contre son camp', YELLOW_CARD: '🟨 Carton jaune', RED_CARD: '🔴 Carton rouge', SUBSTITUTION: '🔄 Remplacement',
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const match = await getMatch((await params).id);
  return match
    ? { title: `${match.homeDisplayName} – ${match.awayDisplayName} · D3 Amateur`, description: `Match D3 Amateur : ${match.homeDisplayName} vs ${match.awayDisplayName}.` }
    : { title: 'Match introuvable · D3 Amateur' };
}

function LineupSide({ title, starters, bench }: { title: string; starters: PublicLineupEntry[]; bench: PublicLineupEntry[] }) {
  if (starters.length === 0 && bench.length === 0) {
    return (
      <div className="lineup-side">
        <h3>{title}</h3>
        <p className="empty">Composition non renseignée.</p>
      </div>
    );
  }
  return (
    <div className="lineup-side">
      <h3>{title}</h3>
      <h4>Titulaires</h4>
      {starters.length ? (
        <ul className="public-lineup-list">
          {starters.map((p) => (
            <li key={p.playerId}>
              <span>{p.squadNumber ?? '—'}</span>
              <Link href={`/players/${p.slug}`}>{p.displayName}</Link>
              {p.position && <small>{p.position}</small>}
            </li>
          ))}
        </ul>
      ) : <p className="empty">Aucun titulaire renseigné.</p>}
      <h4>Remplaçants</h4>
      {bench.length ? (
        <ul className="public-lineup-list">
          {bench.map((p) => (
            <li key={p.playerId}>
              <span>{p.squadNumber ?? '—'}</span>
              <Link href={`/players/${p.slug}`}>{p.displayName}</Link>
              {p.position && <small>{p.position}</small>}
            </li>
          ))}
        </ul>
      ) : <p className="empty">Aucun remplaçant renseigné.</p>}
    </div>
  );
}

export default async function MatchPage({ params }: Props) {
  const match = await getMatch((await params).id);
  if (!match) notFound();
  const [lineups, timeline] = await Promise.all([
    getPublicMatchLineups(match.id, match.homeTeamSeasonId, match.awayTeamSeasonId),
    getPublicMatchTimeline(match.id, match.homeTeamSeasonId, match.awayTeamSeasonId),
  ]);
  const scorers = buildScorers(timeline);

  const played = match.status === 'PLAYED';
  const backHref = match.homeSlug ? `/clubs/${match.homeSlug}` : match.awaySlug ? `/clubs/${match.awaySlug}` : '/clubs';
  const hasAnyLineup = lineups.home.starters.length + lineups.home.bench.length + lineups.away.starters.length + lineups.away.bench.length > 0;

  return (
    <main className="main match-page">
      <Link className="back-link" href={backHref}>← Retour au club</Link>

      <section className="match-hero">
        <div className="match-teams">
          <div className="match-team">
            {match.homeLogoUrl ? <Image unoptimized width={72} height={72} className="club-logo-sm" src={match.homeLogoUrl} alt={`Logo ${match.homeDisplayName}`} /> : <div className="club-logo" aria-label="Logo indisponible">D3</div>}
            {match.homeSlug ? <Link href={`/clubs/${match.homeSlug}`}><strong>{match.homeDisplayName}</strong></Link> : <strong>{match.homeDisplayName}</strong>}
          </div>
          <div className="match-score">
            {played ? <span className="score">{match.homeScore} – {match.awayScore}</span> : <span className="vs">vs</span>}
            <span className={`match-status status-${match.status.toLowerCase()}`}>{STATUS_LABELS[match.status] ?? match.status}</span>
          </div>
          <div className="match-team">
            {match.awayLogoUrl ? <Image unoptimized width={72} height={72} className="club-logo-sm" src={match.awayLogoUrl} alt={`Logo ${match.awayDisplayName}`} /> : <div className="club-logo" aria-label="Logo indisponible">D3</div>}
            {match.awaySlug ? <Link href={`/clubs/${match.awaySlug}`}><strong>{match.awayDisplayName}</strong></Link> : <strong>{match.awayDisplayName}</strong>}
          </div>
        </div>
        <p className="match-meta">
          {formatKickoffParis(match.kickoffAt)}
          {match.venueName ? ` · ${match.venueName}` : ''}
          {match.competitionName ? ` · ${match.competitionName}` : ''}
          {match.seasonLabel ? ` · Saison ${match.seasonLabel}` : ''}
        </p>
        {played && <p className="source-note">Résultat renseigné par le club</p>}
      </section>

      <div className="match-grid">
        <section className="panel">
          <h2>Composition</h2>
          {hasAnyLineup && <p className="source-note">Composition renseignée par le club</p>}
          <div className="lineup-sides">
            <LineupSide title={match.homeDisplayName} starters={lineups.home.starters} bench={lineups.home.bench} />
            <LineupSide title={match.awayDisplayName} starters={lineups.away.starters} bench={lineups.away.bench} />
          </div>
        </section>
        <section className="panel">
          <h2>Buteurs</h2>
          {scorers.length ? (
            <>
              <p className="source-note">Événements renseignés par le club</p>
              <ul className="scorers-list">
                {scorers.map((s) => (
                  <li key={s.playerId}>
                    {s.playerSlug ? <Link href={`/players/${s.playerSlug}`}>{s.playerName}</Link> : <span>{s.playerName}</span>}
                    {' — '}
                    {s.goals.map((g, i) => (
                      <span key={i}>{i > 0 ? ', ' : ''}{formatMinute(g.minute, g.addedTime)}{g.ownGoal ? ' (CSC)' : ''}</span>
                    ))}
                  </li>
                ))}
              </ul>
            </>
          ) : <p className="empty">Aucun but documenté pour le moment.</p>}
        </section>
        <section className="panel">
          <h2>Événements</h2>
          {timeline.length ? (
            <>
              <p className="source-note">Événements renseignés par le club</p>
              <ul className="event-timeline-list">
                {timeline.map((event) => (
                  <li key={event.id}>
                    <strong>{formatMinute(event.minute, event.addedTime)}</strong>
                    {' — '}
                    <span>{EVENT_LABELS[event.eventType] ?? event.eventType}</span>
                    {' — '}
                    {event.eventType === 'SUBSTITUTION' ? (
                      <span>
                        {event.primaryPlayerSlug ? <Link href={`/players/${event.primaryPlayerSlug}`}>{event.primaryPlayerName}</Link> : event.primaryPlayerName} sort ·{' '}
                        {event.secondaryPlayerSlug ? <Link href={`/players/${event.secondaryPlayerSlug}`}>{event.secondaryPlayerName}</Link> : event.secondaryPlayerName} entre
                      </span>
                    ) : (
                      <>
                        {event.primaryPlayerSlug ? <Link href={`/players/${event.primaryPlayerSlug}`}>{event.primaryPlayerName}</Link> : <span>{event.primaryPlayerName}</span>}
                        {event.eventType === 'GOAL' && event.secondaryPlayerName && (
                          <small> · Passe : {event.secondaryPlayerSlug ? <Link href={`/players/${event.secondaryPlayerSlug}`}>{event.secondaryPlayerName}</Link> : event.secondaryPlayerName}</small>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : <p className="empty">Les détails joueurs seront disponibles lorsque le club aura complété la feuille de match.</p>}
        </section>
      </div>
    </main>
  );
}
