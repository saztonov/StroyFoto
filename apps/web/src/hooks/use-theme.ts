import { useCallback, useEffect, useSyncExternalStore } from "react";
import { db } from "../db/dexie";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "sf-theme";
const THEME_COLOR_LIGHT = "#2563eb";
const THEME_COLOR_DARK = "#1e293b";

// --------------- in-memory store ---------------
let currentTheme: Theme = readSync();
const listeners = new Set<() => void>();

function readSync(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* SSR / restricted */
  }
  return "system";
}

function notify() {
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): Theme {
  return currentTheme;
}

// --------------- resolved (actual light/dark) ---------------
function getSystemDark(): boolean {
  return typeof window !== "undefined" &&
    matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(theme: Theme): ResolvedTheme {
  if (theme === "system") return getSystemDark() ? "dark" : "light";
  return theme;
}

// --------------- DOM side-effects ---------------
function applyToDOM(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");

  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  if (meta) {
    meta.content = resolved === "dark" ? THEME_COLOR_DARK : THEME_COLOR_LIGHT;
  }
}

// Apply immediately on module load (backup for FOUC script)
applyToDOM(resolve(currentTheme));

// Listen to OS preference changes
if (typeof window !== "undefined") {
  matchMedia("(prefers-color-scheme: dark)").addEventListener(
    "change",
    () => {
      if (currentTheme === "system") {
        applyToDOM(resolve("system"));
        notify();
      }
    },
  );
}

// --------------- persistence ---------------
function persist(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* quota */
  }
  db.appSettings.put({ key: STORAGE_KEY, value: theme }).catch(() => {});
}

// On first load, reconcile Dexie → localStorage (Dexie is source of truth)
db.appSettings
  .get(STORAGE_KEY)
  .then((row) => {
    if (row && (row.value === "light" || row.value === "dark" || row.value === "system")) {
      const dexieTheme = row.value as Theme;
      if (dexieTheme !== currentTheme) {
        currentTheme = dexieTheme;
        try {
          localStorage.setItem(STORAGE_KEY, dexieTheme);
        } catch {
          /* */
        }
        applyToDOM(resolve(currentTheme));
        notify();
      }
    }
  })
  .catch(() => {});

// --------------- hook ---------------
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, () => "system" as Theme);
  const resolvedTheme = resolve(theme);

  useEffect(() => {
    applyToDOM(resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = useCallback((next: Theme) => {
    currentTheme = next;
    applyToDOM(resolve(next));
    persist(next);
    notify();
  }, []);

  return { theme, resolvedTheme, setTheme } as const;
}
