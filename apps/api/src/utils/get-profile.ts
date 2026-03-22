import type { SupabaseClient } from "@supabase/supabase-js";

interface Profile {
  id: string;
  email: string;
  role: string;
  fullName: string;
  authId: string;
}

// Simple in-memory cache: authId → profile (cleared on process restart)
const profileCache = new Map<string, { profile: Profile; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getProfileByAuthId(
  supabase: SupabaseClient,
  authId: string,
): Promise<Profile | null> {
  const cached = profileCache.get(authId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.profile;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, role, full_name, auth_id")
    .eq("auth_id", authId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const profile: Profile = {
    id: data.id,
    email: data.email,
    role: data.role,
    fullName: data.full_name,
    authId: data.auth_id,
  };

  profileCache.set(authId, {
    profile,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return profile;
}

/** Invalidate cached profile (e.g. after role change) */
export function invalidateProfileCache(authId?: string): void {
  if (authId) {
    profileCache.delete(authId);
  } else {
    profileCache.clear();
  }
}
