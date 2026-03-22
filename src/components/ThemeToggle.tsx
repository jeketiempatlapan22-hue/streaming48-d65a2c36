import { useState, useEffect } from "react";
import { Sun, Moon } from "lucide-react";

const ThemeToggle = ({ className = "" }: { className?: string }) => {
  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem("theme");
    if (stored) return stored === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.classList.toggle("light", !dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  return (
    <button
      onClick={() => setDark(d => !d)}
      className={`flex h-9 w-9 items-center justify-center rounded-lg transition-all hover:bg-secondary active:scale-[0.95] ${className}`}
      title={dark ? "Light mode" : "Dark mode"}
    >
      {dark ? <Sun className="h-4 w-4 text-[hsl(var(--warning))]" /> : <Moon className="h-4 w-4 text-primary" />}
    </button>
  );
};

export default ThemeToggle;
