export type ThemeMode = "light" | "dark";

export const THEME_STORAGE_KEY = "pineapple-theme";

export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  return mode === "dark" ? "dark" : "light";
}

export function readStoredThemeMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }

  const raw = localStorage.getItem(THEME_STORAGE_KEY);
  if (raw === "dark") return "dark";
  if (raw === "light") return "light";

  // Fallback: respect OS preference once on first visit, then stick to chosen.
  if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

export function persistThemeMode(mode: ThemeMode) {
  if (typeof window === "undefined") return;
  localStorage.setItem(THEME_STORAGE_KEY, mode);
  document.documentElement.setAttribute("data-theme", mode);
}
