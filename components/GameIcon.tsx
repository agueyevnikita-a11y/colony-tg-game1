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
  copy: <><rect x="8" y="8" width="13" height="14" rx="2" /><path d="M16 8V4a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" /><path d="M11 12h7m-7 4h5" /></>,
  building: <><path d="M4 22V4l8-2 8 2v18M2 22h20M9 22v-5h6v5M8 7h1m6 0h1m-8 5h1m6 0h1" /></>,
  star: <path d="m12 2 3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1 3-6Z" />,
  rocket: <><path d="M8 16C4 9 11 3 21 3c0 10-6 17-13 13ZM8 10H4l-2 6 6-1m6 1v4l-6 2 1-6m-4 3-2 2" /><circle cx="15" cy="9" r="2" /></>,
  road: <><path d="M6 2h12v20H6V2Zm0 5h12M6 17h12M9 10h6m-6 4h6M3 4v5m0 6v5m18-16v5m0 6v5" /></>,
  tree: <><path d="M5 18V9a7 7 0 0 1 14 0v9M4 18h16v4H4v-4Z" /><path d="M12 17V9m0 4c-4 0-5-2-5-4 3 0 5 1 5 4Zm0 2c4 0 5-2 5-4-3 0-5 1-5 4Z" /></>,
  lamp: <><path d="M9 21h6M12 21V10M8 5l4-3 4 3v5H8V5ZM4 5v5m16-5v5M2 7h2m16 0h2M9 7h6" /></>,
  park: <><path d="M3 18V12a9 9 0 0 1 18 0v6M2 18h20v4H2v-4ZM12 3c-5 4-5 10-5 15m5-15c5 4 5 10 5 15M3 11h18" /><path d="M10 17v-3m4 3v-3" /></>,
  statue: <><path d="M3 22h18l-3-4H6l-3 4ZM8 18l2-8h4l2 8M12 2l4 5-4 6-4-6 4-5Z" /><path d="M12 2v11" /></>,
  info: <><circle cx="12" cy="12" r="10" /><path d="M12 11v6m0-10h.01" /></>,
  lock: <><rect x="5" y="10" width="14" height="12" rx="3" /><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v3" /></>,
  trophy: <><path d="M7 3h10v5c0 4-2 6-5 6S7 12 7 8V3Zm5 11v5m-5 3h10M8 19h8" /><path d="M7 5H3v3c0 3 2 4 5 4m9-7h4v3c0 3-2 4-5 4" /><path d="m12 5 .8 1.6 1.7.3-1.3 1.2.3 1.8-1.5-.9-1.5.9.3-1.8L9.5 7l1.7-.3L12 5Z" strokeWidth="1.1" /></>,
  gift: <><rect x="3" y="9" width="18" height="4" rx="1" /><path d="M5 13v9h14v-9M12 9v13M12 9H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z" /></>,
  network: <><path d="M12 7v4m-7 6v-4h14v4M12 13v4" /><path d="m12 2 3 2v3l-3 2-3-2V4l3-2ZM5 17l3 2v3H2v-3l3-2Zm7 0 3 2v3H9v-3l3-2Zm7 0 3 2v3h-6v-3l3-2Z" /></>,
  comfort: <><path d="M3 18V11a9 9 0 0 1 18 0v7M2 18h20v4H2v-4Z" /><path d="M12 16c-5-3-5-6-2.5-6 1.5 0 2.5 1 2.5 2 0-1 1-2 2.5-2 2.5 0 2.5 3-2.5 6Z" /></>,
  shield: <><path d="m12 2 9 4v6c0 5-5 8-9 10-4-2-9-5-9-10V6l9-4Z" /><path d="m8 12 3 3 5-6" /></>,
  crown: <><path d="m3 6 5 4 4-7 4 7 5-4-2 13H5L3 6Zm3 16h12M5 16h14" /><circle cx="12" cy="13" r="1" /></>,
  refresh: <><path d="M20 8a9 9 0 0 0-15-3L2 8m0-6v6h6M4 16a9 9 0 0 0 15 3l3-3m0 6v-6h-6" /></>,
  mail: <><rect x="2" y="4" width="20" height="16" rx="3" /><path d="m3 6 9 7 9-7M3 19l6-6m12 6-6-6" /></>,
  settings: <><path d="m9 3 1-1h4l1 3 3 1 3-1 2 4-2 2v3l2 2-2 4-3-1-3 1-1 3h-4l-1-3-3-1-3 1-2-4 2-2v-3L1 9l2-4 3 1 3-1Z" transform="translate(1 0) scale(.92)" /><circle cx="12" cy="12" r="3" /></>,
  palette: <><path d="M12 2a10 10 0 1 0 0 20h2a3 3 0 0 0 1-6c-1-.3-1.5-1-1-2 1-2 5 0 7-2 2-3-3-10-9-10Z" /><circle cx="7" cy="10" r="1" /><circle cx="11" cy="6" r="1" /><circle cx="16" cy="8" r="1" /><circle cx="7" cy="15" r="1" /></>,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><path d="m12 12 9-9m-1-1 2 2" /></>,
  signal: <><path d="M8 8a6 6 0 0 0 0 8m8-8a6 6 0 0 1 0 8M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14M12 15v7" /><circle cx="12" cy="12" r="2" /></>,
  artifact_core: <><path d="m12 2 8 5v10l-8 5-8-5V7l8-5Z" /><path d="m4 7 8 5 8-5m-8 5v10m-5-7 5 3 5-3" /><path d="m9 6 3-2 3 2-3 2-3-2Z" /></>,
  artifact_lens: <><path d="m12 2 9 5v10l-9 5-9-5V7l9-5Z" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /><path d="m7 7 3 3m4 4 3 3" /></>,
  artifact_shard: <><path d="m13 2 6 7-3 12-9 1-4-12L13 2Z" /><path d="m13 2-3 9 6 10m-6-10 9-2m-9 2-7-1m7 1L7 22" /></>,
  artifact_beacon: <><path d="m12 2 7 4v14l-7 2-7-2V6l7-4ZM5 6l7 4 7-4m-7 4v12M8 14l1 3m7-3-1 3" /><path d="M9 6h6m-6 7 3 2 3-2" /></>,
  bench: <><rect x="2" y="6" width="20" height="14" rx="6" /><path d="M7 6V3h10v3M7 10h10v5H7v-5ZM5 20v2m14-2v2m-8-12v5" /></>,
  flowerbed: <><path d="M3 6h18v12H3V6ZM2 18h20v4H2v-4ZM6 6V3h12v3M8 16v-5m8 5v-5M6 9l2 2 2-2m4 0 2 2 2-2" /></>,
  fountain: <><rect x="3" y="3" width="7" height="16" rx="3" /><rect x="14" y="3" width="7" height="16" rx="3" /><path d="M10 7h4m-4 8h4M3 22h18M6 8h1m10 0h1M6 12h1m10 0h1" /></>,
  plaza: <><path d="M4 17h16v5H4v-5Zm4 0v-4h8v4M12 13V9" /><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M3 4v4m18-4v4M12 3V1" /></>,
};

const TONES: Record<string, string> = {
  ore: '#d5b884', energy: '#f4cc68', parts: '#b0c8de', credits: '#e7c66c', crystals: '#bda2fa',
  science: '#82d6de', tree: '#78c99d', park: '#78c99d', lamp: '#edcf7f',
  trophy: '#e7c66c', gift: '#bda2fa', network: '#85ddbf', comfort: '#91d6a2', crown: '#e7c66c',
  artifact_core: '#e4b47f', artifact_lens: '#bda2fa', artifact_shard: '#82d6de', artifact_beacon: '#9ec6ed',
  flowerbed: '#78c99d', fountain: '#82d6de', plaza: '#a8c8cd',
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
