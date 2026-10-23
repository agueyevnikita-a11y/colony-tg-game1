'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { GameAmount, GameIcon } from '@/components/GameIcon';
import type { SupplyProjectsState } from '@/lib/game/supply-projects';
import '@/app/supply-projects.css';

type Resource = 'ore' | 'energy' | 'parts';
type Props = {
  state?: SupplyProjectsState;
  resources: Record<string, unknown>;
  ownerKey: string;
  selectedProjectKey?: string | null;
  onSelectProject: (key: string) => void;
  busy: boolean;
  onAction: (body: Record<string, unknown>) => Promise<any>;
  onBuildLogistics: () => void;
  onUpgradeHq?: () => void;
  onProduction: () => void;
  onRefresh: () => void;
};
type Feedback = { projectKey: string; text: string; error: boolean };
const RESOURCE_ORDER: Resource[] = ['parts', 'ore', 'energy'];
const RESOURCE_LABELS: Record<Resource, string> = { ore: 'Руда', energy: 'Энергия', parts: 'Детали' };
const RESOURCE_UNITS: Record<Resource, string> = { ore: 'руды', energy: 'энергии', parts: 'деталей' };
const TITLES: Record<string, string> = {
  title_cargo_dispatcher: 'Диспетчер лунного конвоя',
  title_polar_engineer: 'Исследователь полюса',
  title_dawn_founder: 'Основатель Рассвета',
};
const n = (value: unknown) => Math.max(0, Number(value ?? 0)).toLocaleString('ru-RU');
function receiptId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function rewardAmounts(reward: { credits: number; science: number; crystals: number; cosmeticIds: string[] }) {
  return <><span className="supplyAmounts">{(['credits', 'science', 'crystals'] as const).filter(resource => reward[resource] > 0).map(resource => <GameAmount key={resource} resource={resource}>{n(reward[resource])}</GameAmount>)}</span>{reward.cosmeticIds.length > 0 && <small className="supplyTitleReward"><GameIcon name="trophy" size={14} />{reward.cosmeticIds.map(id => TITLES[id] ?? 'Памятный титул').join(' · ')}</small>}</>;
}

/** Planning is local. Every shipment and reward requires a separate explicit action. */
export function SupplyProjectsPanel(props: Props) {
  const id = useId();
  const [resource, setResource] = useState<Resource>('parts');
  const [draft, setDraft] = useState({ key: '', text: '' });
  const [pending, setPending] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const receipts = useRef(new Map<string, string>());
  const guard = useRef(false);
  const requestSequence = useRef(0);
  const owner = useRef(props.ownerKey);
  owner.current = props.ownerKey;
  const picker = useRef<HTMLDetailsElement>(null);
  const project = props.state?.projects.find(item => item.id === props.selectedProjectKey)
    ?? props.state?.projects.find(item => !item.completed) ?? props.state?.projects[0];
  const stage = project && !project.completed ? project.stages[project.stageIndex] : null;
  const locked = props.busy || Boolean(pending);
  const remaining = Math.max(0, Number(project?.remaining[resource] ?? 0));
  const formKey = `${props.ownerKey}:${project?.id}:${project?.stageIndex}:${resource}`;
  const amountText = draft.key === formKey ? draft.text : String(remaining || '');
  const validAmount = /^[1-9]\d*$/.test(amountText) && Number.isSafeInteger(Number(amountText)) && Number(amountText) <= 1_000_000;
  const requested = validAmount ? Number(amountText) : 0;
  const accepted = Math.min(requested, remaining);
  const available = Math.max(0, Math.floor(Number(props.resources[resource] ?? 0)));
  const shortage = Math.max(0, accepted - available);
  const deliveryIssue = !validAmount ? 'Введи целое число от 1 до 1 000 000.' : remaining <= 0 ? 'Этот ресурс уже доставлен. Выбери другой.' : '';

  useEffect(() => {
    requestSequence.current++;
    guard.current = false; setPending(''); setFeedback(null); setResource('parts'); setDraft({ key: '', text: '' });
  }, [props.ownerKey]);
  useEffect(() => { setResource('parts'); setDraft({ key: '', text: '' }); }, [project?.id, project?.stageIndex]);

  async function act(action: 'deliver' | 'claim') {
    if (!project || !stage || project.completed || !props.state?.available || locked || guard.current) return;
    if (action === 'deliver' && (!props.state.unlocked || deliveryIssue || shortage > 0 || accepted <= 0 || project.ready)) return;
    if (action === 'claim' && !project.ready) return;
    const body = { action, projectKey: project.id, definitionVersion: project.version, expectedStage: project.stageIndex,
      ...(action === 'deliver' ? { resource, amount: requested } : {}) };
    const storageKey = `colony:supply:${props.ownerKey}:${JSON.stringify(body)}`;
    const capturedOwner = props.ownerKey, capturedProject = project.id, capturedStage = project.stageIndex;
    const sequence = ++requestSequence.current;
    guard.current = true; setPending(action); setFeedback(null);
    try {
      let requestId = receipts.current.get(storageKey);
      if (!requestId) {
        try { requestId = sessionStorage.getItem(storageKey) ?? undefined; } catch { /* Keep the receipt in memory if storage is unavailable. */ }
        if (!requestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) requestId = receiptId();
        receipts.current.set(storageKey, requestId);
        try { sessionStorage.setItem(storageKey, requestId); } catch { /* The current session still retains the receipt. */ }
      }
      const response = await props.onAction({ ...body, requestId });
      if (owner.current !== capturedOwner || requestSequence.current !== sequence) return;
      const result = response?.result;
      const identityMatches = result?.projectKey === capturedProject && result?.definitionVersion === body.definitionVersion;
      const acknowledged = identityMatches && (action === 'deliver'
        ? result.stageIndex === capturedStage && result.resource === resource && Number.isSafeInteger(result.accepted)
          && result.accepted > 0 && result.accepted <= requested && result.accepted <= accepted
        : result.claimedStage === capturedStage && result.stageIndex === capturedStage + 1);
      if (!acknowledged) throw new Error('Подтверждение поставки не получено. Обнови проект и проверь результат.');
      const text = action === 'claim' ? `Награда этапа ${capturedStage + 1} получена. ${capturedStage + 1 >= project.stages.length ? 'Проект завершён. Все его награды получены.' : 'Следующий этап открыт.'}`
        : `Доставлено ${n(result.accepted)} ${RESOURCE_UNITS[resource]}. Поставка сохранена.`;
      setFeedback({ projectKey: capturedProject, text, error: false });
      receipts.current.delete(storageKey);
      try { sessionStorage.removeItem(storageKey); } catch { /* A stale receipt can only replay its original result. */ }
    } catch (cause) {
      if (owner.current === capturedOwner && requestSequence.current === sequence) setFeedback({ projectKey: capturedProject,
        text: cause instanceof Error ? cause.message : 'Не удалось выполнить действие. Обнови колонию и попробуй снова.', error: true });
    } finally {
      if (owner.current === capturedOwner && requestSequence.current === sequence) { guard.current = false; setPending(''); }
    }
  }

  return <section className="card supplyProjects" data-supply-projects aria-labelledby={`${id}-title`}>
    <div className="cardTitleRow"><div><h2 id={`${id}-title`}><GameIcon name="contracts" size={22} />Проекты снабжения</h2><p>Выбери цель для колонии и доставляй ресурсы частями. Каждый этап даёт награду на развитие.</p></div><span className="supplyNoDeadline"><GameIcon name="check" size={14} />Без срока</span></div>
    {!props.state?.available ? <div className="supplyNotice" role="status"><p>Проекты появятся после обновления сервера. Существующие запасы сохраняются.</p><button type="button" className="miniButton" disabled={locked} onClick={props.onRefresh}>Проверить проекты</button></div> : <>
      {!props.state.unlocked && <div className="supplyNotice" data-supply-lock><GameIcon name="lock" size={20} /><div><strong>{props.state.lockReason === 'hq' ? `Нужен центр колонии ур. ${props.state.requiredHq}` : props.state.logistics ? `Логистический центр ${props.state.logistics.status === 'upgrading' ? 'улучшается' : 'строится'}` : 'Нужен логистический центр'}</strong><p>Работающий логистический центр принимает поставки. Уже доставленное сохраняется, готовые награды можно забрать.</p>{props.state.logistics?.completesAt && <small>Готовность: {new Date(props.state.logistics.completesAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>}
        {props.state.lockReason === 'hq' ? props.onUpgradeHq && <button type="button" className="miniButton" disabled={locked} onClick={props.onUpgradeHq}>К центру колонии</button> : !props.state.logistics ? <button type="button" className="miniButton" disabled={locked} onClick={props.onBuildLogistics}>Построить логистический центр</button> : <button type="button" className="miniButton" disabled={locked} onClick={props.onRefresh}>Проверить готовность</button>}</div></div>}
      <details className="supplyPicker" ref={picker}><summary><GameIcon name="target" size={18} /><span>Выбрать цель<span>{props.state.projects.filter(item => item.completed).length}/{props.state.projects.length} проектов завершено</span></span></summary><div className="supplyProjectChoices">{props.state.projects.map(item => <button type="button" className={`supplyProjectChoice${item.id === project?.id ? ' isSelected' : ''}`} aria-pressed={item.id === project?.id} disabled={locked} key={item.id} onClick={() => { props.onSelectProject(item.id); if (picker.current) picker.current.open = false; }}><GameIcon name={item.icon} size={29} /><span><strong>{item.name}</strong><small>{item.completed ? 'Все этапы завершены' : `${item.stageIndex + 1}/${item.stages.length} · ${item.started ? 'Поставки начаты' : 'Можно начать'}`}</small><small>{item.description}</small></span></button>)}</div><p>Цель можно менять. Поставки каждого проекта сохраняются; выбор ничего не списывает.</p></details>
      {project && <>
        <div className="supplyProjectHeading"><GameIcon name={project.icon} size={36} /><div><h3>{project.name}</h3><p>{project.description}</p></div></div>
        {project.completed ? <div className="supplyCompleted" role="status"><GameIcon name="trophy" size={26} /><div><strong>Проект завершён</strong><p>Все награды получены. Памятный титул доступен в коллекции оформления.</p>{project.completedAt && <small>{new Date(project.completedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</small>}</div></div> : stage && <>
          <div className="supplyStageHeading"><span>Этап {project.stageIndex + 1}/{project.stages.length}</span><h4>{stage.name}</h4></div>
          <div className="supplyProgressList">{RESOURCE_ORDER.map(key => {
            const total = Number(stage.requirements[key]), supplied = Number(project.delivered[key]);
            return total > 0 ? <div className="supplyResourceProgress" key={key}><div><GameAmount resource={key}>{n(supplied)} / {n(total)}</GameAmount><span>{supplied >= total ? 'Доставлено' : `Осталось ${n(project.remaining[key])}`}</span></div><div className="supplyProgressBar" role="progressbar" aria-label={`${RESOURCE_LABELS[key]}: доставлено`} aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.min(total, supplied)}><i style={{ width: `${Math.min(100, supplied / total * 100)}%` }} /></div></div> : null;
          })}</div>
          <div className="supplyStageReward"><span>Награда этого этапа</span>{rewardAmounts(stage.reward)}</div>
          {project.ready ? <div className="supplyClaim"><p><GameIcon name="check" size={16} />Все ресурсы доставлены. Забери награду, чтобы открыть следующий этап.</p><button type="button" className="action" disabled={locked} onClick={() => { void act('claim'); }}>{pending === 'claim' ? 'Получаем…' : 'Забрать награду этапа'}</button></div> : <form className="supplyShipment" onSubmit={event => { event.preventDefault(); void act('deliver'); }}>
            <fieldset disabled={locked}><legend>Что доставить</legend><div className="supplyResourceChoices">{RESOURCE_ORDER.map(key => <label key={key} className={key === resource ? 'isSelected' : ''}><input type="radio" name={`${id}-resource`} value={key} checked={key === resource} onChange={() => setResource(key)} /><GameIcon name={key} size={23} /><span>{RESOURCE_LABELS[key]}</span>{Number(project.remaining[key]) <= 0 && <GameIcon name="check" size={13} />}</label>)}</div></fieldset>
            <label className="supplyAmountLabel" htmlFor={`${id}-amount`}>Количество<input id={`${id}-amount`} inputMode="numeric" autoComplete="off" value={amountText} maxLength={7} disabled={locked || remaining <= 0} onChange={event => setDraft({ key: formKey, text: event.target.value })} aria-describedby={`${id}-shipment-help`} /></label>
            <div className="supplyAmountShortcuts"><button type="button" className="miniButton" disabled={locked || remaining <= 0} onClick={() => setDraft({ key: formKey, text: String(remaining) })}>Остаток этапа · {n(remaining)}</button><button type="button" className="miniButton" disabled={locked || available <= 0 || remaining <= 0} onClick={() => setDraft({ key: formKey, text: String(Math.min(available, remaining)) })}>Что есть · {n(Math.min(available, remaining))}</button></div>
            <div className="supplyShipmentSummary" id={`${id}-shipment-help`}><span>В наличии <GameAmount resource={resource}>{n(available)}</GameAmount></span><strong>Спишется <GameAmount resource={resource}>{n(accepted)}</GameAmount></strong>{requested > remaining && remaining > 0 && <small>Этап примет только оставшиеся {n(remaining)} {RESOURCE_UNITS[resource]}.</small>}</div>
            {deliveryIssue && <p className="supplyHint">{deliveryIssue}</p>}
            {shortage > 0 && <div className="supplyShortage" role="status"><span>Не хватает <GameAmount resource={resource}>{n(shortage)}</GameAmount></span>{resource === 'parts' && <button type="button" className="miniButton" disabled={locked} onClick={props.onProduction}>Рассчитать производство</button>}</div>}
            <button type="submit" className="action" disabled={locked || !props.state.unlocked || !!deliveryIssue || shortage > 0 || accepted <= 0}>{pending === 'deliver' ? 'Доставляем…' : <>Доставить <GameAmount resource={resource}>{n(accepted)}</GameAmount></>}</button>
            <p className="supplyHint">Списывается только показанное количество. Неполная поставка тоже сохраняется.</p>
          </form>}
        </>}
        {feedback?.projectKey === project.id && <div className={`supplyFeedback${feedback.error ? ' isError' : ''}`} role={feedback.error ? 'alert' : 'status'}>{feedback.text}{feedback.error && <button type="button" className="miniButton" disabled={locked} onClick={props.onRefresh}>Обновить колонию</button>}</div>}
        <details className="supplyStagePlan"><summary>Все этапы и награды проекта</summary><ol>{project.stages.map((item, index) => <li className={index < project.stageIndex ? 'isCompleted' : index === project.stageIndex ? 'isCurrent' : ''} key={index}><div><strong>{index + 1}. {item.name}</strong><small>{index < project.stageIndex ? 'Награда получена' : index === project.stageIndex ? 'Текущий этап' : 'Следующий этап'}</small></div><span className="supplyAmounts">{RESOURCE_ORDER.filter(key => item.requirements[key] > 0).map(key => <GameAmount resource={key} key={key}>{n(item.requirements[key])}</GameAmount>)}</span><div className="supplyPlanReward"><span>Награда</span>{rewardAmounts(item.reward)}</div></li>)}</ol></details>
      </>}
      <p className="supplyFooter"><GameIcon name="clock" size={14} />Срока сгорания нет. Готовые запасы и покупки на рынке тоже подходят для поставок.</p>
    </>}
  </section>;
}
