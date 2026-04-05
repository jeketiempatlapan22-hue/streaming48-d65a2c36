import { Play, type LucideIcon } from "lucide-react";

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
  if (!playlists.length) return null;

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {playlists.map((playlist) => {
        const active = playlist.id === activePlaylistId;

        return (
          <button
            key={playlist.id}
            type="button"
            onClick={() => onSelect(playlist)}
            aria-pressed={active}
            className={`group flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all duration-200 ${
              active
                ? "bg-primary text-primary-foreground shadow-md shadow-primary/25"
                : "border border-border bg-card/80 text-muted-foreground hover:border-primary/40 hover:text-foreground"
            }`}
          >
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors ${
                active
                  ? "bg-primary-foreground/20 text-primary-foreground"
                  : "bg-secondary text-muted-foreground group-hover:text-foreground"
              }`}
            >
              <Play className="h-3 w-3" />
            </span>
            <span className="truncate max-w-[120px]">{playlist.title}</span>
          </button>
        );
      })}
    </div>
  );
};

export default PlaylistSwitcher;
