import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Activity, DollarSign, TrendingUp } from "lucide-react";

const stats = [
  { label: "Portal Players Tracked", value: "—", icon: Users, color: "text-primary" },
  { label: "Returning Players", value: "—", icon: Activity, color: "text-accent" },
  { label: "NIL Valuations", value: "—", icon: DollarSign, color: "text-success" },
  { label: "Model Score Avg", value: "—", icon: TrendingUp, color: "text-warning" },
];

export default function Dashboard() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-muted-foreground">Your college baseball analytics at a glance.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => (
            <Card key={s.label}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
                <s.icon className={cn("h-4 w-4", s.color)} />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{s.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Getting Started</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground space-y-2">
            <p>Welcome to Diamond Analytics. Connect your Google Sheets data to begin populating your dashboards.</p>
            <p>Once data is synced, you'll see transfer portal rankings, returning player projections, and NIL valuations here.</p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function cn(...classes: (string | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
