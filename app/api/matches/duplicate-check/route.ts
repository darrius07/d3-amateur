import { NextResponse } from "next/server";
import { findMatchCandidates } from "@/lib/matches/data";
import { parisLocalToUtcIso } from "@/lib/matches/identity";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const teamSeasonId = url.searchParams.get("team_season_id");
  const opponentTeamSeasonId = url.searchParams.get("opponent_team_season_id") || null;
  const externalOpponentName = url.searchParams.get("external_opponent_name") || null;
  const kickoffLocal = url.searchParams.get("kickoff_local");
  if (!teamSeasonId || !kickoffLocal) return NextResponse.json({ candidates: [] });
  try {
    const kickoffAt = parisLocalToUtcIso(kickoffLocal);
    const candidates = await findMatchCandidates(teamSeasonId, opponentTeamSeasonId, externalOpponentName, kickoffAt);
    return NextResponse.json({ candidates });
  } catch {
    return NextResponse.json({ candidates: [] });
  }
}
