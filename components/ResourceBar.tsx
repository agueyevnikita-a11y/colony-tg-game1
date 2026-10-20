'use client';

import { useEffect, useRef, useState } from 'react';
import { GameIcon } from '@/components/GameIcon';

const RESOURCES = [
  { key: 'ore', label: 'Руда', hint: 'Для построек и плавки' },
  { key: 'energy', label: 'Энергия', hint: 'Для работы производства' },
  { key: 'parts', label: 'Детали', hint: 'Для новых возможностей' },
  { key: 'credits', label: 'Кредиты', hint: 'Для развития города' },
  { key: 'crystals', label: 'Кристаллы', hint: 'Награды и оформление' },
  { key: 'science', label: 'Наука', hint: 'Для технологий' },
];
const format = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 1, notation: value > 99999 ? 'compact' : 'standard' });

function ResourceTile({ resource, value, capacity, scienceRate, onHelp }: {
  resource: typeof RESOURCES[number]; value: number; capacity?: number; scienceRate: number; onHelp: () => void;
}) {
  const previous = useRef(value);
  const [change, setChange] = useState<{ value: number; key: number } | null>(null);
  const full = capacity !== undefined && value >= capacity;
  useEffect(() => {
    const delta = value - previous.current;
    previous.current = value;
    if (!delta) return;
    setChange({ value: delta, key: Date.now() });
    const timer = window.setTimeout(() => setChange(null), 1800);
    return () => window.clearTimeout(timer);
  }, [value]);
  return <button type="button" className={`resource resourceTile${full ? ' isFull' : ''}`} onClick={onHelp}
    aria-label={`${resource.label}: ${format(value)}${capacity !== undefined ? ` из ${format(capacity)}` : ''}. ${resource.hint}. Открыть справку`}>
    <span className="resourceLabel"><GameIcon name={resource.key} size={17} />{resource.label}</span>
    <b>{format(value)}</b>
    <small>{capacity !== undefined ? full ? 'Склад заполнен' : `из ${format(capacity)}` : resource.key === 'science' && scienceRate > 0 ? `+${format(scienceRate)} в час` : resource.hint}</small>
    {change && <i key={change.key} className={`resourceDelta ${change.value > 0 ? 'isPositive' : ''}`} aria-hidden="true">{change.value > 0 ? '+' : '−'}{format(Math.abs(change.value))}</i>}
  </button>;
}

export function ResourceBar({ state, caps = {}, escrow = {}, scienceRate = 0, onHelp }: {
  state: Record<string, unknown>; caps?: Record<string, unknown>; escrow?: Record<string, unknown>; scienceRate?: number; onHelp: () => void;
}) {
  return <div className="resources colonyResources" aria-label="Ресурсы колонии">{RESOURCES.map((resource) => <ResourceTile
    key={resource.key} resource={resource} value={Number(state[resource.key] ?? 0)} scienceRate={scienceRate} onHelp={onHelp}
    capacity={caps[resource.key] === undefined ? undefined : Math.max(0, Number(caps[resource.key]) - Number(escrow[resource.key] ?? 0))}
  />)}</div>;
}
