'use client';

import { useId } from 'react';
import { GameAmount, GameIcon } from '@/components/GameIcon';
import type { FoundryBuilding, FoundryRecipeKey } from '@/lib/game/foundry';
import { durationText } from '@/lib/game/format';
import type { ResearchConfig } from '@/lib/game/research';
import { researchProductionPreview } from '@/lib/game/research-production-preview';
import '@/app/research-production-preview.css';

type Props = {
  researchKey: string;
  catalog: readonly ResearchConfig[];
  completed: readonly string[];
  buildings: readonly FoundryBuilding[];
  selectedBuildingId?: string | null;
  busy: boolean;
  showAction?: boolean;
  onProduction?: (recipe: FoundryRecipeKey, buildingId?: string) => void;
};

export function ResearchProductionPreview(props: Props) {
  const id = useId();
  const preview = researchProductionPreview(props);
  if (!preview) return null;
  const { before, after, workshop } = preview;
  const thermal = props.researchKey === 'thermal_recovery';
  const chain = preview.additionalPrerequisites.length > 0;
  const row = (label: string, quote: NonNullable<typeof before>, isAfter: boolean) => <div className={`researchCycleQuote${isAfter ? ' isAfter' : ''}`}>
    <strong>{label}</strong>
    <span className="researchCycleOutput"><GameAmount resource="parts">{quote.parts.toLocaleString('ru-RU')}</GameAmount> деталей</span>
    <span className="researchCycleCost"><GameAmount resource="ore">{quote.ore.toLocaleString('ru-RU')}</GameAmount><span>+</span><GameAmount resource="energy">{quote.energy.toLocaleString('ru-RU')}</GameAmount></span>
    <small><GameIcon name="clock" size={13} />{durationText(quote.seconds)}</small>
  </div>;
  return <div className="researchProductionPreview" data-research-production-preview={props.researchKey} aria-labelledby={`${id}-title`}>
    <details className="researchCycleDetails">
      <summary id={`${id}-title`}>
        <span className="researchCycleSummaryBody"><strong className="researchCycleHeading"><GameIcon name="foundry" size={17} />Что меняется в цехе</strong>
          <small>{before && after ? <>{before.parts.toLocaleString('ru-RU')} → {after.parts.toLocaleString('ru-RU')} деталей за цикл{chain ? ' · после цепочки' : ''}</> : 'Нужен работающий цех'}</small></span>
        <GameIcon name="arrow" size={14} />
      </summary>
    {workshop && before && after ? <>
      <p className="researchCycleContext">Цех ({workshop.x + 1}, {workshop.y + 1}) · ур. {workshop.level}. Один новый цикл, обычный режим, без связи с соседями.</p>
      <div className="researchCycleComparison">
        {row(thermal && preview.done ? 'Без этой технологии' : 'Стандартный сплав сейчас', before, false)}
        {row(preview.done ? thermal ? 'С технологией сейчас' : 'Открытый рецепт сейчас' : chain ? 'После цепочки исследований' : 'После исследования', after, true)}
      </div>
      {chain && <p className="researchCycleChain">Расчёт после всей цепочки: сначала нужны {preview.additionalPrerequisites.map(item => `«${item.name}»`).join(', ')}. Их бонусы учтены в новом цикле.</p>}
      {!thermal && <p className="researchCycleTradeoff">{props.researchKey === 'precision_casting' ? 'Рецепт бережёт руду ценой энергии и времени.' : 'Больше деталей за одно место в очереди, но выше предоплата руды.'} Выбирай под запасы и цель поставки.</p>}
    </> : <p className="researchCycleContext">Сейчас нет работающего литейного цеха. Построй цех или дождись окончания работ в уже размещённом, затем обнови колонию — появится расчёт.</p>}
    <p className="researchCycleRule">Цена исследования указана отдельно.{before && after ? ' Расход выше — за один новый цикл, а не за открытие технологии.' : ''} Бонусы и новые рецепты применяются к новым заказам; уже оплаченные циклы сохраняют свой выпуск и время.</p>
    </details>
    {preview.done && props.showAction !== false && props.onProduction && <button type="button" className="miniButton researchCycleAction" disabled={props.busy} onClick={() => props.onProduction?.(preview.recipe, workshop?.id)}>{workshop ? thermal ? 'Сравнить новую партию' : 'Открыть этот рецепт' : 'К производству'}<GameIcon name="arrow" size={14} /></button>}
    {preview.done && props.showAction !== false && props.onProduction && <small className="researchCycleSafe">Переход бесплатный. Рецепт и цена партии проверяются в производстве; запуск — отдельной кнопкой.</small>}
  </div>;
}
