// Same "Or reach us directly" pattern as the landing page (rstriq.com) —
// initials in a circle, name, email. Used both pre-purchase (plan select)
// and post-purchase (player home) so there's always a named human to
// reach, not just a generic "your coach" reference.
export default function StaffContact({ name, email }: { name: string; email: string }) {
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <div className="flex items-center gap-3">
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold"
        style={{ backgroundColor: "#D4AF3733", color: "#0D1B3E" }}
      >
        {initials}
      </div>
      <div>
        <p className="text-sm font-medium">{name}</p>
        <a href={`mailto:${email}`} className="text-sm text-muted-foreground hover:underline">
          {email}
        </a>
      </div>
    </div>
  );
}
