// The official UniMate logo: a smiling face wearing a graduation cap.
//
// Drawn as a theme-adaptive SVG rather than a raster image so it stays crisp at
// every size and legible in both themes. The "ink" (cap, outline, features)
// uses currentColor bound to --foreground, and the face fill uses --background,
// so the mark inverts cleanly: dark ink on a light face in light mode, light
// ink on a dark face in dark mode. That keeps the solid cap from disappearing
// against the dark canvas.
export function LogoMark({ className, title = "UniMate" }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 120 120"
      className={className}
      role="img"
      aria-label={title}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ color: "var(--foreground)" }}
    >
      {/* Face */}
      <ellipse
        cx="60"
        cy="75"
        rx="40"
        ry="34"
        fill="var(--background)"
        stroke="currentColor"
        strokeWidth="5"
      />

      {/* Happy closed eyes */}
      <path d="M34 69 Q44 61 54 69" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M66 69 Q76 61 86 69" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />

      {/* Smile */}
      <path d="M43 83 Q60 97 77 83" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />

      {/* Cap band hugging the top of the head, with a center dip */}
      <path
        d="M20 53 C26 33 50 33 60 45 C70 33 94 33 100 53 C86 47 34 47 20 53 Z"
        fill="currentColor"
      />

      {/* Mortarboard */}
      <path
        d="M60 8 L109 38 L60 49 L11 38 Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      {/* Soft sheen on the board */}
      <path d="M60 12 L101 37 L60 45 Z" fill="#ffffff" opacity="0.14" />

      {/* Tassel: ring, cord, and fringe on the left */}
      <circle
        cx="14"
        cy="44"
        r="4.5"
        fill="var(--background)"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path d="M14 48 L14 61" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M9 61 L19 61 L16 76 L12 76 Z" fill="currentColor" strokeLinejoin="round" />
    </svg>
  );
}
