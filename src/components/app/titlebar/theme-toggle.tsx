import { cn } from "@/lib/utils";
import { themeTransition } from "@/lib/theme-transition";
import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState, type MouseEvent } from "react";

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div className={cn("size-8 shrink-0", className)} aria-hidden />
    );
  }

  const isDark = resolvedTheme === "dark";

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    const next = isDark ? "light" : "dark";
    void themeTransition(event, () => setTheme(next));
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center rounded-sm bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:bg-accent/80",
        className,
      )}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Light mode" : "Dark mode"}
    >
      <SunIcon
        strokeWidth={1.75}
        className={cn(
          "absolute size-3.5 transition-all duration-300 ease-out",
          isDark ? "scale-0 rotate-90 opacity-0" : "scale-100 rotate-0 opacity-100",
        )}
        aria-hidden
      />
      <MoonIcon
        strokeWidth={1.75}
        className={cn(
          "absolute size-3.5 transition-all duration-300 ease-out",
          isDark ? "scale-100 rotate-0 opacity-100" : "scale-0 -rotate-90 opacity-0",
        )}
        aria-hidden
      />
    </button>
  );
}
