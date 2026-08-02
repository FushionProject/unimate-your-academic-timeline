export function LogoMark({ className, title = "UniMate" }: { className?: string; title?: string }) {
  return (
    <img
      src="/assets/unimate-logo-head.png"
      className={`object-contain ${className ?? ""}`}
      alt={title}
      draggable={false}
    />
  );
}
