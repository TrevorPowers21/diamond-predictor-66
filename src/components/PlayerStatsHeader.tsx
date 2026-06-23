import { Target, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PortalStatusBadge, PortalContactButton } from "@/components/PortalStatus";
import { MarketPayLogButton } from "@/components/MarketPayLogButton";
import CoachNotes from "@/components/CoachNotes";
import { useTargetBoard } from "@/hooks/useTargetBoard";
import { useHighFollow } from "@/hooks/useHighFollow";
import type { PlayerSourceIdResult } from "@/hooks/usePlayerSourceId";

/**
 * Shared identity strip for the Season Stats pages.
 *
 * Mirrors the layout of PlayerProfile / PitcherProfile:
 *   [name + badges row, flex-1] [CoachNotes][ToB][HighFollow][View Full Report]
 *
 * Badge order per kind matches the matching Profile page exactly:
 *   Hitter:  position · TWP · school · conf · portal · contact · pay
 *   Pitcher: school · conf · handedness (RHP/LHP) · TWP · portal · contact · pay
 *
 * Export Report PDF lives on Profile (depends on rich projection +
 * scouting state); View Full Report routes there to fire the same
 * download, keeping the PDF a single source of truth.
 */
export function PlayerStatsHeader({
  player,
  kind,
  playerName,
}: {
  player: PlayerSourceIdResult;
  kind: "hitter" | "pitcher";
  playerName: string;
}) {
  const { isOnBoard, addPlayer: addToBoard, removePlayer: removeFromBoard } = useTargetBoard();
  const { isOnList: isOnHighFollow, addPlayer: addToHighFollow, removePlayer: removeFromHighFollow } =
    useHighFollow();

  const playerId = player.id;
  const handednessLabel =
    player.throwsHand === "R" ? "RHP" : player.throwsHand === "L" ? "LHP" : null;

  const portalBadge =
    player.portalStatus === null || player.portalStatus === "NOT IN PORTAL" ? (
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
    );

  const twpBadge = player.isTwp && (
    <Badge
      variant="outline"
      className="text-[10px] font-semibold uppercase tracking-wider border-[#D4AF37]/40 bg-[#D4AF37]/10 text-[#D4AF37]"
      title={
        kind === "pitcher"
          ? "Two-way player — also appears in the hitter pool"
          : "Two-way player — also appears in the pitcher pool"
      }
    >
      TWP
    </Badge>
  );

  const portalContact = (
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
  );

  return (
    <div className="flex items-start gap-3">
      <div className="flex-1">
        <h2 className="text-2xl font-bold tracking-tight">{playerName}</h2>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {kind === "hitter" ? (
            <>
              {player.position && <Badge variant="secondary">{player.position}</Badge>}
              {player.schoolName && <Badge variant="outline">{player.schoolName}</Badge>}
              {player.conference && (
                <Badge variant="outline" className="text-muted-foreground">
                  {player.conference}
                </Badge>
              )}
              {portalBadge}
              {playerId && portalContact}
              {playerId && <MarketPayLogButton playerId={playerId} />}
              {twpBadge}
            </>
          ) : (
            <>
              {player.schoolName && <Badge variant="outline">{player.schoolName}</Badge>}
              {player.conference && (
                <Badge variant="outline" className="text-muted-foreground">
                  {player.conference}
                </Badge>
              )}
              {handednessLabel && <Badge variant="secondary">{handednessLabel}</Badge>}
              {portalBadge}
              {playerId && portalContact}
              {playerId && <MarketPayLogButton playerId={playerId} />}
              {twpBadge}
            </>
          )}
        </div>
      </div>

      {playerId && (
        <>
          <CoachNotes playerId={playerId} playerName={playerName} />
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
        </>
      )}
    </div>
  );
}
