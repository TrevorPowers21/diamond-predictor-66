import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { depthKey, getPlayerName, classColor, playerCurrentClass } from "../helpers";
import type { BuildPlayer } from "../types";

interface EligiblePlayer { rp: BuildPlayer; idx: number; }

interface DepthTabProps {
  eligiblePositionPlayers: EligiblePlayer[];
  eligiblePitchers: EligiblePlayer[];
  depthAssignments: Record<string, number>;
  depthPlaceholders: Record<string, string>;
  rosterPlayers: BuildPlayer[];
  assignDepthSlot: (slot: string, depth: number, value: string) => void;
}

export default function DepthTab({
  eligiblePositionPlayers,
  eligiblePitchers,
  depthAssignments,
  depthPlaceholders,
  rosterPlayers,
  assignDepthSlot,
}: DepthTabProps) {
  const renderDepthStack = (slot: string, eligible: EligiblePlayer[], className: string) => (
    <div className={`absolute -translate-x-1/2 ${className}`}>
      <p className="mb-1 text-[10px] font-semibold tracking-wide text-slate-700 text-center">{slot}</p>
      <div className="w-[106px] space-y-1">
        {[1, 2, 3].map((depth) => {
          const currentIdx = depthAssignments[depthKey(slot, depth)];
          const placeholder = depthPlaceholders[depthKey(slot, depth)] ?? null;
          const selectedPlayer = currentIdx != null ? rosterPlayers[currentIdx] : null;
          const cy = playerCurrentClass(selectedPlayer);
          const isPlaceholder = placeholder === "freshman" || placeholder === "transfer";
          const colorCls = currentIdx != null ? classColor(cy) : isPlaceholder ? classColor(null, true) : "border-slate-300 bg-white text-black";
          return (
            <Select key={`${slot}-${depth}`} value={currentIdx != null ? String(currentIdx) : (placeholder ?? "none")} onValueChange={(v) => assignDepthSlot(slot, depth, v)}>
              <SelectTrigger className={`h-6 rounded-sm px-1 text-[10px] shadow-sm ${colorCls}`}>
                <SelectValue placeholder={`${depth}`} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                <SelectItem value="freshman">Freshman</SelectItem>
                <SelectItem value="transfer">Transfer</SelectItem>
                {eligible.map(({ rp, idx }) => (
                  <SelectItem key={`${slot}-${depth}-${idx}`} value={String(idx)}>
                    {getPlayerName(rp)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        })}
      </div>
    </div>
  );

  const renderStartingRotationStack = (eligible: EligiblePlayer[], className: string) => (
    <div className={`absolute -translate-x-1/2 ${className}`}>
      <p className="mb-1 text-[10px] font-semibold tracking-wide text-slate-700 text-center">Starting Rotation</p>
      <div className="w-[120px] space-y-1">
        {[1, 2, 3, 4, 5].map((sp) => {
          const slot = `SP${sp}`;
          const currentIdx = depthAssignments[depthKey(slot, 1)];
          const placeholder = depthPlaceholders[depthKey(slot, 1)] ?? null;
          const selectedPlayer = currentIdx != null ? rosterPlayers[currentIdx] : null;
          const colorCls = currentIdx != null ? classColor(playerCurrentClass(selectedPlayer)) : "border-slate-300 bg-white text-black";
          return (
            <Select key={slot} value={currentIdx != null ? String(currentIdx) : (placeholder ?? "none")} onValueChange={(v) => assignDepthSlot(slot, 1, v)}>
              <SelectTrigger className={`h-6 rounded-sm px-1 text-[10px] shadow-sm ${colorCls}`}>
                <SelectValue placeholder={slot} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                <SelectItem value="freshman">Freshman</SelectItem>
                <SelectItem value="transfer">Transfer</SelectItem>
                {eligible.map(({ rp, idx }) => (
                  <SelectItem key={`${slot}-${idx}`} value={String(idx)}>
                    {getPlayerName(rp)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        })}
      </div>
    </div>
  );

  const renderRelieversStack = (eligible: EligiblePlayer[], className: string) => (
    <div className={`absolute -translate-x-1/2 ${className}`}>
      <p className="mb-1 text-[10px] font-semibold tracking-wide text-slate-700 text-center">Relievers</p>
      <div className="w-[120px] space-y-1">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((rpNum) => {
          const slot = `RP${rpNum}`;
          const currentIdx = depthAssignments[depthKey(slot, 1)];
          const placeholder = depthPlaceholders[depthKey(slot, 1)] ?? null;
          const selectedPlayer = currentIdx != null ? rosterPlayers[currentIdx] : null;
          const colorCls = currentIdx != null ? classColor(playerCurrentClass(selectedPlayer)) : "border-slate-300 bg-white text-black";
          return (
            <Select key={slot} value={currentIdx != null ? String(currentIdx) : (placeholder ?? "none")} onValueChange={(v) => assignDepthSlot(slot, 1, v)}>
              <SelectTrigger className={`h-6 rounded-sm px-1 text-[10px] shadow-sm ${colorCls}`}>
                <SelectValue placeholder={slot} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                <SelectItem value="freshman">Freshman</SelectItem>
                <SelectItem value="transfer">Transfer</SelectItem>
                {eligible.map(({ rp, idx }) => (
                  <SelectItem key={`${slot}-${idx}`} value={String(idx)}>
                    {getPlayerName(rp)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
      <div className="flex flex-col space-y-1.5 p-6 pb-3">
        <h3 className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={{ fontFamily: "'Oswald', sans-serif" }}>Depth Chart Board</h3>
      </div>
      <div className="p-6 pt-0">
        <div className="mb-3 flex items-center gap-4 text-xs">
          <span className="font-medium text-muted-foreground">Class Legend:</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-blue-500/20 border border-blue-500"></span> FR</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-green-500/20 border border-green-500"></span> SO</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-yellow-500/20 border border-yellow-500"></span> JR</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-red-500/20 border border-red-500"></span> SR/GR</span>
        </div>
        <div className="mx-auto relative h-[780px] w-full max-w-[980px] overflow-hidden rounded-xl border border-slate-400 bg-[#e5e5e5]">
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 980 760" preserveAspectRatio="none">
            <path
              d="M90 210 Q490 -180 890 210 L490 610 Z
                 M350 470 L490 330 L630 470 L490 610 Z"
              fill="#f2f2f2"
              fillRule="evenodd"
            />
            <path d="M90 210 Q490 -180 890 210" fill="none" stroke="#525252" strokeWidth="2" />
            <line x1="490" y1="610" x2="90" y2="210" stroke="#525252" strokeWidth="2" />
            <line x1="490" y1="610" x2="890" y2="210" stroke="#525252" strokeWidth="2" />
            <path d="M350 470 L490 330 L630 470 L490 610 Z" fill="#d1d5db" stroke="#4b5563" strokeWidth="2" />
            <path d="M264 384 L272 392 Q490 100 708 392 L716 384" fill="none" stroke="#4b5563" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="490" y1="610" x2="390" y2="510" stroke="#4b5563" strokeWidth="1.5" />
            <line x1="490" y1="610" x2="590" y2="510" stroke="#4b5563" strokeWidth="1.5" />
            <circle cx="490" cy="470" r="26" fill="#f2f2f2" stroke="#6b7280" strokeWidth="1.5" />
            <rect x="484" y="467" width="12" height="6" rx="1.5" fill="#9ca3af" />
            <circle cx="490" cy="620" r="38" fill="#f2f2f2" stroke="#6b7280" strokeWidth="1.5" />
            <polygon points="490,624 500,616 500,604 480,604 480,616" fill="#ffffff" stroke="#6b7280" strokeWidth="1.5" />
          </svg>

          {renderDepthStack("CF", eligiblePositionPlayers, "left-[50%] top-[58px]")}
          {renderDepthStack("LF", eligiblePositionPlayers, "left-[28%] top-[152px]")}
          {renderDepthStack("RF", eligiblePositionPlayers, "left-[72%] top-[152px]")}

          {renderDepthStack("SS", eligiblePositionPlayers, "left-[39%] top-[272px]")}
          {renderDepthStack("2B", eligiblePositionPlayers, "left-[61%] top-[272px]")}
          {renderDepthStack("3B", eligiblePositionPlayers, "left-[30%] top-[434px]")}
          {renderDepthStack("1B", eligiblePositionPlayers, "left-[70%] top-[434px]")}
          {renderDepthStack("C", eligiblePositionPlayers, "left-[50%] top-[654px]")}

          {renderDepthStack("DH", eligiblePositionPlayers, "left-[66%] top-[606px]")}

          {renderStartingRotationStack(eligiblePitchers, "left-[10%] top-[490px]")}

          {renderRelieversStack(eligiblePitchers, "left-[90%] top-[456px]")}
        </div>
      </div>
    </div>
  );
}
