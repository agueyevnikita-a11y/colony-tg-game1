import { GameIcon } from '@/components/GameIcon';
import { FEATURE_RESEARCH, type ColonyFeature } from '@/lib/game/unlocks';

export function FeatureUnlock({ feature, busy, onResearch }: { feature: ColonyFeature; busy: boolean; onResearch: (key: string) => void }) {
  const config = FEATURE_RESEARCH[feature];
  return <section className="card featureUnlock" aria-labelledby={`feature-${feature}-title`}>
    <span className="featureUnlockIcon"><GameIcon name={config.icon} size={36} /><GameIcon name="lock" size={16} /></span>
    <h2 id={`feature-${feature}-title`}>{config.title} предстоит открыть</h2>
    <p>{config.description}</p>
    <p>Изучи технологию «{config.name}». План покажет нужный уровень базы, лабораторию и стоимость шагов.</p>
    <button type="button" className="action" disabled={busy} onClick={() => onResearch(config.researchKey)}><GameIcon name="research" size={18} />План открытия</button>
  </section>;
}
