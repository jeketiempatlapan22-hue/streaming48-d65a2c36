import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

interface MemberPhoto {
  name: string;
  photo_url: string | null;
}

interface LineupAvatarsProps {
  showId?: string;
}

/**
 * Parse lineup text into individual member names.
 * Supports formats like: "Freya, Zee, Christy" or "Freya - Zee - Christy"
 * or multi-line, or "1. Freya 2. Zee"
 */
function parseLineup(lineup: string): string[] {
  if (!lineup?.trim()) return [];
  
  // Split by common delimiters: comma, dash, newline, bullet, numbered list
  const names = lineup
    .split(/[,\n\r•|]+/)
    .flatMap(part => part.split(/\s*[-–—]\s*/))
    .map(n => n.replace(/^\d+[\.\)]\s*/, "").trim())
    .filter(n => n.length > 0 && n.length < 50);

  // Deduplicate (case-insensitive)
  const seen = new Set<string>();
  return names.filter(n => {
    const key = n.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const LineupAvatars = ({ showId }: LineupAvatarsProps) => {
  const [memberPhotos, setMemberPhotos] = useState<MemberPhoto[]>([]);
  const [lineupNames, setLineupNames] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      // Fetch all member photos
      const { data: photos } = await supabase
        .from("member_photos")
        .select("name, photo_url");
      
      setMemberPhotos(photos || []);

      // Fetch active show lineup
      if (showId) {
        // Use RPC to get show data safely (shows table is admin-only)
        const { data: shows } = await supabase.rpc("get_public_shows");
        const show = (shows as any[])?.find((s: any) => s.id === showId);
        if (show?.lineup) {
          setLineupNames(parseLineup(show.lineup));
        }
      } else {
        // Try to get from site_settings active_show_id
        const { data: settings } = await supabase
          .from("site_settings")
          .select("key, value")
          .eq("key", "active_show_id")
          .maybeSingle();
        
        if (settings?.value) {
          const { data: shows } = await supabase.rpc("get_public_shows");
          const show = (shows as any[])?.find((s: any) => s.id === settings.value);
          if (show?.lineup) {
            setLineupNames(parseLineup(show.lineup));
          }
        }
      }
      setLoaded(true);
    };

    fetchData();
  }, [showId]);

  if (!loaded || lineupNames.length === 0) return null;

  // Match lineup names to photos (case-insensitive)
  const photoMap = new Map(
    memberPhotos.map(p => [p.name.toLowerCase(), p.photo_url])
  );

  return (
    <div className="border-t border-border px-3 py-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Lineup</span>
        <div className="h-px flex-1 bg-border" />
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-thin">
        {lineupNames.map((name) => {
          const photoUrl = photoMap.get(name.toLowerCase());
          return (
            <div
              key={name}
              className="flex flex-col items-center gap-1.5 flex-shrink-0 min-w-[56px] max-w-[64px]"
            >
              <Avatar className="h-12 w-12 border-2 border-primary/30 shadow-[0_0_8px_hsl(var(--primary)/0.15)]">
                {photoUrl ? (
                  <AvatarImage src={photoUrl} alt={name} className="object-cover" />
                ) : null}
                <AvatarFallback className="bg-secondary text-sm font-bold text-muted-foreground">
                  {name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="text-[10px] font-medium text-foreground text-center leading-tight truncate w-full">
                {name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default LineupAvatars;
