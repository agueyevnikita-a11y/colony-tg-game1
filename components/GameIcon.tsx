import type { ReactNode } from 'react';
import '@/app/city-art.css';

type Props = { name: string; size?: number; className?: string; title?: string };

const ICONS: Record<string, ReactNode> = {
  ore: <><path d="m5 20 9-11m-4-4 2-2c4 0 7 3 8 7l-2 2c-1-4-4-7-8-7Z" /><path d="m4 18 2 2" /></>,
  energy: <path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z" />,
  parts: <><path d="m9 3 1-1h4l1 3 3 1 3-1 2 4-2 2v3l2 2-2 4-3-1-3 1-1 3h-4l-1-3-3-1-3 1-2-4 2-2v-3L1 9l2-4 3 1 3-1Z" transform="translate(1 0) scale(.92)" /><circle cx="12" cy="12" r="3" /></>,
  credits: <><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v6c0 4 16 4 16 0V6M4 12v6c0 4 16 4 16 0v-6" /><path d="M8 10v8m4-7v8m4-9v8" opacity=".45" /></>,
  crystals: <><path d="m7 3-5 6 10 13L22 9l-5-6H7Z" /><path d="M2 9h20M7 3l5 19 5-19M7 3l5 6 5-6" /></>,
  science: <><path d="M9 2h6m-5 0v7l-6 10c-.7 1.4 0 3 2 3h12c2 0 2.7-1.6 2-3L14 9V2M7 15h10" /><circle cx="10" cy="18" r=".7" fill="currentColor" stroke="none" /></>,
  city: <><path d="M2 21h20M4 21V9h6v12m0-15h6v15m0-9h4v9M6 12h1m-1 4h1m6-7h1m-1 4h1m-1 4h1" /><path d="M12 6V3h3" /></>,
  build: <><path d="m4 20 11-11 3 3L7 23l-3-3Zm7-13 3-3c3-2 5-1 7 1l-4 4m-6-2 6 6 3-3-6-6" transform="translate(0 -1)" /></>,
  research: <><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" /><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-35 12 12)" /><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(35 12 12)" /><ellipse cx="12" cy="12" rx="4" ry="10" /></>,
  market: <><path d="M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4" /></>,
  missions: <><path d="M5 22V3m0 1c5-4 9 4 15 0v11c-6 4-10-4-15 0" /><path d="m9 8 2 2 4-3" /></>,
  shop: <><path d="M4 8h16l1 14H3L4 8Zm4 0V6a4 4 0 0 1 8 0v2" /><path d="M8 12v1m8-1v1" /></>,
  social: <><circle cx="9" cy="7" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5v2" /></>,
  help: <><circle cx="12" cy="12" r="10" /><path d="M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 3m0 4h.01" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  check: <path d="m4 12 5 5L20 6" />,
  clock: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
  move: <><path d="M12 2v20M2 12h20M8 6l4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4m12-8 4 4-4 4" /></>,
  upgrade: <><path d="m6 12 6-6 6 6m-6-6v16M4 2h16" /></>,
  share: <><circle cx="5" cy="12" r="3" /><circle cx="19" cy="5" r="3" /><circle cx="19" cy="19" r="3" /><path d="m8 10 8-4M8 14l8 4" /></>,
  building: <><path d="M4 22V4l8-2 8 2v18M2 22h20M9 22v-5h6v5M8 7h1m6 0h1m-8 5h1m6 0h1" /></>,
  star: <path d="m12 2 3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1 3-6Z" />,
  rocket: <><path d="M8 16C4 9 11 3 21 3c0 10-6 17-13 13ZM8 10H4l-2 6 6-1m6 1v4l-6 2 1-6m-4 3-2 2" /><circle cx="15" cy="9" r="2" /></>,
  road: <><path d="M8 2 3 22m13-20 5 20M12 3v3m0 5v3m0 5v2" /></>,
  tree: <><path d="m12 2-6 8h3l-5 7h16l-5-7h3l-6-8Zm0 15v5" /></>,
  lamp: <><path d="M8 14a6 6 0 1 1 8 0l-1 3H9l-1-3Zm1 6h6m-5 3h4M12 1v1M2 6l1 1m18-1-1 1" /><path d="m10 10 2 2 2-2m-2 2v5" /></>,
  park: <><path d="m6 2-4 6h2l-3 5h10L8 8h2L6 2Zm0 11v9M11 15h11m-10 3h9m-8 0v4m7-4v4M12 12v3m9-3v3" /></>,
  statue: <><path d="M4 22h16l-2-4H6l-2 4Zm4-4v-7h8v7M9 8l3-6 3 6H9Z" /><path d="M7 11h10" /></>,
  info: <><circle cx="12" cy="12" r="10" /><path d="M12 11v6m0-10h.01" /></>,
};

const TONES: Record<string, string> = {
  ore: '#d5b884', energy: '#f4cc68', parts: '#b0c8de', credits: '#e7c66c', crystals: '#bda2fa',
  science: '#82d6de', tree: '#78c99d', park: '#78c99d', lamp: '#edcf7f',
};

export function GameIcon({ name, size = 20, className = '', title }: Props) {
  return <svg className={`gameIcon ${className}`.trim()} width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
    style={TONES[name] ? { color: TONES[name] } : undefined} focusable="false"
    aria-hidden={title ? undefined : true} aria-label={title} role={title ? 'img' : undefined}>
    {title && <title>{title}</title>}{ICONS[name] ?? ICONS.building}
  </svg>;
}

const RESOURCE_LABELS: Record<string, string> = {
  ore: 'Руда', energy: 'Энергия', parts: 'Детали', credits: 'Кредиты', crystals: 'Кристаллы', science: 'Наука',
};

export function GameAmount({ resource, children, size = 14 }: { resource: string; children: ReactNode; size?: number }) {
  const label = RESOURCE_LABELS[resource] ?? resource;
  return <span className="gameAmount" title={label}><GameIcon name={resource} size={size} /><span className="gameSrOnly">{label}: </span>{children}</span>;
}
