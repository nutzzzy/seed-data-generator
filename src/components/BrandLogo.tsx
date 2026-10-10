import { useId } from 'react';

/** The snapp seed! mark (same artwork as public/favicon.svg), inline so the header can animate it. */
export function BrandLogo({ size = 48 }: { size?: number }) {
  const id = useId();
  const tile = `${id}-tile`;
  const bang = `${id}-bang`;
  return (
    <svg className="brand-logo" viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id={tile} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#f3f1ff" />
        </linearGradient>
        <linearGradient id={bang} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff3d97" />
          <stop offset="1" stopColor="#f20072" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#${tile})`} />
      <g className="logo-chevrons" fill="none" stroke="#4a42fa" strokeWidth="5" strokeLinejoin="miter">
        <path d="M3 33.5H22.5V53" opacity=".35" />
        <path d="M10 26.5H29.5V46" opacity=".65" />
        <path d="M17 19.5H36.5V39" />
      </g>
      <path d="M48.5 10H58L50.5 40H45.5Z" fill={`url(#${bang})`} stroke={`url(#${bang})`} strokeWidth="1.5" strokeLinejoin="round" />
      <g className="logo-sprout">
        <path d="M42.5 47.5C41 43 37 41 32.5 42C34 46.5 38 48.5 42.5 47.5Z" fill="#19c37d" />
        <path d="M42.3 47.3C39.5 46.2 37 44.6 35 43" fill="none" stroke="#0f9d63" strokeWidth=".9" strokeLinecap="round" />
      </g>
      <g className="logo-seed">
        <ellipse cx="45" cy="52" rx="4.2" ry="5.6" transform="rotate(28 45 52)" fill="#f20072" />
        <path d="M43.6 49.2Q45.6 52 44.6 55" fill="none" stroke="#fff" strokeWidth="1.1" strokeLinecap="round" opacity=".7" />
      </g>
    </svg>
  );
}
