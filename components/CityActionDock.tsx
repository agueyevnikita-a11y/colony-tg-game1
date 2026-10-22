'use client';

import { useId, useState } from 'react';
import { GameIcon } from '@/components/GameIcon';
import '@/app/city-action-dock.css';

export type CityActionDockItem = {
  key: string;
  label: string;
  icon: string;
  hint?: string;
  badge?: number;
  attention?: boolean;
  disabled?: boolean;
};

type Props = {
  /** The first four entries are primary; remaining entries belong to the disclosure. */
  items: readonly CityActionDockItem[];
  onAction: (key: string) => void;
  busy?: boolean;
};

export function CityActionDock({ items, onAction, busy = false }: Props) {
  const extraId = useId();
  const [expanded, setExpanded] = useState(false);
  const primary = items.slice(0, 4);
  const secondary = items.slice(4);
  const extraAttention = secondary.some(item => item.attention && !item.disabled);
  const attentionId = `${extraId}-available`;

  function action(item: CityActionDockItem) {
    const count = typeof item.badge === 'number' && Number.isFinite(item.badge) && item.badge > 0 ? Math.floor(item.badge) : 0;
    return <button key={item.key} type="button" className={`cityDockAction${item.attention ? ' hasAttention' : ''}`}
      data-city-action={item.key} disabled={busy || item.disabled} onClick={() => onAction(item.key)}>
      <span className="cityDockActionIcon" aria-hidden="true"><GameIcon name={item.icon} size={30} /></span>
      <span className="cityDockActionCopy"><strong>{item.label}</strong>{item.hint && <span>{item.hint}</span>}</span>
      {count > 0 && <span className="cityDockActionBadge" aria-label={`Количество: ${count}`}>{count > 99 ? '99+' : count}</span>}
    </button>;
  }

  if (!items.length) return null;

  return <nav className="cityActionDock" aria-label="Действия города" data-city-action-dock>
    <div className="cityDockGrid">{primary.map(action)}</div>
    {secondary.length > 0 && <>
      <button type="button" className="cityDockMore" aria-expanded={expanded} aria-controls={extraId}
        aria-describedby={extraAttention && !expanded ? attentionId : undefined} onClick={() => setExpanded(value => !value)}>
        <span>{expanded ? 'Свернуть' : 'Ещё'}</span>{extraAttention && !expanded && <span className="cityDockMoreAttention" aria-hidden="true" />}<GameIcon name="arrow" size={15} />
      </button>
      {extraAttention && !expanded && <span id={attentionId} className="gameSrOnly">Есть доступные действия</span>}
      <div id={extraId} className="cityDockGrid cityDockExtra" hidden={!expanded}>{secondary.map(action)}</div>
    </>}
  </nav>;
}
