import { forwardRef } from "react";
import { SHOW_TEAMS } from "@/types/show";

interface TeamBadgeProps {
  team?: string | null;
  size?: "sm" | "md";
  className?: string;
}

const TeamBadge = forwardRef<HTMLSpanElement, TeamBadgeProps>(
  ({ team, size = "sm", className = "" }, ref) => {
    if (!team) return null;
    const config = SHOW_TEAMS[team.toLowerCase()];
    if (!config) return null;

    const sizeClasses = size === "sm"
      ? "px-3 py-1 text-[10px] gap-1.5"
      : "px-4 py-1.5 text-xs gap-2";

    return (
      <span
        ref={ref}
        className={`inline-flex items-center rounded-full bg-gradient-to-r ${config.gradient} font-bold text-white shadow-md ${sizeClasses} w-fit ${className}`}
      >
        <span>{config.icon}</span>
        <span>{config.label}</span>
      </span>
    );
  }
);

TeamBadge.displayName = "TeamBadge";

export default TeamBadge;
