import { useId, type ReactNode } from 'react';
import { GameAmount, GameIcon } from '@/components/GameIcon';
import '@/app/foundry-links-card.css';

export type FoundryLinksPreviewData = {
  base: { ore: number; energy: number };
  options: readonly {
    link: 'ore' | 'energy';
    resource: 'ore' | 'energy';
    before: number;
    after: number;
    saving: number;
    supplierIds: readonly string[];
  }[];
};

type Props = {
  preview: FoundryLinksPreviewData;
  title?: string;
  caption?: string;
  onChooseLink?: (link: 'ore' | 'energy') => void;
  disabled?: boolean;
  children?: ReactNode;
};

const quantity = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });

/** Shows alternative supplier links; choosing one only opens production settings. */
export function FoundryLinksCard({ preview, title = 'Связи производства', caption, onChooseLink, disabled, children }: Props) {
  const id = useId();
  const hasOptions = preview.options.length > 0;

  return <section className="foundryLinksCard" aria-labelledby={`${id}-title`} aria-describedby={`${id}-note`} data-foundry-links>
    <h3 id={`${id}-title`}><GameIcon name="network" size={19} />{title}</h3>
    {caption && <p className="foundryLinksCaption">{caption}</p>}
    {hasOptions ? <dl className="foundryLinkChoices">
      {preview.options.map(option => <div className={`foundryLinkChoice is-${option.resource}`} key={option.link} data-foundry-link={option.link}>
        <dt><GameIcon name={option.resource} size={23} /><span>{option.link === 'ore' ? 'Связь с шахтой' : 'Связь с энергетикой'}<small>{option.resource === 'ore' ? 'Руды за цикл' : 'Энергии за цикл'}</small></span></dt>
        <dd className="foundryLinkNumbers"><span><span className="gameSrOnly">Без связи: </span>{quantity(option.before)}</span><GameIcon name="arrow" size={14} /><strong><span className="gameSrOnly">Со связью: </span>{quantity(option.after)}</strong></dd>
        <dd className="foundryLinkSaving">Экономия <strong>{quantity(option.saving)}</strong> за цикл</dd>
        {onChooseLink && <dd className="foundryLinkAction"><button type="button" className="miniButton" disabled={disabled} onClick={() => onChooseLink(option.link)} aria-label={`Выбрать ${option.link === 'ore' ? 'связь с шахтой' : 'связь с энергетикой'} в производстве`}>Выбрать в производстве<GameIcon name="arrow" size={13} /></button></dd>}
      </div>)}
    </dl> : <div className="foundryLinksEmpty">
      <strong>Рядом нет работающей шахты или электростанции.</strong>
      <p>Поставь цех рядом с таким зданием по стороне клетки.</p>
      <div><span>Без связи за цикл</span><GameAmount resource="ore">{quantity(preview.base.ore)}</GameAmount><GameAmount resource="energy">{quantity(preview.base.energy)}</GameAmount></div>
    </div>}
    <p className="foundryLinksNote" id={`${id}-note`}>{hasOptions ? 'На заказ выбирается одна связь. Она действует только на новые плавки.' : 'Дороги и соседи по диагонали не дают производственную связь.'}</p>
    {children && <div className="foundryLinksFooter">{children}</div>}
  </section>;
}
