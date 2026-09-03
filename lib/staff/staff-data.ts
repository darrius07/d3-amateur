import { createAdminClient } from "@/lib/supabase/admin";
import type { StaffMember, StaffRole } from "./staff";

function mapRow(row: { id: string; team_season_id: string | null; display_name: string; role_type: string; custom_role: string | null; short_bio: string | null; public_visible?: boolean; sort_order: number }): StaffMember {
  return {
    id: row.id,
    teamSeasonId: row.team_season_id,
    displayName: row.display_name,
    role: row.role_type as StaffRole,
    customRole: row.custom_role,
    shortBio: row.short_bio,
    publicVisible: row.public_visible ?? true,
    sortOrder: row.sort_order,
  };
}

/** Club Studio management list: every ACTIVE staff row (public or not -- the OWNER manages both), never the deactivated ones (mission section 19: deactivating removes a person from the current staff view, public or Studio). Admin client -- this is the OWNER's own management surface, not the public one. */
export async function getClubStaffForStudio(clubId: string): Promise<StaffMember[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("club_staff")
    .select("id,team_season_id,display_name,role_type,custom_role,short_bio,public_visible,sort_order")
    .eq("club_id", clubId)
    .eq("active", true);
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

/** Public surface: club_staff_public already filters active+public_visible and hides every internal column -- nothing further to check here. */
export async function getPublicClubStaff(clubId: string): Promise<StaffMember[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("club_staff_public")
    .select("id,team_season_id,display_name,role_type,custom_role,short_bio,sort_order")
    .eq("club_id", clubId);
  if (error) throw error;
  return (data ?? []).map((row) => mapRow({ ...row, public_visible: true }));
}

export interface StaffTeamOption {
  id: string; // team_season_id -- the grouping key club_staff.team_season_id actually uses
  label: string;
  teamRank: number | null;
}

/** Active Seniors teams for this club, ordered -- used both as the "Équipe" select in the add/edit form and as the grouping/ordering for "Encadrement sportif". One batched query, no N+1. */
export async function getClubTeamsForStaff(clubId: string): Promise<StaffTeamOption[]> {
  const admin = createAdminClient();
  const { data: teams, error } = await admin
    .from("teams")
    .select("id,display_name,team_rank")
    .eq("club_id", clubId)
    .eq("active", true)
    .order("team_rank");
  if (error) throw error;
  if (!teams?.length) return [];
  const { data: teamSeasons } = await admin
    .from("team_seasons")
    .select("id,team_id")
    .in("team_id", teams.map((t) => t.id))
    .order("created_at", { ascending: false });
  const latestByTeam = new Map<string, string>();
  for (const ts of teamSeasons ?? []) if (!latestByTeam.has(ts.team_id)) latestByTeam.set(ts.team_id, ts.id);
  return teams
    .filter((t) => latestByTeam.has(t.id))
    .map((t) => ({ id: latestByTeam.get(t.id)!, label: t.display_name, teamRank: t.team_rank }));
}
