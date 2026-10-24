import { BuildingArt } from '@/components/BuildingArt';
import { GameIcon } from '@/components/GameIcon';
import { DecorArt } from '@/components/DecorArt';
import { cityStyleClass, type AppearanceObject } from '@/lib/game/appearance';
import '@/app/cosmetics.css';
import '@/app/competition-rewards.css';

const LABELS: Record<string, string> = {
  badge_coop_champion: 'Знак чемпиона лунной лиги', frame_coop_orbit: 'Рамка лидера лунной лиги', frame_coop_team: 'Рамка ведущего альянса',
  title_coop_vanguard: 'Авангард лунной лиги', title_coop_team: 'Первопроходец альянса',
  theme_neon: 'Неоновый город', theme_first_signal: 'Тема Первого сигнала', weather_aurora: 'Северное сияние', frame_orbit: 'Орбитальная рамка',
  founder_pack: 'Набор основателя', founder_badge: 'Знак основателя', founder_monument: 'Монумент основателя',
  founder_frame: 'Рамка основателя', founder_sky: 'Небо основателя',
  monument_network: 'Монумент сети', relay_legend: 'Маяк легенды', frame_garden: 'Рамка живого города',
};
const FRAME_IDS = new Set(['frame_orbit', 'founder_frame', 'frame_first_signal', 'frame_exchange', 'frame_researcher', 'frame_pathfinder', 'frame_garden', 'frame_coop_orbit', 'frame_coop_team']);
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

export function CosmeticMonument({ id, decorative = true }: { id: string; decorative?: boolean }) {
  if (!id) return null;
  if (id === 'founder_monument') return <FounderMonument decorative={decorative} />;
  if (id !== 'monument_network' && id !== 'relay_legend') return <DecorArt type="statue" decorative={decorative} />;
  const legendary = id === 'relay_legend';
  return <svg className={`cosmeticMonumentArt ${legendary ? 'isRelayMonument' : 'isNetworkMonument'}`} viewBox="0 0 160 160" width="100%" height="100%" focusable="false"
    aria-hidden={decorative ? true : undefined} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : LABELS[id]}>
    <ellipse cx="80" cy="140" rx="64" ry="12" fill="#050d16" opacity=".45" />
    <path d="m17 112 63-32 63 32v12l-63 31-63-31Z" fill="#445c67" stroke="#809b9e" strokeWidth="1.5" />
    <path d="m17 112 63 31 63-31-63-32Z" fill="#9cafa8" /><path d="m80 143 63-31v12l-63 31Z" fill="#304955" />
    <path d="m35 114 45-23 45 23-45 22Z" fill={legendary ? '#655a79' : '#3b6d6a'} />
    {legendary ? <>
      <path d="m57 117 23-12 23 12v8l-23 12-23-12Z" fill="#d3bc8d" />
      <path d="m69 111 5-65 6-11 6 11 5 65-11 9Z" fill="#d0c6b0" /><path d="m80 35 6 11 5 65-11 9Z" fill="#74818e" />
      <path d="m80 13 14 22-14 22-14-22Z" fill="#bda2fa" /><path d="m80 13 14 22-14 22V13Z" fill="#846bc4" />
      <path d="m76 31 4-9 7 13-7 14" fill="none" stroke="#e5dcff" strokeWidth="2" />
      <path d="M58 40c-12 10-12 26 0 36m44-36c12 10 12 26 0 36M49 30c-19 17-19 38 0 55m62-55c19 17 19 38 0 55" fill="none" stroke="#b6a3e0" strokeWidth="2.5" opacity=".8" />
      <path d="m43 117 37 18 37-18" fill="none" stroke="#d8bf85" strokeWidth="2" />
    </> : <>
      <path d="M80 101V57m-31 58V88m62 27V88M49 88l31 16 31-16" fill="none" stroke="#8edccc" strokeWidth="5" />
      <path d="m65 57 15-8 15 8v45l-15 8-15-8Z" fill="#c8d6c9" /><path d="m80 65 15-8v45l-15 8Z" fill="#547f85" />
      <path d="m65 57 15 8 15-8-15-8Z" fill="#e0e8d9" />
      <path d="m80 29 13 13-13 17-13-17Z" fill="#8be6d0" /><path d="m80 29 13 13-13 17V29Z" fill="#42a99f" />
      {[49, 111].map(x => <g key={x} transform={`translate(${x} 79)`}><path d="m-11 6 11-6 11 6v24L0 36l-11-6Z" fill="#c1d0c2" /><path d="M0 12 11 6v24L0 36Z" fill="#4c747c" /><path d="m0-8 9 11-9 11L-9 3Z" fill="#95dbc6" /></g>)}
      <path d="m43 119 37 18 37-18" fill="none" stroke="#8bddc0" strokeWidth="2" />
    </>}
  </svg>;
}

export function CosmeticBadge({ id, label, decorative = false }: { id: string; label?: string; decorative?: boolean }) {
  const founder = id === 'founder_badge', champion = id === 'badge_coop_champion';
  return <span className={`cosmeticBadge ${founder ? 'isFounderBadge' : champion ? 'isChampionBadge' : 'isEarnedBadge'}`}
    title={label ?? LABELS[id] ?? 'Знак колонии'} aria-label={decorative ? undefined : label ?? LABELS[id] ?? 'Знак колонии'}
    role={decorative ? undefined : 'img'} aria-hidden={decorative ? true : undefined}>
    <GameIcon name={champion ? 'trophy' : 'star'} size={founder || champion ? 15 : 13} />
  </span>;
}

export function CosmeticPreview({ cosmeticId, category, label, className = '', subject }: {
  cosmeticId: string; category?: string; label?: string; className?: string; subject?: AppearanceObject;
}) {
  const founderPack = cosmeticId === 'founder_pack';
  const theme = cityStyleClass(cosmeticId);
  const weather = founderPack ? 'founder_sky' : cosmeticId === 'weather_aurora' || cosmeticId === 'founder_sky' || cosmeticId === 'weather_signal_storm' ? cosmeticId : '';
  const frame = founderPack ? 'founder_frame' : category === 'frame' || FRAME_IDS.has(cosmeticId) ? cosmeticId : '';
  const monument = founderPack || ['founder_monument', 'monument_network', 'relay_legend'].includes(cosmeticId) || (category === 'building_skin' && !!cosmeticId);
  const badge = founderPack || cosmeticId === 'founder_badge' ? 'founder_badge' : category === 'badge' ? cosmeticId : '';
  const title = label ?? LABELS[cosmeticId] ?? (cosmeticId ? 'Оформление колонии' : category === 'building_skin' ? 'Монумент не выбран' : 'Базовое оформление');
  return <figure className={`cosmeticPreview ${className}`.trim()} aria-label={subject ? `${subject.name} · ${title}` : title} data-preview-subject={subject?.key}>
    <div className={`cosmeticPreviewSurface cosmeticSurface cityMap cityArtMap ${theme} ${cosmeticFrameClass(frame)}`}>
      <CosmeticAtmosphere weather={weather} effect={category === 'effect' ? cosmeticId : ''} />
      <div className="cosmeticPreviewName"><div><span>COLONY</span>{category === 'title' && cosmeticId && <small className="cosmeticPreviewTitle">{label?.replace(/^Титул:\s*/i, '') ?? 'Титул колонии'}</small>}</div>{badge && <CosmeticBadge id={badge} decorative />}</div>
      <div className={`cosmeticPreviewBuildings${subject ? ' isObjectPreview' : ''}`} aria-hidden="true">
        {subject ? subject.kind === 'building' ? <BuildingArt type={subject.type} /> : <DecorArt type={subject.type} /> : <>
          <BuildingArt type={theme ? 'solar' : 'mine'} /><BuildingArt type="hq" />{monument ? <CosmeticMonument id={founderPack ? 'founder_monument' : cosmeticId} /> : theme ? <DecorArt type="park" /> : <BuildingArt type="foundry" />}
        </>}
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
