import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getMatch } from '@/lib/matches/data';
import { formatKickoffParis } from '@/lib/matches/identity';

type Props = { params: Promise<{ id: string }> };

const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: 'À venir',
  PLAYED: 'Joué',
  POSTPONED: 'Reporté',
  CANCELLED: 'Annulé',
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const match = await getMatch((await params).id);
  return match
    ? { title: `${match.homeDisplayName} – ${match.awayDisplayName} · D3 Amateur`, description: `Match D3 Amateur : ${match.homeDisplayName} vs ${match.awayDisplayName}.` }
    : { title: 'Match introuvable · D3 Amateur' };
}

export default async function MatchPage({ params }: Props) {
  const match = await getMatch((await params).id);
  if (!match) notFound();

  const played = match.status === 'PLAYED';
  const backHref = match.homeSlug ? `/clubs/${match.homeSlug}` : match.awaySlug ? `/clubs/${match.awaySlug}` : '/clubs';

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
          <p className="empty">Les détails joueurs seront disponibles lorsque le club aura complété la feuille de match.</p>
        </section>
        <section className="panel">
          <h2>Buteurs</h2>
          <p className="empty">Les détails joueurs seront disponibles lorsque le club aura complété la feuille de match.</p>
        </section>
        <section className="panel">
          <h2>Événements</h2>
          <p className="empty">Les détails joueurs seront disponibles lorsque le club aura complété la feuille de match.</p>
        </section>
      </div>
    </main>
  );
}
