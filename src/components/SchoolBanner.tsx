import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';
import { useEffectiveSchool } from '@/hooks/useEffectiveSchool';

interface SchoolBannerProps {
  schoolLogoUrl?: string;
  schoolName?: string;
  className?: string;
}

// The banner background is the dark navy (#070e1f) per CLAUDE.md, so any
// extracted/saved color whose luminance is too low to read on it gets
// swapped for white at render time. The DB still holds the actual team
// color (so we don't lose info if the banner moves to a light surface
// later) — this is purely a display adjustment for the dark banner.
const luminance = (hex: string): number => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

const colorForDarkBg = (hex: string | undefined | null): string => {
  if (!hex) return '#FFFFFF';
  // 0.14 catches pure black (0), navy blues (~0.10–0.13), and dark grays
  // while leaving school reds (~0.17+), team blues (~0.28+), golds, and
  // oranges untouched. Tuned slightly below 0.17 so the quantized reds
  // returned by extractLogoColors still pass through.
  return luminance(hex) < 0.14 ? '#FFFFFF' : hex;
};

const SchoolBanner: React.FC<SchoolBannerProps> = ({
  schoolLogoUrl,
  schoolName,
  className = '',
}) => {
  const { effectiveTeamId, availableTeams } = useAuth();
  const effectiveTeam = effectiveTeamId
    ? availableTeams.find((t) => t.id === effectiveTeamId) ?? null
    : null;
  // Pulls logo + branding (split name + colors) from the impersonated team's
  // customer_teams row. Edit per-team in AdminTeams → Branding. Prop
  // overrides logo only.
  const { logoUrl: effectiveLogoUrl, branding } = useEffectiveSchool();
  const resolvedSchoolName = schoolName ?? effectiveTeam?.name ?? '';
  const resolvedSchoolLogo = schoolLogoUrl ?? effectiveLogoUrl ?? '';
  const [showSchool, setShowSchool] = React.useState(false);
  const [hasAnimatedOnce, setHasAnimatedOnce] = React.useState(false);
  const [isHovering, setIsHovering] = React.useState(false);
  const hoverInterval = React.useRef<ReturnType<typeof setInterval> | null>(null);

  // Animate once on load: RSTR IQ → school logo → stay
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setShowSchool(true);
      setHasAnimatedOnce(true);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  // Loop on hover
  React.useEffect(() => {
    if (isHovering) {
      hoverInterval.current = setInterval(() => {
        setShowSchool((prev) => !prev);
      }, 3000);
    } else {
      if (hoverInterval.current) {
        clearInterval(hoverInterval.current);
        hoverInterval.current = null;
      }
      // Reset to school logo when hover ends (if already animated once)
      if (hasAnimatedOnce) {
        setShowSchool(true);
      }
    }
    return () => {
      if (hoverInterval.current) clearInterval(hoverInterval.current);
    };
  }, [isHovering, hasAnimatedOnce]);

  // Check reduced motion preference
  const prefersReducedMotion = React.useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const transition = prefersReducedMotion
    ? { duration: 0.1 }
    : { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Cormorant+Garamond:wght@600&display=swap');
      `}</style>
      <div
        className={`relative w-full overflow-hidden rounded-lg bg-background shadow-sm ring-1 ring-border/30 cursor-pointer ${className}`}
        style={{ height: '180px', perspective: '1200px' }}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        <AnimatePresence mode="wait">
          {!showSchool ? (
            <motion.div
              key="rstr-iq"
              initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, rotateX: -10, scale: 0.95 }}
              animate={{ opacity: 1, rotateX: 0, scale: 1 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, rotateX: 10, scale: 0.95 }}
              transition={transition}
              className="absolute inset-0 flex items-center justify-center"
              style={{ transformStyle: 'preserve-3d' }}
            >
              <div className="flex items-center gap-5">
                {/* Double diamond logo */}
                <svg
                  width="100"
                  height="100"
                  viewBox="0 0 200 200"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <rect
                    x="30" y="30" width="140" height="140"
                    fill="none" stroke="#D4AF37" strokeWidth="2.5"
                    transform="rotate(45 100 100)"
                  />
                  <rect
                    x="50" y="50" width="100" height="100"
                    fill="none" stroke="#D4AF37" strokeWidth="1.8"
                    transform="rotate(45 100 100)"
                  />
                  <text
                    x="100" y="105"
                    textAnchor="middle" dominantBaseline="middle"
                    fill="#D4AF37" fontSize="80" fontWeight="600"
                    fontFamily="'Cormorant Garamond', serif"
                  >
                    R
                  </text>
                </svg>

                {/* Divider */}
                <div className="h-20 w-px bg-[#D4AF37]/30" />

                {/* Text */}
                <div>
                  <h1
                    className="text-5xl font-bold tracking-wider leading-none"
                    style={{
                      fontFamily: "'Oswald', sans-serif",
                      color: '#D4AF37',
                    }}
                  >
                    RSTR IQ
                  </h1>
                  <p
                    className="text-sm tracking-[0.3em] mt-1"
                    style={{
                      fontFamily: "'Oswald', sans-serif",
                      color: '#D4AF37',
                      opacity: 0.6,
                    }}
                  >
                    EVERYDAY GM
                  </p>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="school"
              initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, rotateX: -10, scale: 0.95 }}
              animate={{ opacity: 1, rotateX: 0, scale: 1 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, rotateX: 10, scale: 0.95 }}
              transition={transition}
              className="absolute inset-0 flex items-center justify-center"
              style={{ transformStyle: 'preserve-3d' }}
            >
              <div className="flex items-center gap-8">
                {resolvedSchoolLogo && (
                  <>
                    <img
                      src={resolvedSchoolLogo}
                      alt={resolvedSchoolName}
                      className="h-28 w-auto object-contain"
                    />
                    <div className="h-20 w-px bg-[#D4AF37]/30" />
                  </>
                )}
                {branding ? (
                  <div>
                    <h2
                      className="text-2xl font-bold tracking-wider leading-none uppercase"
                      style={{ fontFamily: "'Oswald', sans-serif", color: colorForDarkBg(branding.primaryColor) }}
                    >
                      {branding.displayName}
                    </h2>
                    <p
                      className="text-4xl font-bold tracking-wide uppercase mt-0.5"
                      style={{ fontFamily: "'Oswald', sans-serif", color: colorForDarkBg(branding.secondaryColor) }}
                    >
                      {branding.mascot}
                    </p>
                  </div>
                ) : resolvedSchoolName ? (
                  <h2
                    className="text-2xl font-bold tracking-wider leading-none uppercase"
                    style={{ fontFamily: "'Oswald', sans-serif", color: '#D4AF37' }}
                  >
                    {resolvedSchoolName}
                  </h2>
                ) : (
                  <img src="/newtforce-logo.png" alt="NewtForce" className="h-28 object-contain" />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Subtle border */}
        <div className="absolute inset-0 rounded-lg pointer-events-none border border-border/60" />
      </div>
    </>
  );
};

export default SchoolBanner;
