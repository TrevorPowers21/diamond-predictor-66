import { useSearchParams } from "react-router-dom";
import DashboardLayout from "@/components/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import HighFollowList from "./HighFollowList";
import TargetBoardSubtab from "./targets/TargetBoardSubtab";

// Targets parent page. Wraps two subtabs:
//   - Target Board: the new prioritized, position-grouped board for
//     individual player evaluation. Drag-and-drop reorder + per-row
//     priority. Pattern after the Returning Players dashboard columns.
//   - High Follow: the existing watchlist (unchanged from before — just
//     nested as a subtab now).
//
// URL search param `tab=target-board | high-follow` controls the active
// subtab so coaches can bookmark / deep-link either view. Default is
// target-board because that's the new primary use case.
export default function Targets() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "target-board";

  return (
    <DashboardLayout>
      <div className="container mx-auto px-4 py-6">
        <Tabs
          value={activeTab}
          onValueChange={(v) => {
            const next = new URLSearchParams(searchParams);
            next.set("tab", v);
            setSearchParams(next);
          }}
        >
          <TabsList>
            <TabsTrigger value="target-board">Target Board</TabsTrigger>
            <TabsTrigger value="high-follow">High Follow</TabsTrigger>
          </TabsList>

          <TabsContent value="target-board" className="mt-6">
            <TargetBoardSubtab />
          </TabsContent>

          <TabsContent value="high-follow" className="mt-6">
            {/* Reuses the existing HighFollowList page body unchanged.
                The DashboardLayout wrapper is shared so we render it
                without its own layout. */}
            <HighFollowList embedded />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
