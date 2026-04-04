import { Cloud, Radio, Shield, Video, Youtube, type LucideIcon } from "lucide-react";

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

const typeMeta: Record<string, { label: string; icon: LucideIcon }> = {
  youtube: { label: "YouTube", icon: Youtube },
  m3u8: { label: "HLS Stream", icon: Radio },
  cloudflare: { label: "Cloudflare", icon: Cloud },
  proxy: { label: "Proxy Stream", icon: Shield },
};

const PlaylistSwitcher = ({ playlists, activePlaylistId, onSelect, className = "" }: PlaylistSwitcherProps) => {
  if (!playlists.length) return null;

  return (
    <div className={`flex snap-x gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}>
      {playlists.map((playlist) => {
        const active = playlist.id === activePlaylistId;
        const meta = typeMeta[playlist.type] || { label: playlist.type || "Sumber", icon: Video };
        const Icon = meta.icon;

        return (
          <button
            key={playlist.id}
            type="button"
            onClick={() => onSelect(playlist)}
            aria-pressed={active}
            className={`min-w-[152px] shrink-0 snap-start rounded-2xl border px-3.5 py-3 text-left transition-all duration-200 ${
              active
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : "border-border bg-card hover:border-primary/30 hover:bg-accent"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                      active ? "bg-primary-foreground/15 text-primary-foreground" : "bg-secondary text-secondary-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className={`truncate text-sm font-semibold ${active ? "text-primary-foreground" : "text-foreground"}`}>
                      {playlist.title}
                    </p>
                    <p className={`text-[11px] ${active ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                      {meta.label}
                    </p>
                  </div>
                </div>
              </div>
              <span
                className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                  active ? "bg-primary-foreground/15 text-primary-foreground" : "bg-secondary text-muted-foreground"
                }`}
              >
                {active ? "Aktif" : "Pilih"}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
};

export default PlaylistSwitcher;
