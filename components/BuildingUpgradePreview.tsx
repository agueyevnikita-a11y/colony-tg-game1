import { useId } from 'react';
import { GameIcon } from '@/components/GameIcon';
import '@/app/building-upgrade-preview.css';

export type BuildingUpgradePreviewData = {
  currentLevel: number;
  targetLevel: number;
  title?: string;
  metrics: readonly {
    key: string;
    label: string;
    icon?: string;
    resource?: string;
    before: string;
    after: string;
  }[];
  note?: string;
};

/** The caller supplies verified benefits; this view never starts an upgrade. */
export function BuildingUpgradePreview({ preview }: { preview: BuildingUpgradePreviewData | null }) {
  const id = useId();
  if (!preview || !Number.isInteger(preview.currentLevel) || !Number.isInteger(preview.targetLevel)
    || preview.currentLevel < 1 || preview.targetLevel <= preview.currentLevel) return null;

  return <section className="buildingUpgradePreview" aria-labelledby={`${id}-title`} data-upgrade-preview>
    <div className="buildingUpgradePreviewHeading">
      <h3 id={`${id}-title`}>{preview.title ?? 'Что изменится'}</h3>
      <span className="buildingUpgradeLevels" aria-label={`Уровень ${preview.currentLevel}, после улучшения ${preview.targetLevel}`}>
        <span>Ур. {preview.currentLevel}</span><GameIcon name="arrow" size={13} /><strong>{preview.targetLevel}</strong>
      </span>
    </div>
    {preview.metrics.length > 0 && <>
      <div className="buildingUpgradeColumns" aria-hidden="true"><span /><span>Сейчас <i>→</i> После</span></div>
      <dl className="buildingUpgradeMetrics">
        {preview.metrics.map(metric => <div className="buildingUpgradeMetric" key={metric.key} data-upgrade-metric={metric.key}>
          <dt>{(metric.resource || metric.icon) && <GameIcon name={metric.resource ?? metric.icon!} size={18} />}<span>{metric.label}</span></dt>
          <dd><span className="buildingUpgradeBefore"><span className="gameSrOnly">Сейчас: </span>{metric.before}</span>
            <GameIcon name="arrow" size={13} />
            <strong className="buildingUpgradeAfter"><span className="gameSrOnly">После: </span>{metric.after}</strong></dd>
        </div>)}
      </dl>
    </>}
    {preview.note && <p className="buildingUpgradeNote">{preview.note}</p>}
  </section>;
}
