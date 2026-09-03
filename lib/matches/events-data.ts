import { createAdminClient } from "@/lib/supabase/admin";
import type { CardKind, GoalKind, MatchEventType } from "./events";
import { sortTimeline } from "./events";

export interface EditableEvent {
  id: string;
  eventType: MatchEventType;
  primaryPlayerId: string;
  primaryPlayerName: string;
  secondaryPlayerId: string | null;
  secondaryPlayerName: string | null;
  minute: number | null;
  addedTime: number | null;
  goalKind: GoalKind | null;
  cardKind: CardKind | null;
}

async function namesFor(admin: ReturnType<typeof createAdminClient>, playerIds: string[]): Promise<Map<string, { name: string; slug: string }>> {
  const map = new Map<string, { name: string; slug: string }>();
  if (!playerIds.length) return map;
  const { data } = await admin.from("players").select("id,display_name,slug").in("id", playerIds);
  for (const p of data ?? []) map.set(p.id, { name: p.display_name, slug: p.slug });
  return map;
}

/** Events for one team's side of a match, for the Club Studio editor. Two separate queries (events, then player names) rather than embedding two FKs to the same `players` table -- avoids needing PostgREST FK-name hints, same pattern as lib/matches/data.ts. */
export async function getTeamMatchEvents(matchId: string, teamSeasonId: string): Promise<EditableEvent[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("match_events")
    .select("id,event_type,primary_player_id,secondary_player_id,minute,added_time,goal_kind,card_kind")
    .eq("match_id", matchId)
    .eq("team_season_id", teamSeasonId);
  if (error) throw error;
  const playerIds = [...new Set((data ?? []).flatMap((e) => [e.primary_player_id, e.secondary_player_id]).filter((x): x is string => Boolean(x)))];
  const names = await namesFor(admin, playerIds);
  return (data ?? []).map((e) => ({
    id: e.id,
    eventType: e.event_type as MatchEventType,
    primaryPlayerId: e.primary_player_id,
    primaryPlayerName: names.get(e.primary_player_id)?.name ?? "",
    secondaryPlayerId: e.secondary_player_id,
    secondaryPlayerName: e.secondary_player_id ? (names.get(e.secondary_player_id)?.name ?? "") : null,
    minute: e.minute,
    addedTime: e.added_time,
    goalKind: e.goal_kind,
    cardKind: e.card_kind,
  }));
}

export interface PublicTimelineEvent {
  id: string;
  eventType: MatchEventType;
  side: "home" | "away";
  minute: number | null;
  addedTime: number | null;
  primaryPlayerId: string;
  primaryPlayerName: string;
  primaryPlayerSlug: string | null;
  secondaryPlayerName: string | null;
  secondaryPlayerSlug: string | null;
}

/** Full timeline across both sides for the public /matches/[id] page, sorted per mission section 17. Empty when no events are documented -- never a placeholder. */
export async function getPublicMatchTimeline(matchId: string, homeTeamSeasonId: string | null, awayTeamSeasonId: string | null): Promise<PublicTimelineEvent[]> {
  const admin = createAdminClient();
  const teamSeasonIds = [homeTeamSeasonId, awayTeamSeasonId].filter((x): x is string => Boolean(x));
  if (!teamSeasonIds.length) return [];

  const { data, error } = await admin
    .from("match_events")
    .select("id,event_type,team_season_id,primary_player_id,secondary_player_id,minute,added_time")
    .eq("match_id", matchId)
    .in("team_season_id", teamSeasonIds);
  if (error) throw error;

  const playerIds = [...new Set((data ?? []).flatMap((e) => [e.primary_player_id, e.secondary_player_id]).filter((x): x is string => Boolean(x)))];
  const names = await namesFor(admin, playerIds);

  const events: PublicTimelineEvent[] = (data ?? []).map((e) => ({
    id: e.id,
    eventType: e.event_type as MatchEventType,
    side: e.team_season_id === homeTeamSeasonId ? "home" : "away",
    minute: e.minute,
    addedTime: e.added_time,
    primaryPlayerId: e.primary_player_id,
    primaryPlayerName: names.get(e.primary_player_id)?.name ?? "",
    primaryPlayerSlug: names.get(e.primary_player_id)?.slug ?? null,
    secondaryPlayerName: e.secondary_player_id ? (names.get(e.secondary_player_id)?.name ?? null) : null,
    secondaryPlayerSlug: e.secondary_player_id ? (names.get(e.secondary_player_id)?.slug ?? null) : null,
  }));
  return sortTimeline(events);
}
