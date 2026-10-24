'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { GameAmount, GameIcon } from '@/components/GameIcon';
import { MechanicGuide } from '@/components/MechanicGuide';
import { durationText } from '@/lib/game/format';
import { MARKET_MAX_AMOUNT, MARKET_MAX_OPEN_ORDERS, MARKET_MIN_ORDER_VALUE, MARKET_ORDER_TTL_HOURS, MARKET_RULES, marketFee, type MarketResource } from '@/lib/game/market';
import '@/app/market-panel.css';

type View = 'buy' | 'sell' | 'mine' | 'prices';
type Props = {
  market: any;
  tradeHub?: { status: string; completes_at?: string | null } | null;
  view: View;
  resources: Record<string, unknown>;
  capacities: Partial<Record<MarketResource, number>>;
  userId: string;
  featureEnabled: boolean;
  busy: boolean;
  onCreate: (body: { resource: string; amount: number; unitPrice: number }) => Promise<unknown>;
  onBuy: (body: { orderId: string; amount: number }) => Promise<unknown>;
  onCancel: (orderId: string) => Promise<unknown>;
  onBuild: () => void;
  onRefresh: () => void;
  onOwnOrders?: () => void;
};
type Feedback = { view: View; target: string; text: string; error: boolean };
const RESOURCE_KEYS: MarketResource[] = ['ore', 'energy', 'parts'];
const TITLES: Record<View, string> = { buy: 'Купить ресурсы', sell: 'Продать ресурсы', mine: 'Мои открытые ордера', prices: 'Цены за 24 часа' };
const VIEW_ICONS: Record<View, string> = { buy: 'buy', sell: 'sell', mine: 'orders', prices: 'chart' };
const GUIDE_STEPS: Record<View, readonly string[]> = {
  buy: [
    'Открой расчёт и выбери нужное количество. Можно купить часть предложения; выбор количества и фильтров не тратит ресурсы.',
    'Перед покупкой проверь итоговую сумму и свободное место. Место под твои ресурсы в продаже уже исключено из доступного склада; комиссию платит продавец.',
    'Только кнопка «Купить ресурс» проводит сделку. Если предложение успел выкупить другой игрок, обнови рынок и выбери доступный остаток.',
  ],
  sell: [
    'Выбери ресурс, количество и цену за единицу. Настройка ордера бесплатна; кнопка «Выставить ордер» сразу переносит указанный ресурс в резерв продажи.',
    'Игроки могут выкупать ордер частями. Кредиты поступают после каждой покупки, а комиссия 5% считается для каждой сделки отдельно, с округлением вниз и минимумом 1 кредит.',
    'Расчёт дохода показан для одного полного выкупа. При частичных покупках итоговая комиссия может отличаться. Непроданный остаток можно вернуть в разделе «Мои ордера».',
  ],
  mine: [
    'Здесь показаны открытые продажи. «Продано» — уже выкупленный объём, «В резерве» — остаток, который ещё могут купить другие игроки.',
    'Кнопка «Отменить ордер» возвращает только непроданный остаток. Место для него уже зарезервировано на складе; состоявшиеся сделки сохраняются.',
    'Ордер действует 24 часа. После окончания срока обнови данные, чтобы увидеть возврат остатка. Свои продажи можно отменять и при недоступной торговле.',
  ],
  prices: [
    'Статистика собирается из состоявшихся сделок за последние 24 часа. Объём — количество проданного ресурса, сделки — число отдельных покупок.',
    'Цена за единицу — медиана сделок; если её нет, показана средняя цена. Это ориентир для своего ордера, текущие предложения могут стоить иначе.',
    'Просмотр цен и обновление данных не создают ордеров и не покупают ресурсы.',
  ],
};
const PAGE_SIZE = 8;
function number(value: number) { return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 }); }
function available(value: unknown) { const amount = Number(value); return Number.isFinite(amount) && amount >= 0 ? amount : 0; }
function resourceName(resource: string) { return MARKET_RULES[resource as MarketResource]?.label ?? 'Ресурс'; }
function expiresAt(value: unknown) {
  const date = new Date(String(value ?? ''));
  return Number.isFinite(date.getTime()) ? date.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'указанного срока';
}

export function MarketPanel(props: Props) {
  const id = useId();
  const [resource, setResource] = useState<MarketResource>('ore');
  const [sellAmount, setSellAmount] = useState('100');
  const [sellPrice, setSellPrice] = useState('3');
  const [buyAmounts, setBuyAmounts] = useState<Record<string, string>>({});
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | MarketResource>('all');
  const [page, setPage] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [pending, setPending] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const guard = useRef(false);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const previousCount = useRef(0);
  const market = props.market ?? {};
  const orders: any[] = Array.isArray(market.orders) ? market.orders : [];
  const mineSource: any[] = Array.isArray(market.ownOrders) ? market.ownOrders : orders.filter((order) => order.user_id === props.userId);
  const openOrder = (order: any) => order.status === 'open' && available(order.amount_remaining) > 0;
  const mine = mineSource.filter(openOrder);
  const buying = orders.filter((order) => order.user_id !== props.userId && openOrder(order)
    && (!order.expires_at || new Date(order.expires_at).getTime() > now));
  const source = props.view === 'mine' ? mine : buying;
  const filtered = source.filter((order) => filter === 'all' || order.resource === filter);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const shownOrders = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const rule = market.rules?.[resource] ?? MARKET_RULES[resource];
  const amount = Number(sellAmount);
  const unitPrice = Number(sellPrice);
  const gross = Number.isSafeInteger(amount * unitPrice) && amount > 0 && unitPrice > 0 ? amount * unitPrice : 0;
  const fee = marketFee(gross);
  const amountValid = Number.isInteger(amount) && amount >= rule.minAmount && amount <= MARKET_MAX_AMOUNT;
  const priceValid = Number.isInteger(unitPrice) && unitPrice >= rule.minUnitPrice && unitPrice <= rule.maxUnitPrice;
  const sellMissing = Math.max(0, amount - available(props.resources[resource]));
  const valueValid = gross >= MARKET_MIN_ORDER_VALUE;
  const maxOrders = mine.filter((order) => !order.expires_at || new Date(order.expires_at).getTime() > now).length >= MARKET_MAX_OPEN_ORDERS;
  const locked = props.busy || pending !== null;
  const canSell = !locked && props.featureEnabled && market.enabled && amountValid && priceValid && valueValid && !sellMissing && !maxOrders;
  const hubPending = props.tradeHub?.status === 'building' || props.tradeHub?.status === 'upgrading';
  const hubEnd = Date.parse(props.tradeHub?.completes_at ?? '');

  useEffect(() => { setPage(0); setEditingOrderId(null); setFeedback(null); }, [props.view, filter]);
  useEffect(() => {
    if (filtered.length < previousCount.current) setPage(0);
    previousCount.current = filtered.length;
  }, [filtered.length]);
  useEffect(() => {
    if (!orders.length && !mineSource.length && !hubPending) return;
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, [orders.length, mineSource.length, hubPending]);
  useEffect(() => {
    if (feedback?.view === props.view) feedbackRef.current?.scrollIntoView({ block: 'nearest' });
  }, [feedback, props.view]);

  function clearFeedback() { setFeedback(null); }
  function showOwnOrders() {
    setFilter('all'); setPage(0); setEditingOrderId(null);
    props.onOwnOrders?.();
  }
  async function run(target: string, operation: () => Promise<unknown>, successText: string) {
    if (locked || guard.current) return;
    const view = props.view;
    guard.current = true; setPending(target); clearFeedback();
    try { await operation(); setFeedback({ view, target, text: successText, error: false }); }
    catch (error) { setFeedback({ view, target, text: error instanceof Error ? error.message : 'Не удалось выполнить действие. Обнови данные и попробуй ещё раз.', error: true }); }
    finally { guard.current = false; setPending(null); }
  }
  function notice(target: string) {
    if (feedback?.view !== props.view || feedback.target !== target) return null;
    return <div ref={feedbackRef} className={`marketFeedback ${feedback.error ? 'isError' : 'isSuccess'}`} role={feedback.error ? 'alert' : 'status'}><span>{feedback.text}</span>{feedback.error && <button type="button" className="miniButton" disabled={locked} onClick={props.onRefresh}>Обновить данные</button>}</div>;
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSell) return;
    void run('create', () => props.onCreate({ resource, amount, unitPrice }), `Ордер размещён: ${number(amount)} ед. ${resourceName(resource).toLowerCase()} зарезервированы. Кредиты поступят после продажи.`);
  }
  const orphanFeedback = feedback?.view === props.view && feedback.target !== 'create'
    && !shownOrders.some((order) => feedback.target === `buy:${order.id}` || feedback.target === `cancel:${order.id}`);

  return <section className="card marketPanel" aria-labelledby={`${id}-title`} data-market-view={props.view}>
    <div className="marketPanelHeading"><div><h2 id={`${id}-title`}><GameIcon name={VIEW_ICONS[props.view]} size={22} /> {TITLES[props.view]}</h2><p>{props.view === 'buy' ? 'Выбери количество. Кредиты спишутся при покупке, ресурс поступит на склад.' : props.view === 'sell' ? 'Ресурс резервируется при размещении. Комиссия удерживается с продавца после сделки.' : props.view === 'mine' ? 'Здесь только открытые ордера. Отмена возвращает непроданный остаток.' : 'Цены отражают состоявшиеся сделки игроков за последние 24 часа.'}</p></div><button type="button" className="miniButton marketRefresh" disabled={locked} aria-label="Обновить рынок" onClick={props.onRefresh}><GameIcon name="refresh" size={15} /></button></div>
    <MechanicGuide steps={GUIDE_STEPS[props.view]} />
    {props.busy && !pending && <p className="marketWarning" role="status">Дождись завершения текущего действия. Рыночные операции пока недоступны.</p>}
    {!props.featureEnabled && <div className="marketPanelNotice" role="status">Покупка и размещение ордеров временно приостановлены. Свои ордера можно отменить.</div>}
    {!market.enabled && (props.view === 'buy' || props.view === 'sell') && <div className="marketPanelNotice" role="status"><span>{hubPending ? <>Торговый узел {props.tradeHub?.status === 'upgrading' ? 'улучшается' : 'строится'}. {Number.isFinite(hubEnd) && hubEnd > now ? `До готовности: ${durationText((hubEnd - now) / 1000)}.` : 'Обнови данные, чтобы проверить готовность.'} После завершения работ торговля станет доступна.</> : props.tradeHub ? 'Торговый узел есть. Обнови данные, чтобы проверить его готовность.' : 'Для торговли нужен работающий торговый узел.'}</span><button type="button" className="miniButton" disabled={locked} onClick={props.tradeHub ? props.onRefresh : props.onBuild}>{props.tradeHub ? 'Проверить готовность узла' : 'Построить торговый узел'}</button></div>}
    {orphanFeedback && feedback && notice(feedback.target)}

    {(props.view === 'buy' || props.view === 'mine') && <>
      <div className="marketResourceFilters" role="group" aria-label="Ресурс ордеров"><button type="button" className={filter === 'all' ? 'isSelected' : ''} aria-pressed={filter === 'all'} disabled={locked} onClick={() => { setFilter('all'); clearFeedback(); }}>Все</button>{RESOURCE_KEYS.map((key) => <button key={key} type="button" data-market-resource={key} className={filter === key ? 'isSelected' : ''} aria-pressed={filter === key} disabled={locked} onClick={() => { setFilter(key); clearFeedback(); }}><GameIcon name={key} size={14} />{resourceName(key)}</button>)}</div>
      {props.view === 'buy' && <p className="marketBalance">В наличии: <GameAmount resource="credits">{number(available(props.resources.credits))}</GameAmount>. Комиссию платит продавец.</p>}
      {filtered.length === 0 ? <div className="marketEmpty"><GameIcon name="market" size={25} /><span>{props.view === 'mine' ? 'Открытых ордеров для этого ресурса нет.' : 'Предложений для этого ресурса пока нет.'}</span><button type="button" className="miniButton" disabled={locked} onClick={props.onRefresh}>Проверить предложения</button></div> : <>
        <div className="marketPanelOrders">{shownOrders.map((order) => {
          const key = order.resource as MarketResource;
          const remaining = available(order.amount_remaining);
          const total = available(order.amount_total);
          const price = available(order.unit_price);
          const typed = buyAmounts[order.id] ?? String(Math.min(remaining, key === 'parts' ? 10 : 50));
          const requested = Number(typed);
          const valid = Number.isInteger(requested) && requested >= 1 && requested <= remaining;
          const cost = valid ? requested * price : 0;
          const creditsMissing = valid ? Math.max(0, cost - available(props.resources.credits)) : 0;
          const free = Math.max(0, available(props.capacities[key]) - available(props.resources[key]));
          const affordableAmount = price > 0 ? Math.max(0, Math.min(Math.floor(remaining), Math.floor(available(props.resources.credits) / price), Math.floor(free))) : 0;
          const spaceMissing = valid ? Math.max(0, requested - free) : 0;
          const expired = !!order.expires_at && new Date(order.expires_at).getTime() <= now;
          const target = `${props.view === 'mine' ? 'cancel' : 'buy'}:${order.id}`;
          const sellerName = order.colony_name || order.first_name || order.username || 'Колонист';
          return <article className="marketPanelOrder" key={order.id} data-market-order={order.id}>
            <div className="marketOrderHeading"><h3><GameIcon name={key} size={17} />{resourceName(key)}</h3><strong><GameAmount resource="credits">{number(price)}</GameAmount><small>/ ед.</small></strong></div>
            <div className="marketOrderSummary"><span>{props.view === 'mine' ? 'В резерве' : 'Осталось'}: {number(remaining)} ед.</span>{order.expires_at && <span>До {expiresAt(order.expires_at)}</span>}</div>
            {props.view === 'mine' ? <>
              {total >= remaining && total > 0 && <p className="marketOrderProgress">Продано: {number(total - remaining)} из {number(total)} ед.</p>}
              <p className="marketCancelHint">При отмене вернётся непроданный остаток. Его место на складе уже зарезервировано.</p>
              {expired && <p className="marketWarning">Срок ордера вышел. Обнови данные, чтобы проверить возврат ресурса.</p>}
              <button type="button" className="action secondary marketOrderAction" disabled={locked} data-market-cancel={order.id} onClick={() => void run(target, () => props.onCancel(order.id), 'Ордер отменён. Непроданный остаток возвращён на склад.')}>{pending === target ? 'Отменяем…' : 'Отменить ордер'}<GameIcon name="close" size={15} /></button>
            </> : <>
              <p className="marketSeller">Продавец: {sellerName}</p>
              <button type="button" className="miniButton marketSelectOrder" disabled={locked || !props.featureEnabled || !market.enabled} data-market-select={order.id} aria-expanded={editingOrderId === order.id} aria-controls={`${id}-${order.id}-calculation`} onClick={() => { setEditingOrderId(editingOrderId === order.id ? null : order.id); clearFeedback(); }}>{editingOrderId === order.id ? 'Свернуть расчёт' : 'Выбрать количество'}<GameIcon name="arrow" size={14} /></button>
              {editingOrderId === order.id && <div id={`${id}-${order.id}-calculation`}>
              <label className="marketBuyAmount" htmlFor={`${id}-${order.id}-amount`}><span>Количество</span><input id={`${id}-${order.id}-amount`} type="text" inputMode="numeric" pattern="[0-9]*" value={typed} disabled={locked} onChange={(event) => { setBuyAmounts((old) => ({ ...old, [order.id]: event.target.value.replace(/\D/g, '') })); clearFeedback(); }} /></label>
              <div className="marketBuyPreview"><div><span>Спишется</span><GameAmount resource="credits">{number(cost)}</GameAmount></div><GameIcon name="arrow" size={14} /><div><span>Получишь</span><GameAmount resource={key}>{number(valid ? requested : 0)}</GameAmount></div></div>
              <p className="marketStorage">Свободно: {number(free)} ед. Резервы продажи учтены.</p>
              <div className="marketAffordable" data-market-affordable={order.id}>
                <p>Можно купить сейчас: <GameAmount resource={key}>{number(affordableAmount)}</GameAmount>. По твоим кредитам и свободному месту.</p>
                <button type="button" className="miniButton" disabled={locked || affordableAmount <= 0 || expired || !props.featureEnabled || !market.enabled} onClick={() => { setBuyAmounts(old => ({ ...old, [order.id]: String(affordableAmount) })); clearFeedback(); }}>Подставить доступное количество</button>
              </div>
              {!valid && <p className="marketWarning">Укажи целое количество от 1 до {number(remaining)}.</p>}
              {creditsMissing > 0 && <p className="marketWarning">Не хватает: <GameAmount resource="credits">{number(Math.ceil(creditsMissing))}</GameAmount>.</p>}
              {spaceMissing > 0 && <p className="marketWarning">На складе нужно ещё место для <GameAmount resource={key}>{number(Math.ceil(spaceMissing))}</GameAmount>.</p>}
              <button type="button" className="action marketOrderAction" disabled={locked || !props.featureEnabled || !market.enabled || !valid || !!creditsMissing || !!spaceMissing || expired} data-market-buy={order.id} onClick={() => { if (!valid || creditsMissing || spaceMissing || expired || !market.enabled || !props.featureEnabled) return; void run(target, () => props.onBuy({ orderId: order.id, amount: requested }), `Покупка выполнена: ${number(requested)} ед. ${resourceName(key).toLowerCase()}. Списано ${number(cost)} кредитов.`); }}>{pending === target ? 'Покупаем…' : 'Купить ресурс'}<GameIcon name="arrow" size={15} /></button>
              </div>}
            </>}{notice(target)}
          </article>;
        })}</div>
        <nav className="marketPagination" aria-label="Страницы ордеров"><button type="button" className="miniButton" disabled={locked || currentPage === 0} onClick={() => { setPage(currentPage - 1); setEditingOrderId(null); clearFeedback(); }}>Назад</button><span>Страница {currentPage + 1} из {pageCount}</span><button type="button" className="miniButton" disabled={locked || currentPage >= pageCount - 1} onClick={() => { setPage(currentPage + 1); setEditingOrderId(null); clearFeedback(); }}>Вперёд</button></nav>
      </>}
    </>}

    {props.view === 'sell' && <form className="marketSellForm" onSubmit={create}>
      <label htmlFor={`${id}-resource`}><span>Ресурс</span><select id={`${id}-resource`} value={resource} disabled={locked} onChange={(event) => { const key = event.target.value as MarketResource; setResource(key); const nextRule = market.rules?.[key] ?? MARKET_RULES[key]; setSellAmount(String(Math.max(nextRule.minAmount, Math.ceil(MARKET_MIN_ORDER_VALUE / nextRule.minUnitPrice)))); setSellPrice(String(nextRule.minUnitPrice)); clearFeedback(); }}>{RESOURCE_KEYS.map((key) => <option key={key} value={key}>{resourceName(key)}</option>)}</select></label>
      <p className="marketSellAvailable">Можно выставить: <GameAmount resource={resource}>{number(available(props.resources[resource]))}</GameAmount>.</p>
      <div className="marketSellFields"><label htmlFor={`${id}-sell-amount`}><span>Количество</span><input id={`${id}-sell-amount`} type="text" inputMode="numeric" pattern="[0-9]*" value={sellAmount} disabled={locked} onChange={(event) => { setSellAmount(event.target.value.replace(/\D/g, '')); clearFeedback(); }} /></label><label htmlFor={`${id}-sell-price`}><span>Цена за единицу</span><input id={`${id}-sell-price`} type="text" inputMode="numeric" pattern="[0-9]*" value={sellPrice} disabled={locked} onChange={(event) => { setSellPrice(event.target.value.replace(/\D/g, '')); clearFeedback(); }} /></label></div>
      <p className="marketRules">От {number(rule.minAmount)} до {number(MARKET_MAX_AMOUNT)} ед. · цена {number(rule.minUnitPrice)}–{number(rule.maxUnitPrice)} кредитов/ед. · сумма от {number(MARKET_MIN_ORDER_VALUE)} кредитов.</p>
      <div className="marketSellPreview"><div><span>Зарезервируется сразу</span><GameAmount resource={resource}>{number(amountValid ? amount : 0)}</GameAmount></div><div><span>Стоимость всего ордера</span><GameAmount resource="credits">{number(gross)}</GameAmount></div><div><span>Комиссия при одном выкупе</span><GameAmount resource="credits">{number(fee)}</GameAmount></div><div><span>Тебе при одном выкупе</span><GameAmount resource="credits">{number(Math.max(0, gross - fee))}</GameAmount></div></div>
      <p className="marketRules">Комиссия 5% считается отдельно для каждой сделки, с округлением вниз и минимумом 1 кредит. Кредиты за ордер поступают по мере продаж.</p>
      {!amountValid && <p className="marketWarning">Количество должно быть целым: {number(rule.minAmount)}–{number(MARKET_MAX_AMOUNT)}.</p>}
      {!priceValid && <p className="marketWarning">Цена должна быть целой: {number(rule.minUnitPrice)}–{number(rule.maxUnitPrice)} кредитов за единицу.</p>}
      {amountValid && priceValid && !valueValid && <p className="marketWarning">Минимальная стоимость ордера — {number(MARKET_MIN_ORDER_VALUE)} кредитов.</p>}
      {Number.isFinite(sellMissing) && sellMissing > 0 && <p className="marketWarning">Не хватает: <GameAmount resource={resource}>{number(Math.ceil(sellMissing))}</GameAmount>.</p>}
      {maxOrders && <p className="marketWarning">Достигнут лимит: {MARKET_MAX_OPEN_ORDERS} открытых ордеров. Заверши продажу или отмени один из своих ордеров.</p>}
      {props.onOwnOrders && (maxOrders || feedback?.view === 'sell' && feedback.target === 'create' && !feedback.error) && <button type="button" className="miniButton marketOwnOrdersLink" disabled={locked} data-market-own-orders onClick={showOwnOrders}>Мои открытые ордера<GameIcon name="arrow" size={14} /></button>}
      <button type="submit" className="action marketOrderAction" disabled={!canSell} data-market-create="">{pending === 'create' ? 'Размещаем…' : 'Выставить ордер'}<GameIcon name="arrow" size={16} /></button>
      <p className="marketRules">Ордер действует {MARKET_ORDER_TTL_HOURS} часа. Непроданный остаток возвращается при отмене или после истечения срока.</p>{notice('create')}
    </form>}

    {props.view === 'prices' && <>{(market.stats?.length ?? 0) === 0 ? <div className="marketEmpty"><GameIcon name="market" size={26} /><span>За последние 24 часа сделок пока нет.</span><button type="button" className="miniButton" disabled={locked} onClick={props.onRefresh}>Обновить цены</button></div> : <><div className="marketPricesTable"><table><thead><tr><th>Ресурс</th><th>Цена/ед.</th><th>Объём</th><th>Сделки</th></tr></thead><tbody>{market.stats.map((stat: any) => <tr key={stat.resource}><th scope="row"><GameIcon name={stat.resource} size={15} /><span>{resourceName(stat.resource)}</span></th><td><GameAmount resource="credits">{number(available(stat.median_price ?? stat.avg_price))}</GameAmount></td><td>{number(available(stat.volume))}</td><td>{number(available(stat.trades))}</td></tr>)}</tbody></table></div><p className="marketRules">Цена — медиана состоявшихся сделок; при отсутствии медианы показана средняя. Текущие предложения могут стоить иначе.</p></>}</>}
  </section>;
}
