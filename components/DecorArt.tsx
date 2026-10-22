import { DECOR_ATLAS, decorSpriteByType } from '@/lib/game/decor-art';
import { decorByType } from '@/lib/game/decor';
import { GameIcon } from '@/components/GameIcon';

export type RoadConnections = { north?: boolean; east?: boolean; south?: boolean; west?: boolean };
type Props = { type: string; className?: string; connections?: RoadConnections; decorative?: boolean; label?: string };

/** Map-only deck segments reach adjacent cells; catalog previews use the atlas. */
function ServiceDeck({ connections }: { connections: RoadConnections }) {
  const arms = [
    { direction: 'north', rotation: 0 }, { direction: 'east', rotation: 90 },
    { direction: 'south', rotation: 180 }, { direction: 'west', rotation: 270 },
  ] as const;
  return <>
    {arms.filter(arm => connections[arm.direction]).map(arm => <g key={arm.direction} transform={`rotate(${arm.rotation} 80 80)`}>
      <path d="M55 0h50v72H55Z" fill="#26323e" stroke="#8e9ba5" strokeWidth="1.5" />
      <path d="M61 0h38v65H61Z" fill="#68747e" />
      <path d="M62 14h36M62 31h36M62 48h36" stroke="#374652" strokeWidth="2" />
      <path d="M57 4v51m46-51v51" stroke="#e9ad4d" strokeWidth="2.5" />
      <path d="m66 4 3 5m22-5 3 5M66 55l3 5m22-5 3 5" stroke="#b8c3c8" strokeWidth="2" />
    </g>)}
    <rect x="49" y="49" width="62" height="62" rx="8" fill="#26323e" stroke="#a7b1b7" strokeWidth="2" />
    <rect x="56" y="56" width="48" height="48" rx="4" fill="#74808a" />
    <path d="M61 65h38M61 74h38M61 83h38M61 92h38" stroke="#3a4855" strokeWidth="2" />
    <path d="M55 52h13m24 0h13M55 108h13m24 0h13" stroke="#efb44e" strokeWidth="3" />
    {[{ x: 53, y: 53 }, { x: 107, y: 53 }, { x: 53, y: 107 }, { x: 107, y: 107 }].map(point => <circle key={`${point.x}:${point.y}`} cx={point.x} cy={point.y} r="2" fill="#9be1df" />)}
  </>;
}

export function DecorArt({ type, className = '', connections, decorative = true, label }: Props) {
  const sprite = decorSpriteByType(type);
  const deck = type === 'road' && connections !== undefined;
  const imageLabel = label ?? decorByType(type)?.name ?? 'Оформление колонии';
  if (!sprite) return <span className={`decorArt ${className}`.trim()} aria-hidden={decorative ? true : undefined}
    role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : imageLabel}><GameIcon name="building" size={32} /></span>;
  const scale = 300 / Math.max(sprite[2], sprite[3]);
  const width = sprite[2] * scale, height = sprite[3] * scale;
  return <svg className={`decorArt decorArt-${type} ${className}`.trim()} viewBox={deck ? '0 0 160 160' : '0 0 320 320'} width="100%" height="100%" focusable="false"
    data-decor-art={type} data-decor-renderer={deck ? 'connected-deck' : 'lunar-atlas'}
    aria-hidden={decorative ? true : undefined} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : imageLabel}>
    {deck ? <ServiceDeck connections={connections!} /> : <svg x={(320 - width) / 2} y={310 - height} width={width} height={height}
      viewBox={sprite.join(' ')} preserveAspectRatio="none" overflow="hidden">
      <image href={DECOR_ATLAS.src} width={DECOR_ATLAS.width} height={DECOR_ATLAS.height} />
    </svg>}
  </svg>;
}
