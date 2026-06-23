import { Link } from "react-router-dom";
import { Target, Star, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PortalStatusBadge, PortalContactButton } from "@/components/PortalStatus";
import { MarketPayLogButton } from "@/components/MarketPayLogButton";
import CoachNotes from "@/components/CoachNotes";
import { useTargetBoard } from "@/hooks/useTargetBoard";
import { useHighFollow } from "@/hooks/useHighFollow";
import type { PlayerSourceIdResult } from "@/hooks/usePlayerSourceId";

/**
 * Shared identity strip for the Season Stats pages — mirrors the layout
 * and functionality of PlayerProfile / PitcherProfile's header.
 *
 * Row 1 — badges:    position / TWP / school / conf / portal status
 * Row 2 — actions:   Portal Contact | Market Pay | Coach Notes | Target Board | High Follow | View Full Report
 *
 * Export Report PDF lives only on the Profile page (depends on derived
 * projection + scouting state). The "View Full Report" link routes the
 * coach there to fire the same export.
 */
export function PlayerStatsHeader({
  player,
  kind,
  pitcherRole,
  profileHref,
}: {
  player: PlayerSourceIdResult;
  kind: "hitter" | "pitcher";
  pitcherRole?: string | null;
  profileHref: string;
}) {
  const { isOnBoard, addPlayer: addToBoard, removePlayer: removeFromBoard } = useTargetBoard();
  const { isOnList: isOnHighFollow, addPlayer: addToHighFollow, removePlayer: removeFromHighFollow } =
    useHighFollow();

  const playerId = player.id;
  const fullName = `${player.firstName ?? ""} ${player.lastName ?? ""}`.trim();

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mt-1">
        {player.position && (
          <Badge variant="secondary" className="text-xs uppercase tracking-wider">
            {player.position}
          </Badge>
        )}
        {kind === "pitcher" && pitcherRole && (
          <Badge
            variant="outline"
            className="text-xs uppercase tracking-wider border-[#D4AF37]/40 text-[#D4AF37]"
          >
            {pitcherRole}
          </Badge>
        )}
        {player.isTwp && (
          <Badge
            variant="outline"
            className="text-[10px] font-semibold uppercase tracking-wider border-[#D4AF37]/40 bg-[#D4AF37]/10 text-[#D4AF37]"
            title="Two-way player — also appears in the pitcher pool"
          >
            TWP
          </Badge>
        )}
        {player.schoolName && <Badge variant="outline" className="text-xs">{player.schoolName}</Badge>}
        {player.conference && (
          <Badge variant="outline" className="text-xs text-muted-foreground">
            {player.conference}
          </Badge>
        )}
        {(player.portalStatus === null || player.portalStatus === "NOT IN PORTAL") ? (
          <Badge className="bg-muted text-muted-foreground border-0 text-[10px] font-semibold uppercase tracking-wider">
            Not In Portal
          </Badge>
        ) : (
          <PortalStatusBadge
            player={{
              portal_status: player.portalStatus,
              portal_entry_date: player.portalEntryDate,
              commit_school: player.commitSchool,
              commit_date: player.commitDate,
            }}
            isAdmin={false}
          />
        )}
      </div>

      {playerId && (
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <PortalContactButton
            player={{
              portal_status: player.portalStatus,
              athletic_aid: player.athleticAid,
              contact_cell: player.contactCell,
              contact_email: player.contactEmail,
              gpa: player.gpa,
              va_roster_link: player.vaRosterLink,
            }}
          />
          <MarketPayLogButton playerId={playerId} />
          <CoachNotes playerId={playerId} playerName={fullName} />
          <Button
            variant={isOnBoard(playerId) ? "default" : "outline"}
            size="sm"
            className="cursor-pointer"
            onClick={() => {
              if (isOnBoard(playerId)) removeFromBoard(playerId);
              else addToBoard({ playerId });
            }}
          >
            <Target className="mr-2 h-3.5 w-3.5" />
            {isOnBoard(playerId) ? "On Board" : "Add to Target Board"}
          </Button>
          <Button
            variant={isOnHighFollow(playerId) ? "default" : "outline"}
            size="sm"
            className="cursor-pointer"
            onClick={() => {
              if (isOnHighFollow(playerId)) removeFromHighFollow(playerId);
              else addToHighFollow({ playerId, playerType: kind });
            }}
          >
            <Star className="mr-2 h-3.5 w-3.5" />
            {isOnHighFollow(playerId) ? "On High Follow" : "Add to High Follow"}
          </Button>
          <Button variant="outline" size="sm" className="cursor-pointer" asChild>
            <Link to={profileHref}>
              <ExternalLink className="mr-2 h-3.5 w-3.5" />
              View Full Report
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
