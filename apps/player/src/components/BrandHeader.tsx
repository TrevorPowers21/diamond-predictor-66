export default function BrandHeader({ subtitle }: { subtitle: string }) {
  return (
    <div className="text-center space-y-2">
      <img src="/rstr-iq-logo.png" alt="RSTR IQ" className="logo-navy mx-auto h-12 w-auto" />
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Better Decisions Faster</p>
      <p className="text-sm text-muted-foreground pt-2">{subtitle}</p>
    </div>
  );
}
