import { db } from "./dexie";

type DictionaryTable = "workTypes" | "contractors" | "ownForces";

/**
 * Create a local dictionary item in Dexie with case-insensitive dedup.
 * Does nothing if an item with the same name (case-insensitive) already exists.
 */
export async function createLocalDictionaryItem(
  table: DictionaryTable,
  name: string,
  scopeProfileId: string,
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;

  const dexieTable = db[table];
  const existing = await dexieTable.toArray();
  const duplicate = existing.find(
    (item) => item.name.toLowerCase() === trimmed.toLowerCase(),
  );

  if (duplicate) return;

  await dexieTable.add({
    id: crypto.randomUUID(),
    name: trimmed,
    scopeProfileId,
    updatedAt: new Date(),
  });
}
