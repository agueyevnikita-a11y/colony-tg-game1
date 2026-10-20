import { GameIcon } from '@/components/GameIcon';
import '@/app/city-art.css';

type Props = { type: string; className?: string; decorative?: boolean; label?: string };

const SPRITES = [
  'hq', 'mine', 'solar', 'warehouse', 'foundry', 'habitat', 'trade_hub', 'research_lab',
  'logistics', 'expedition_center', 'alliance_hub', 'observatory', 'deep_mine', 'solar_array', 'park', 'statue',
];

const LABELS: Record<string, string> = {
  hq: 'Штаб колонии', mine: 'Шахта', solar: 'Электростанция', warehouse: 'Склад', foundry: 'Литейный цех',
  habitat: 'Жилой модуль', trade_hub: 'Торговый центр', research_lab: 'Исследовательский центр', logistics: 'Логистический центр',
  expedition_center: 'Центр экспедиций', alliance_hub: 'Центр альянса', observatory: 'Обсерватория',
  deep_mine: 'Глубинная шахта', solar_array: 'Солнечный массив', park: 'Парк', statue: 'Монумент колонии',
};

export function BuildingArt({ type, className = '', decorative = true, label }: Props) {
  const index = SPRITES.indexOf(type);
  const imageLabel = label ?? LABELS[type] ?? 'Здание колонии';
  return <span className={`buildingArt ${index < 0 ? 'buildingArtFallback' : ''} ${className}`.trim()}
    data-building-art={type} aria-hidden={decorative ? true : undefined} role={decorative ? undefined : 'img'}
    aria-label={decorative ? undefined : imageLabel}
    style={index < 0 ? undefined : { backgroundPosition: `${index % 4 * 100 / 3}% ${Math.floor(index / 4) * 100 / 3}%` }}>
    {index < 0 && <GameIcon name="building" size={32} />}
  </span>;
}
