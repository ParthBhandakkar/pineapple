"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { readStoredThemeMode } from "@/lib/theme";

export function ThemeRoot({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    const mode = readStoredThemeMode();
    document.documentElement.setAttribute("data-theme", mode);
  }, [pathname]);

  return children;
}
