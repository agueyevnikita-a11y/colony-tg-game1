import { GameIcon } from '@/components/GameIcon';
import { HABITAT_ART } from '@/lib/game/habitat-art';
import '@/app/city-art.css';

type Props = { type: string; className?: string; decorative?: boolean; label?: string };

// The source sheet is hand arranged, not a uniform 4×4 atlas. Each viewport
// isolates a complete building, including antennas, from neighbouring sprites.
const SPRITES: Record<string, [number, number, number, number]> = {
  hq: [14, 3, 308, 304], mine: [331, 49, 301, 258], solar: [638, 17, 306, 289], warehouse: [949, 56, 301, 250],
  foundry: [10, 305, 314, 293], habitat: [329, 317, 304, 277], trade_hub: [636, 313, 311, 283], research_lab: [954, 314, 299, 282],
  logistics: [8, 642, 326, 253], expedition_center: [339, 593, 302, 305], alliance_hub: [644, 600, 310, 307], observatory: [959, 597, 289, 301],
  deep_mine: [9, 892, 319, 324], solar_array: [337, 911, 307, 299], park: [643, 942, 317, 261], statue: [956, 893, 307, 317],
};

const LABELS: Record<string, string> = {
  hq: 'Штаб колонии', mine: 'Шахта', solar: 'Электростанция', warehouse: 'Склад', foundry: 'Литейный цех',
  habitat: 'Жилой модуль', trade_hub: 'Торговый центр', research_lab: 'Исследовательский центр', logistics: 'Логистический центр',
  expedition_center: 'Центр экспедиций', alliance_hub: 'Центр альянса', observatory: 'Обсерватория',
  deep_mine: 'Глубинная шахта', solar_array: 'Солнечный массив', park: 'Купольный сад', statue: 'Монумент первопроходцев',
};

export function BuildingArt({ type, className = '', decorative = true, label }: Props) {
  const sprite = type === 'habitat' ? HABITAT_ART.viewport : SPRITES[type];
  const source = type === 'habitat' ? HABITAT_ART : { src: '/art/buildings-atlas.webp', width: 1263, height: 1245 };
  const scale = sprite ? 300 / Math.max(sprite[2], sprite[3]) : 1;
  const width = sprite ? sprite[2] * scale : 300;
  const height = sprite ? sprite[3] * scale : 300;
  const imageLabel = label ?? LABELS[type] ?? 'Здание колонии';
  return <span className={`buildingArt ${!sprite ? 'buildingArtFallback' : ''} ${className}`.trim()}
    data-building-art={type} aria-hidden={decorative ? true : undefined} role={decorative ? undefined : 'img'}
    aria-label={decorative ? undefined : imageLabel}>
    {sprite ? <svg viewBox="0 0 320 320" width="100%" height="100%" aria-hidden="true" focusable="false">
      <svg x={(320 - width) / 2} y={310 - height} width={width} height={height} viewBox={sprite.join(' ')} preserveAspectRatio="none" overflow="hidden">
        <image href={source.src} width={source.width} height={source.height} />
      </svg>
    </svg> : <GameIcon name="building" size={32} />}
  </span>;
}
