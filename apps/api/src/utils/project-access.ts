import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns the list of project IDs the user has access to.
 * Returns `null` for ADMIN (no filtering needed).
 * Returns an array of UUIDs for WORKER.
 */
export async function getUserProjectIds(
  supabase: SupabaseClient,
  profileId: string,
  role: string,
): Promise<string[] | null> {
  if (role === "ADMIN") return null;

  const { data, error } = await supabase
    .from("user_projects")
    .select("project_id")
    .eq("user_id", profileId);

  if (error) {
    throw error;
  }

  return (data ?? []).map((r) => r.project_id);
}

/** Sentinel UUID used when projectIds array is empty to prevent `.in()` from matching everything */
const EMPTY_SENTINEL = "00000000-0000-0000-0000-000000000000";

/**
 * Returns the array to pass to `.in("project_id", ...)`.
 * If projectIds is null (admin), returns null (skip filter).
 * If projectIds is empty, returns sentinel to match nothing.
 */
export function projectIdsForFilter(projectIds: string[] | null): string[] | null {
  if (projectIds === null) return null;
  return projectIds.length > 0 ? projectIds : [EMPTY_SENTINEL];
}
