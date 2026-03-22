import type { SupabaseClient } from "@supabase/supabase-js";

type DictionaryType = "work_types" | "contractors" | "own_forces";

const TABLE_MAP: Record<DictionaryType, string> = {
  work_types: "work_types",
  contractors: "contractors",
  own_forces: "own_forces",
};

/**
 * Normalize a dictionary value to its canonical name.
 *
 * Rules (in order):
 * 1. Active exact match (case-insensitive) → return canonical name
 * 2. Alias match → return canonical name of the item
 * 3. Inactive exact match → reactivate + return canonical name
 * 4. Unknown → create new active entry + return name
 */
export async function normalizeDictionaryValue(
  supabase: SupabaseClient,
  type: DictionaryType,
  name: string,
): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) return "";

  const tableName = TABLE_MAP[type];

  // 1. Check active exact match (case-insensitive)
  const { data: activeMatch } = await supabase
    .from(tableName)
    .select("id, name, is_active")
    .ilike("name", trimmed)
    .maybeSingle();

  if (activeMatch) {
    if (!activeMatch.is_active) {
      // 3. Inactive match → reactivate
      await supabase
        .from(tableName)
        .update({ is_active: true, updated_at: new Date().toISOString() })
        .eq("id", activeMatch.id);
    }
    return activeMatch.name; // Return canonical name (preserving original case)
  }

  // 2. Check alias match
  const { data: aliasMatch } = await supabase
    .from("dictionary_aliases")
    .select("item_id")
    .eq("dictionary_type", type)
    .ilike("alias_name", trimmed)
    .maybeSingle();

  if (aliasMatch) {
    const { data: item } = await supabase
      .from(tableName)
      .select("name, is_active")
      .eq("id", aliasMatch.item_id)
      .maybeSingle();

    if (item) {
      if (!item.is_active) {
        await supabase
          .from(tableName)
          .update({ is_active: true, updated_at: new Date().toISOString() })
          .eq("id", aliasMatch.item_id);
      }
      return item.name;
    }
  }

  // 4. Unknown → create new active entry
  const { data: created, error } = await supabase
    .from(tableName)
    .insert({ name: trimmed })
    .select("name")
    .single();

  if (error) {
    // Race condition: another request just created it
    if (error.code === "23505") {
      const { data: found } = await supabase
        .from(tableName)
        .select("name")
        .ilike("name", trimmed)
        .single();
      return found?.name ?? trimmed;
    }
    throw error;
  }

  return created.name;
}

/**
 * Normalize all dictionary values in a report payload.
 * Mutates nothing — returns normalized values.
 */
export async function normalizeReportDictionaries(
  supabase: SupabaseClient,
  workTypes: string[],
  contractor: string,
  ownForces: string,
): Promise<{ workTypes: string[]; contractor: string; ownForces: string }> {
  const [normalizedWorkTypes, normalizedContractor, normalizedOwnForces] = await Promise.all([
    Promise.all(workTypes.map((wt) => normalizeDictionaryValue(supabase, "work_types", wt))),
    normalizeDictionaryValue(supabase, "contractors", contractor),
    ownForces ? normalizeDictionaryValue(supabase, "own_forces", ownForces) : Promise.resolve(""),
  ]);

  return {
    workTypes: normalizedWorkTypes,
    contractor: normalizedContractor,
    ownForces: normalizedOwnForces,
  };
}
