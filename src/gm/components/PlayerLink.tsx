import { Link } from "react-router-dom";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * A player's name that links to their GM player page (/gm/player/:id). Falls
 * back to plain text when there's no player_id (light local adds — freshmen /
 * walk-ons not in the DB). Stops click propagation so it works inside clickable
 * rows without triggering the row's own handler.
 */
export function PlayerLink({ playerId, name, className, style }: {
  playerId?: string | null; name: string; className?: string; style?: CSSProperties;
}) {
  if (!playerId) return <span className={className} style={style}>{name}</span>;
  return (
    <Link
      to={`/gm/player/${playerId}`}
      style={style}
      onClick={(e) => e.stopPropagation()}
      className={cn("hover:text-primary hover:underline", className)}
    >
      {name}
    </Link>
  );
}
