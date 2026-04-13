import { SHOW_TEAMS } from "@/types/show";

interface TeamBadgeProps {
  team?: string | null;
  size?: "sm" | "md";
}

const TeamBadge = ({ team, size = "sm" }: TeamBadgeProps) => {
  if (!team) return null;
  const config = SHOW_TEAMS[team.toLowerCase()];
  if (!config) return null;

  const sizeClasses = size === "sm"
    ? "px-2.5 py-0.5 text-[10px] gap-1"
    : "px-3 py-1 text-xs gap-1.5";

  return (
    <span
      className={`inline-flex items-center rounded-full bg-gradient-to-r ${config.gradient} font-bold text-white shadow-md ${sizeClasses} w-fit`}
    >
      <span>{config.icon}</span>
      <span>{config.label}</span>
    </span>
  );
};

export default TeamBadge;
