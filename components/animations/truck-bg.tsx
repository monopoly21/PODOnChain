export function TruckBackground() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 -bottom-2 md:bottom-6 h-28 md:h-32 overflow-visible"
    >
      <div className="relative mx-auto w-full max-w-6xl">
        {/* skid lines that appear during braking */}
        <div className="truck-sparks absolute left-1/2 top-1/2 h-2 w-24 -translate-y-1/2 bg-gradient-to-r from-transparent via-muted-foreground/40 to-transparent rounded-full blur-[1px]" />
        {/* simple truck svg */}
        <svg
          className="truck-anim relative h-16 md:h-20 drop-shadow-sm"
          viewBox="0 0 220 100"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* trailer */}
          <rect x="40" y="28" width="130" height="44" rx="6" className="fill-card stroke-border" strokeWidth="2" />
          {/* cab */}
          <rect x="170" y="40" width="32" height="32" rx="6" className="fill-primary" />
          <rect x="178" y="46" width="16" height="12" rx="2" className="fill-primary-foreground/80" />
          {/* ground */}
          <line x1="0" y1="80" x2="220" y2="80" className="stroke-border" strokeWidth="2" />
          {/* wheels */}
          <circle cx="70" cy="80" r="10" className="fill-foreground" />
          <circle cx="130" cy="80" r="10" className="fill-foreground" />
          <circle cx="185" cy="80" r="10" className="fill-foreground" />
          {/* brake highlight */}
          <rect x="200" y="58" width="6" height="8" className="fill-red-500/70" />
        </svg>
      </div>
    </div>
  )
}
