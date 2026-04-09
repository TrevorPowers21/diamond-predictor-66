import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface SchoolBannerProps {
  schoolLogoUrl?: string;
  schoolName?: string;
  className?: string;
}

const SchoolBanner: React.FC<SchoolBannerProps> = ({
  schoolLogoUrl = "/tculogo.png",
  schoolName = "TCU",
  className = '',
}) => {
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
              <div className="flex items-center gap-6">
                <img
                  src={schoolLogoUrl}
                  alt={schoolName}
                  className="h-24 w-auto object-contain"
                />
                <div>
                  <h2
                    className="text-4xl font-bold tracking-wider leading-none uppercase"
                    style={{
                      fontFamily: "'Oswald', sans-serif",
                      color: '#4D1979',
                    }}
                  >
                    TCU
                  </h2>
                  <p
                    className="text-2xl font-semibold tracking-wide uppercase mt-0.5"
                    style={{
                      fontFamily: "'Oswald', sans-serif",
                      color: '#FFFFFF',
                    }}
                  >
                    Horned Frogs
                  </p>
                </div>
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
