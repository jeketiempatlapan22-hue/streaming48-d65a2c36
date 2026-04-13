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
    ? "px-3 py-1 text-[10px] gap-1.5"
    : "px-4 py-1.5 text-xs gap-2";

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
