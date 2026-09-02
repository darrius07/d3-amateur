import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getEligiblePlayers, getMatchLineupEntries, resolveOwnedMatchSide } from '@/lib/matches/lineup-data';
import { formatKickoffParis } from '@/lib/matches/identity';
import { LineupEditor } from './lineup-editor';

type Props = { params: Promise<{ matchId: string }>; searchParams: Promise<{ message?: string }> };

export default async function ManageLineupPage({ params, searchParams }: Props) {
  const { matchId } = await params;
  const { message } = await searchParams;
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) redirect(`/login?returnTo=/club-studio/matches/${matchId}/lineup`);

  const side = await resolveOwnedMatchSide(matchId, user.id);
  if (!side) notFound();

  const [eligiblePlayers, existing] = await Promise.all([
    getEligiblePlayers(side.clubId, side.seasonId, side.teamSeasonId),
    getMatchLineupEntries(matchId, side.teamSeasonId),
  ]);

  return (
    <main className="main studio">
      <Link className="back-link" href="/club-studio">← Retour au Club Studio</Link>
      <p className="eyebrow">Feuille de match</p>
      <h1>{side.teamDisplayName} vs {side.opponentLabel}</h1>
      <p>{formatKickoffParis(side.kickoffAt)}</p>
      <LineupEditor
        clubId={side.clubId}
        matchId={matchId}
        teamSeasonId={side.teamSeasonId}
        initialEntries={existing}
        eligiblePlayers={eligiblePlayers}
        savedMessage={message === 'lineup-saved'}
      />
    </main>
  );
}
