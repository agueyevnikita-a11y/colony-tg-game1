import { DECOR_ATLAS, decorSpriteByType } from '@/lib/game/decor-art';
import { decorByType } from '@/lib/game/decor';
import { GameIcon } from '@/components/GameIcon';
import { ServiceDeck } from '@/components/ServiceDeck';
import { AppearanceTrim } from '@/components/AppearanceTrim';
import type { RoadConnections } from '@/lib/game/city-connections';

export type { RoadConnections } from '@/lib/game/city-connections';
type Props = { type: string; className?: string; connections?: RoadConnections; decorative?: boolean; label?: string };

export function DecorArt({ type, className = '', connections, decorative = true, label }: Props) {
  const sprite = decorSpriteByType(type);
  const deck = type === 'road';
  const imageLabel = label ?? decorByType(type)?.name ?? 'Оформление колонии';
  if (!sprite) return <span className={`decorArt ${className}`.trim()} aria-hidden={decorative ? true : undefined}
    role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : imageLabel}><GameIcon name="building" size={32} /></span>;
  const scale = 300 / Math.max(sprite[2], sprite[3]);
  const width = sprite[2] * scale, height = sprite[3] * scale;
  return <svg className={`decorArt decorArt-${type} ${className}`.trim()} viewBox={deck ? '0 0 160 160' : '0 0 320 320'} width="100%" height="100%" focusable="false"
    data-decor-art={type} data-decor-renderer={deck ? 'connected-deck' : 'lunar-atlas'}
    aria-hidden={decorative ? true : undefined} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : imageLabel}>
    {deck ? <ServiceDeck connections={connections ?? {}} /> : <><AppearanceTrim type={type} kind="decor" /><svg x={(320 - width) / 2} y={310 - height} width={width} height={height}
      viewBox={sprite.join(' ')} preserveAspectRatio="none" overflow="hidden">
      <image className="colonyObjectImage" href={DECOR_ATLAS.src} width={DECOR_ATLAS.width} height={DECOR_ATLAS.height} />
    </svg></>}
  </svg>;
}
