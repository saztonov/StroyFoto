import { useRef, useState, useEffect } from "react";
import { db, type LocalReport } from "../db/dexie";

type DraftData = Omit<LocalReport, "clientId" | "syncStatus" | "createdAt" | "updatedAt">;

export function useAutosave(
  reportClientId: string,
  formData: DraftData | null,
) {
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!formData || !reportClientId) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      setIsSaving(true);
      try {
        const now = new Date();
        await db.reports.put({
          ...formData,
          clientId: reportClientId,
          syncStatus: "draft",
          createdAt: (await db.reports.get(reportClientId))?.createdAt ?? now,
          updatedAt: now,
        });
        setLastSavedAt(now);
      } catch {
        // silently fail for draft autosave
      } finally {
        setIsSaving(false);
      }
    }, 1500);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [reportClientId, formData]);

  return { isSaving, lastSavedAt };
}
