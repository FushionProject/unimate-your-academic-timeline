// UniMate custom icon set.
//
// House style: 24x24, rounded geometry, a single 1.8 stroke in `currentColor`,
// plus a soft duotone fill (currentColor at low opacity) on a signature shape
// of each glyph. The duotone fill uses currentColor — not a hardcoded color —
// so the icons stay legible in every context (dark sidebar, muted labels,
// primary accents) while still reading as a deliberate, matched family rather
// than stock line icons.
//
// Each component accepts `className` and spreads it onto the <svg>, so these
// are drop-in replacements for the lucide icons (`<IconHome className="h-5 w-5" />`).

import type { SVGProps } from "react";

const FILL = 0.16;

function Base({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

export function IconHome(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path
        d="M4 10.8 12 4l8 6.8V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z"
        fill="currentColor"
        fillOpacity={FILL}
        stroke="none"
      />
      <path d="M3 11.2 12 4l9 7.2" />
      <path d="M5 10.4V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-8.6" />
      <path d="M9.5 20.5v-5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v5" />
    </Base>
  );
}

export function IconDashboard(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.8" fill="currentColor" fillOpacity={FILL} />
      <rect
        x="13.5"
        y="13.5"
        width="7"
        height="7"
        rx="1.8"
        fill="currentColor"
        fillOpacity={FILL}
      />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.8" />
    </Base>
  );
}

export function IconSyllabus(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path
        d="M6.5 3h6.2L18 8.3V19.5A1.5 1.5 0 0 1 16.5 21h-10A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3z"
        fill="currentColor"
        fillOpacity={FILL}
        stroke="none"
      />
      <path d="M6.5 3h6.2L18 8.3V19.5A1.5 1.5 0 0 1 16.5 21h-10A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3z" />
      <path d="M12.5 3v4.5a1 1 0 0 0 1 1H18" />
      <path d="M8.5 13h6M8.5 16.5h6M8.5 9.8h1.8" />
    </Base>
  );
}

export function IconNotes(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path
        d="M5 4.6A1.6 1.6 0 0 1 6.6 3h10.8A1.6 1.6 0 0 1 19 4.6V14l-5.4 6.5H6.6A1.6 1.6 0 0 1 5 18.9z"
        fill="currentColor"
        fillOpacity={FILL}
        stroke="none"
      />
      <path d="M5 4.6A1.6 1.6 0 0 1 6.6 3h10.8A1.6 1.6 0 0 1 19 4.6V14l-5.4 6.5H6.6A1.6 1.6 0 0 1 5 18.9z" />
      <path d="M13.4 20.5V15a1 1 0 0 1 1-1H19" />
      <path d="M8.5 8h7M8.5 11.2h4.5" />
    </Base>
  );
}

export function IconAsk(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path
        d="M4 6.4A2.4 2.4 0 0 1 6.4 4h11.2A2.4 2.4 0 0 1 20 6.4v6.8a2.4 2.4 0 0 1-2.4 2.4H9.5L5 20v-4.4A2.4 2.4 0 0 1 4 13.2z"
        fill="currentColor"
        fillOpacity={FILL}
        stroke="none"
      />
      <path d="M4 6.4A2.4 2.4 0 0 1 6.4 4h11.2A2.4 2.4 0 0 1 20 6.4v6.8a2.4 2.4 0 0 1-2.4 2.4H9.5L5.6 19.4A.6.6 0 0 1 5 19v-3.4A2.4 2.4 0 0 1 4 13.2z" />
      <path
        d="M12 7.3c.35 1.6 1.05 2.3 2.65 2.65-1.6.35-2.3 1.05-2.65 2.65-.35-1.6-1.05-2.3-2.65-2.65C10.95 9.6 11.65 8.9 12 7.3z"
        fill="currentColor"
        fillOpacity={0.9}
        stroke="none"
      />
    </Base>
  );
}

export function IconFlame(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path
        d="M12 3c.4 3-2.3 4.7-2.9 7-.9-.4-1.3-1.6-1.3-1.6S6 10 6 12.8A6 6 0 0 0 18 13c0-4.6-4.3-6.7-6-10z"
        fill="currentColor"
        fillOpacity={FILL}
        stroke="none"
      />
      <path d="M12 3c.4 3-2.3 4.7-2.9 7-.9-.4-1.3-1.6-1.3-1.6S6 10 6 12.8A6 6 0 0 0 18 13c0-4.6-4.3-6.7-6-10z" />
      <path
        d="M12 20.2a2.6 2.6 0 0 0 2.6-2.6c0-1.5-1.3-2.4-2.6-3.9-1.3 1.5-2.6 2.4-2.6 3.9A2.6 2.6 0 0 0 12 20.2z"
        fill="currentColor"
        fillOpacity={0.85}
        stroke="none"
      />
    </Base>
  );
}

export function IconChevronLeft(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M14.5 5.5 8 12l6.5 6.5" />
    </Base>
  );
}

export function IconChevronRight(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M9.5 5.5 16 12l-6.5 6.5" />
    </Base>
  );
}
