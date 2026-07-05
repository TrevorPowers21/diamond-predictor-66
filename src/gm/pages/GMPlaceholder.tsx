import { Card, CardContent } from "@/components/ui/card";

// Generic "coming soon" tab body for GM sections not yet built (Money, Notes,
// Eligibility). Each gets its real page as its phase lands.
export default function GMPlaceholder({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <Card>
        <CardContent className="py-10 text-center">
          <div className="text-sm font-semibold text-foreground">{title} — coming soon</div>
          <p className="mx-auto mt-2 max-w-lg text-xs leading-relaxed text-muted-foreground">{blurb}</p>
        </CardContent>
      </Card>
    </div>
  );
}
