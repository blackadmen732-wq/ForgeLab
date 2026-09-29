import { Link } from "react-router";

export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect
        x="1"
        y="1"
        width="30"
        height="30"
        rx="7"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.35"
      />
      <path d="M10 24V8h13v3.2h-9.2v3.4h8.2v3.2h-8.2V24z" fill="currentColor" />
    </svg>
  );
}

export function Logo({ to = "/" }: { to?: string }) {
  return (
    <Link to={to} className="logo" aria-label="ForgeLab home">
      <LogoMark />
      <span className="logo__word">ForgeLab</span>
    </Link>
  );
}
