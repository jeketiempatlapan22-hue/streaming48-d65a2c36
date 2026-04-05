import { Play } from "lucide-react";
import { useRef } from "react";

interface PlaylistItem {
  id: string;
  title: string;
  type: string;
}

interface PlaylistSwitcherProps {
  playlists: PlaylistItem[];
  activePlaylistId?: string | null;
  onSelect: (playlist: PlaylistItem) => void;
  className?: string;
}

const PlaylistSwitcher = ({ playlists, activePlaylistId, onSelect, className = "" }: PlaylistSwitcherProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  if (!playlists.length) return null;

  return (
    <div
      ref={scrollRef}
      className={`flex gap-2 overflow-x-auto scrollbar-hide snap-x snap-mandatory ${className}`}
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      {playlists.map((playlist) => {
        const active = playlist.id === activePlaylistId;

        return (
          <button
            key={playlist.id}
            type="button"
            onClick={() => onSelect(playlist)}
            aria-pressed={active}
            className={`snap-start shrink-0 flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 ${
              active
                ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                : "border border-border bg-card/80 text-muted-foreground hover:border-primary/40 hover:text-foreground"
            }`}
          >
            <Play className="h-3 w-3 shrink-0" />
            <span className="truncate max-w-[100px]">{playlist.title}</span>
          </button>
        );
      })}
    </div>
  );
};

export default PlaylistSwitcher;
