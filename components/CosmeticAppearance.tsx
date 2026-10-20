import { BuildingArt } from '@/components/BuildingArt';
import { GameIcon } from '@/components/GameIcon';
import '@/app/cosmetics.css';

const LABELS: Record<string, string> = {
  theme_neon: 'Неоновый город', weather_aurora: 'Северное сияние', frame_orbit: 'Орбитальная рамка',
  founder_pack: 'Набор основателя', founder_badge: 'Знак основателя', founder_monument: 'Монумент основателя',
  founder_frame: 'Рамка основателя', founder_sky: 'Небо основателя',
};
const FRAME_IDS = new Set(['frame_orbit', 'founder_frame', 'frame_first_signal', 'frame_exchange', 'frame_researcher', 'frame_pathfinder']);
const SIGNAL_IDS = new Set(['effect_signal', 'effect_alliance_signal', 'effect_relay_veteran']);

export function cosmeticFrameClass(frame?: string) {
  return frame ? `cosmeticFrame ${FRAME_IDS.has(frame) ? frame : 'frame_earned'}` : '';
}

export function CosmeticAtmosphere({ weather, effect }: { weather?: string; effect?: string }) {
  const sky = weather === 'weather_aurora' || weather === 'founder_sky' || weather === 'weather_signal_storm';
  const signal = effect && SIGNAL_IDS.has(effect);
  if (!sky && !signal) return null;
  return <div className="cosmeticAtmosphere" aria-hidden="true">
    {sky && <div className={`cosmeticSky ${weather === 'founder_sky' ? 'isFounderSky' : weather === 'weather_signal_storm' ? 'isSignalStorm' : 'isAuroraSky'}`}><i /><i /><span /></div>}
    {signal && <div className="cosmeticSignal"><i /><i /></div>}
  </div>;
}

export function FounderMonument({ decorative = true }: { decorative?: boolean }) {
  return <img className="founderMonumentArt" src="/art/founder-monument.webp" width={1254} height={1254}
    alt={decorative ? '' : 'Монумент основателя'} aria-hidden={decorative ? true : undefined} />;
}

export function CosmeticBadge({ id, label, decorative = false }: { id: string; label?: string; decorative?: boolean }) {
  const founder = id === 'founder_badge';
  return <span className={`cosmeticBadge ${founder ? 'isFounderBadge' : 'isEarnedBadge'}`}
    title={label ?? LABELS[id] ?? 'Знак колонии'} aria-label={decorative ? undefined : label ?? LABELS[id] ?? 'Знак колонии'}
    role={decorative ? undefined : 'img'} aria-hidden={decorative ? true : undefined}>
    <GameIcon name="star" size={founder ? 15 : 13} />
  </span>;
}

export function CosmeticPreview({ cosmeticId, category, label, className = '' }: {
  cosmeticId: string; category?: string; label?: string; className?: string;
}) {
  const founderPack = cosmeticId === 'founder_pack';
  const theme = cosmeticId === 'theme_neon' || cosmeticId === 'theme_first_signal' ? cosmeticId : '';
  const weather = founderPack ? 'founder_sky' : cosmeticId === 'weather_aurora' || cosmeticId === 'founder_sky' || cosmeticId === 'weather_signal_storm' ? cosmeticId : '';
  const frame = founderPack ? 'founder_frame' : category === 'frame' || FRAME_IDS.has(cosmeticId) ? cosmeticId : '';
  const monument = founderPack || cosmeticId === 'founder_monument';
  const badge = founderPack || cosmeticId === 'founder_badge' ? 'founder_badge' : category === 'badge' ? cosmeticId : '';
  const title = label ?? LABELS[cosmeticId] ?? (cosmeticId ? 'Оформление колонии' : 'Базовое оформление');
  return <figure className={`cosmeticPreview ${className}`.trim()} aria-label={title}>
    <div className={`cosmeticPreviewSurface cosmeticSurface cityMap cityArtMap ${theme} ${cosmeticFrameClass(frame)}`}>
      <CosmeticAtmosphere weather={weather} effect={category === 'effect' ? cosmeticId : ''} />
      <div className="cosmeticPreviewName"><div><span>COLONY</span>{category === 'title' && cosmeticId && <small className="cosmeticPreviewTitle">{label?.replace(/^Титул:\s*/i, '') ?? 'Титул колонии'}</small>}</div>{badge && <CosmeticBadge id={badge} decorative />}</div>
      <div className="cosmeticPreviewBuildings" aria-hidden="true">
        <BuildingArt type="mine" /><BuildingArt type="hq" />{monument ? <FounderMonument /> : <BuildingArt type="foundry" />}
      </div>
    </div>
    <figcaption>{title}</figcaption>
  </figure>;
}

export function ColonyIdentity({ name, cosmetics, compact = false }: { name: string; cosmetics: any[]; compact?: boolean }) {
  // Public city responses already contain only equipped items and omit the flag.
  const equipped = (Array.isArray(cosmetics) ? cosmetics : []).filter((item) => item && item.equipped !== false);
  const frame = equipped.find((item) => item.category === 'frame');
  const badge = equipped.find((item) => item.category === 'badge');
  const title = equipped.find((item) => item.category === 'title');
  const titleLabel = typeof title?.metadata?.label === 'string' ? title.metadata.label : typeof title?.name === 'string' ? title.name.replace(/^Титул:\s*/i, '') : '';
  return <div className={`colonyIdentity ${compact ? 'isCompact' : ''} ${cosmeticFrameClass(frame?.cosmetic_id)}`}>
    <div className="colonyIdentityName">{badge && <CosmeticBadge id={badge.cosmetic_id} label={badge.name} />}<span>{name}</span></div>
    {titleLabel && <div className="colonyIdentityTitle"><GameIcon name="star" size={12} /><span>{titleLabel}</span></div>}
  </div>;
}
