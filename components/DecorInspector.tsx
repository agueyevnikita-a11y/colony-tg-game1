'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { DecorArt } from '@/components/DecorArt';
import { GameAmount, GameIcon } from '@/components/GameIcon';
import { calculateComfort, COMFORT_MAX } from '@/lib/game/comfort';
import type { DecorCatalogItem } from '@/lib/game/decor';
import '@/app/decor-inspector.css';

type Decor = { id: string; type: string; x: number; y: number };
type Props = {
  decor: Decor;
  catalogItem?: DecorCatalogItem;
  allDecor: Decor[];
  open: boolean;
  busy: boolean;
  onMove: () => void;
  onRemove: () => Promise<void>;
};
const number = (value: number) => value.toLocaleString('ru-RU');

export function DecorInspector({ decor, catalogItem, allDecor, open, busy, onMove, onRemove }: Props) {
  const id = useId();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guard = useRef(false);
  const removeButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const current = calculateComfort(allDecor).score;
  const after = calculateComfort(allDecor.filter(item => item.id !== decor.id)).score;
  const loss = Math.max(0, current - after);
  const price = Number(catalogItem?.credits ?? 0);
  const refund = Number.isFinite(price) ? Math.max(0, Math.floor(price / 2)) : 0;
  const locked = busy || pending;

  useEffect(() => { if (!open) { setConfirming(false); setError(null); } }, [open]);
  useEffect(() => { if (confirming && open) confirmButton.current?.focus(); }, [confirming, open]);

  async function remove() {
    if (!open || !confirming || locked || guard.current) return;
    guard.current = true;
    setPending(true);
    setError(null);
    try { await onRemove(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось убрать декор. Попробуй ещё раз.'); }
    finally { guard.current = false; setPending(false); }
  }

  return <section className="card buildingInspector decorInspector" data-decor-inspector aria-busy={pending}>
    <div className="inspectorHead"><div className="inspectorEmoji"><DecorArt type={decor.type} /></div><div><h2>{catalogItem?.name ?? decor.type}</h2><p>Декор · клетка {Number(decor.x) + 1}:{Number(decor.y) + 1}</p></div></div>
    <p className="buildingPurpose">{catalogItem?.description ?? 'Благоустройство города.'}</p>
    <div className="decorInspectorComfort"><GameIcon name="comfort" size={19} /><div><strong>Комфорт колонии: {current}/{COMFORT_MAX}</strong><span>Положение объекта не влияет на очки. Его можно бесплатно перенести.</span></div></div>
    <button type="button" className="action inspectorShortcut" disabled={locked} onClick={onMove}><GameIcon name="move" size={17} />Переместить бесплатно</button>
    {!confirming ? <button ref={removeButton} type="button" className="action secondary" data-decor-remove disabled={locked} onClick={() => { setConfirming(true); setError(null); }}>Убрать декор</button> : <div className="decorRemoveConfirm" role="group" aria-labelledby={`${id}-confirm`}>
      <h3 id={`${id}-confirm`}>Демонтировать «{catalogItem?.name ?? decor.type}»?</h3>
      <p>Вернётся 50% цены: <GameAmount resource="credits">{number(refund)}</GameAmount>. Чтобы поставить объект снова, придётся заплатить полную стоимость.</p>
      <div className="decorRemovePreview" data-decor-remove-preview><span>Комфорт после демонтажа</span><strong>{current} → {after}/{COMFORT_MAX}</strong><small>{loss ? `Уменьшится на ${loss} очков.` : 'Не изменится: учитываются другие объекты и предел комфорта.'} Уже открытые достижения и награды сохранятся.</small></div>
      <div className="decorRemoveActions"><button ref={confirmButton} type="button" className="action secondary decorRemoveSubmit" data-decor-remove-confirm disabled={locked} onClick={() => void remove()}>{pending ? 'Убираем…' : 'Подтвердить демонтаж'}</button><button type="button" className="miniButton" data-decor-remove-cancel disabled={locked} onClick={() => { setConfirming(false); setError(null); requestAnimationFrame(() => removeButton.current?.focus()); }}>Оставить декор</button></div>
    </div>}
    {error && <div className="notice error decorRemoveFeedback" data-decor-remove-feedback role="alert">{error}</div>}
  </section>;
}
