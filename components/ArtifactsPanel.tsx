'use client';

import { useId } from 'react';
import { ArtifactArt } from '@/components/ArtifactArt';
import { GameIcon } from '@/components/GameIcon';
import { ARTIFACTS, EXPEDITIONS, artifactDropChance, type ArtifactId, type ExpeditionKey } from '@/lib/game/expeditions';
import { ARTIFACT_RARITY_LABELS, artifactCollectionCounts, type ArtifactCollectionEntry } from '@/lib/game/artifact-art';
import '@/app/artifacts.css';

type Props = {
  artifacts?: readonly ArtifactCollectionEntry[];
  onExpeditions: () => void;
  onAchievements: () => void;
  onShowRoute: (key: ExpeditionKey, artifactId: ArtifactId) => void;
};

const percent = (value: number) => (value * 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 });

export function ArtifactsPanel({ artifacts, onExpeditions, onAchievements, onShowRoute }: Props) {
  const id = useId();
  const { counts, unique, total } = artifactCollectionCounts(artifacts);
  return <section className="card artifactsPanel" aria-labelledby={`${id}-title`} data-artifacts-panel="">
    <div className="artifactsHeading"><div><h2 id={`${id}-title`}><GameIcon name="artifact_lens" size={24} />Лунные находки</h2><p>Собирай необычные объекты в экспедициях и открывай коллекцию колонии.</p></div><span className="artifactsCounter" aria-label={`Найдено видов: ${unique} из ${total}`}>{unique}<small>из {total}</small></span></div>
    <div className="artifactsCollectionGoal"><GameIcon name={unique === total ? 'check' : 'trophy'} size={22} /><div><strong>{unique === total ? 'Коллекция собрана' : 'Четыре находки — одна награда'}</strong><span>{unique === total ? 'Рамка первопроходца ждёт в достижениях, если ты ещё не забрал её.' : 'Найди все четыре разных вида и забери постоянную рамку первопроходца в достижениях.'}</span></div></div>
    <div className="artifactsProgress" role="progressbar" aria-label="Виды артефактов" aria-valuemin={0} aria-valuemax={total} aria-valuenow={unique}><i style={{ width: `${unique / total * 100}%` }} /></div>
    <div className="artifactsCards">{ARTIFACTS.map((artifact) => {
      const count = counts.get(artifact.id) ?? 0;
      const found = count > 0;
      const routes = EXPEDITIONS.flatMap((expedition) => {
        const chance = artifactDropChance(expedition.key, artifact.id);
        return chance > 0 ? [{ key: expedition.key, name: expedition.name, chance }] : [];
      });
      return <article className={`artifactCard rarity-${artifact.rarity}${found ? ' isFound' : ' isUnknown'}`} key={artifact.id} data-artifact-card={artifact.id}>
        <div className="artifactCardVisual"><ArtifactArt artifactId={artifact.id} size={112} unknown={!found} /><span className="artifactCardStatus">{found ? <><GameIcon name="check" size={12} />Найден</> : <><GameIcon name="lock" size={12} />Не найден</>}</span></div>
        <h3>{artifact.name}</h3><span className="artifactRarity">{ARTIFACT_RARITY_LABELS[artifact.rarity]}{found && <b> ×{count.toLocaleString('ru-RU')}</b>}</span>
        <details className="artifactDetails"><summary>Что это и где найти<GameIcon name="arrow" size={13} /></summary><p>{artifact.description}</p><strong>Основная находка: шанс за вылет</strong><ul>{routes.map((route) => <li key={route.key}><div className="artifactRouteInfo"><span>{route.name}</span><b>{percent(route.chance)}%</b></div><button type="button" className="miniButton artifactRouteLink" aria-label={`Показать маршрут «${route.name}» для находки «${artifact.name}»`} onClick={() => onShowRoute(route.key, artifact.id)}>Показать маршрут<GameIcon name="arrow" size={13} /></button></li>)}</ul>{artifact.id === 'signal_fragment' && <p className="artifactExtraSource">Дополнительно можно получить при событии «Неизвестный зонд», выбрав «Извлечь ядро». Этот источник не включён в проценты выше.</p>}</details>
      </article>;
    })}</div>
    <div className="artifactsActions"><button type="button" className="action" onClick={onExpeditions}><GameIcon name="rocket" size={18} />Отправить экспедицию</button><button type="button" className="action secondary" onClick={onAchievements}><GameIcon name="trophy" size={18} />{unique === total ? 'Проверить награду' : 'К достижению коллекции'}</button></div>
    <details className="artifactsRules"><summary><GameIcon name="info" size={15} />Как устроена коллекция</summary><p>Артефакт попадает в коллекцию после получения добычи экспедиции. Найденные виды сохраняются навсегда.</p><p>Повторные находки увеличивают количество. Сейчас артефакты нельзя продать или потратить: они не дают скрытых бонусов к добыче.</p><p>Редкость — тип предмета. Проценты показывают шанс основной находки за вылет, без дополнительных наград событий. Исследования открывают новые маршруты; шанс каждого вылета независим, гарантии находки нет.</p></details>
  </section>;
}
