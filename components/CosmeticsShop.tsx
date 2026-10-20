'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CosmeticPreview } from '@/components/CosmeticAppearance';
import { GameIcon } from '@/components/GameIcon';
import { PRODUCTS, CRYSTAL_PREMIUM_PRICE, DEFAULT_OFFLINE_CAP_HOURS, PREMIUM_OFFLINE_CAP_HOURS, PREMIUM_PRODUCTION_MULTIPLIER, PREMIUM_BUILD_SPEED_MULTIPLIER } from '@/lib/game/config';
import '@/app/shop.css';

type Props = {
  view?: 'offers' | 'collection';
  cosmetics: any[];
  shopCosmetics: any[];
  busy: boolean;
  starsEnabled: boolean;
  premium: boolean;
  premiumUntil?: string | null;
  crystals: number;
  awaitingProducts?: string[];
  onBuy: (productId: string) => Promise<void>;
  onEquip: (cosmeticId: string, equipped?: boolean) => Promise<void>;
  onPremiumCrystals: () => Promise<void>;
  onRecover: () => Promise<void>;
};

type Item = { id: string; name: string; category: string; expiresAt: string | null; equipped: boolean };
type PreviewItem = Pick<Item, 'id' | 'name' | 'category'>;
type Feedback = { text: string; error: boolean };
type ProductId = keyof typeof PRODUCTS;

const CATEGORIES: Record<string, { name: string; where: string; icon: string }> = {
  theme: { name: 'Темы города', where: 'Меняет цвета и оформление карты города.', icon: 'city' },
  weather: { name: 'Небо', where: 'Видно над картой твоего города и при его просмотре.', icon: 'star' },
  frame: { name: 'Рамки', where: 'Обрамляет карту города и профиль колонии.', icon: 'social' },
  badge: { name: 'Знаки', where: 'Знак рядом с названием колонии.', icon: 'star' },
  title: { name: 'Титулы', where: 'Подпись под названием колонии.', icon: 'social' },
  effect: { name: 'Эффекты', where: 'Добавляет визуальный эффект на карте города.', icon: 'energy' },
  building_skin: { name: 'Монументы', where: 'Украшение на карте города.', icon: 'building' },
};

const COSMETIC_PRODUCTS = (Object.entries(PRODUCTS) as [ProductId, typeof PRODUCTS[ProductId]][])
  .filter((entry): entry is [ProductId, Extract<typeof PRODUCTS[ProductId], { kind: 'cosmetic' }>] => entry[1].kind === 'cosmetic');

const DESCRIPTIONS: Record<string, { name: string; category: string; text: string }> = {
  theme_neon: { name: 'Неоновый город', category: 'theme', text: 'Холодный неон, светящиеся линии и новый характер твоего города.' },
  weather_aurora: { name: 'Северное сияние', category: 'weather', text: 'Мягкие переливы северного сияния над колонией.' },
  frame_orbit: { name: 'Орбитальная рамка', category: 'frame', text: 'Орбитальное обрамление эмблемы колонии.' },
};

const FOUNDER_ITEMS = [
  { id: 'founder_badge', name: 'Знак основателя', category: 'badge' },
  { id: 'founder_monument', name: 'Монумент основателя', category: 'building_skin' },
  { id: 'founder_frame', name: 'Рамка основателя', category: 'frame' },
  { id: 'founder_sky', name: 'Небо основателя', category: 'weather' },
];

function dateText(value?: string | null) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
}
function number(value: number) { return Number(value || 0).toLocaleString('ru-RU'); }
function categoryInfo(category: string) { return CATEGORIES[category] ?? { name: 'Оформление', where: 'Оформление твоей колонии.', icon: 'star' }; }

export function CosmeticsShop(props: Props) {
  const id = useId();
  const [category, setCategory] = useState('all');
  const [preview, setPreview] = useState<PreviewItem | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  const inFlight = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<Element | null>(null);
  const locked = props.busy || pending !== null;
  const catalog = useMemo(() => new Map((props.shopCosmetics ?? []).map((item: any) => [String(item.id), item])), [props.shopCosmetics]);
  const collection = useMemo(() => {
    const items = new Map<string, Item>();
    const now = Date.now();
    for (const row of props.cosmetics ?? []) {
      const cosmeticId = String(row.cosmetic_id ?? row.id ?? '');
      if (!cosmeticId) continue;
      const expiresAt = row.expires_at == null ? null : String(row.expires_at);
      if (expiresAt && !(new Date(expiresAt).getTime() > now)) continue;
      const config = catalog.get(cosmeticId);
      const item: Item = { id: cosmeticId, name: row.name || config?.name || 'Предмет коллекции', category: row.category || config?.category || 'other', expiresAt, equipped: !!row.equipped };
      const existing = items.get(cosmeticId);
      const best = !existing || (existing.expiresAt !== null && (expiresAt === null || new Date(expiresAt).getTime() > new Date(existing.expiresAt).getTime())) ? item : existing;
      items.set(cosmeticId, { ...best, equipped: !!existing?.equipped || item.equipped });
    }
    return [...items.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name, 'ru'));
  }, [props.cosmetics, catalog]);
  const owned = new Map(collection.map((item) => [item.id, item]));
  const awaiting = new Set(props.awaitingProducts ?? []);
  const categories = [...new Set(collection.map((item) => item.category))];
  const selectedCategory = categories.includes(category) ? category : 'all';
  const shownItems = selectedCategory === 'all' ? collection : collection.filter((item) => item.category === selectedCategory);
  const founderPermanent = FOUNDER_ITEMS.filter((item) => owned.get(item.id)?.expiresAt === null).length;
  const founderOwned = FOUNDER_ITEMS.filter((item) => owned.has(item.id)).length;
  const currentPreview = preview ? collection.find((item) => item.category === preview.category && item.equipped) : null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (preview && !dialog.open) {
      previousFocus.current = document.activeElement;
      dialog.showModal();
      closeRef.current?.focus({ preventScroll: true });
    } else if (!preview && dialog.open) {
      dialog.close();
      if (previousFocus.current instanceof HTMLElement && previousFocus.current.isConnected) previousFocus.current.focus({ preventScroll: true });
    }
  }, [preview]);

  useEffect(() => {
    const dialog = dialogRef.current;
    return () => {
      dialog?.close();
      if (previousFocus.current instanceof HTMLElement && previousFocus.current.isConnected) previousFocus.current.focus({ preventScroll: true });
    };
  }, []);

  async function run(key: string, operation: () => Promise<void>, success: string) {
    if (locked || inFlight.current) return;
    inFlight.current = true;
    setPending(key);
    setFeedback((previous) => { const next = { ...previous }; delete next[key]; return next; });
    try {
      await operation();
      setFeedback((previous) => ({ ...previous, [key]: { text: success, error: false } }));
    } catch (cause) {
      setFeedback((previous) => ({ ...previous, [key]: { text: cause instanceof Error ? cause.message : 'Не удалось выполнить действие. Попробуй ещё раз.', error: true } }));
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }

  function buy(productId: ProductId, permanent = false) {
    if (!props.starsEnabled || permanent || (productId !== 'premium_30d' && awaiting.has(productId))) return;
    void run(`buy:${productId}`, () => props.onBuy(productId), 'Ответ Telegram получен. Если оплата прошла, дождись подтверждения — покупка появится в коллекции.');
  }
  function equip(item: Item) {
    void run(`equip:${item.id}`, () => props.onEquip(item.id, !item.equipped), item.equipped ? 'Оформление снято.' : 'Оформление применено.');
  }
  function notice(key: string) {
    const value = feedback[key];
    return value ? <div className={`notice shopFeedback${value.error ? ' error' : ''}`} role={value.error ? 'alert' : 'status'}>{value.text}</div> : null;
  }
  function status(item?: Item) {
    return item && <div className="cosmeticOwnership">{item.equipped && <span className="cosmeticEquipped"><GameIcon name="check" size={14} />Надето</span>}<span>{item.expiresAt === null ? 'Есть навсегда' : `Временно · до ${dateText(item.expiresAt)}`}</span></div>;
  }
  function previewButton(item: PreviewItem) {
    return <button className="action secondary cosmeticPreviewButton" type="button" aria-haspopup="dialog" onClick={() => setPreview(item)}><GameIcon name="info" size={17} />Предпросмотр</button>;
  }
  function awaitingPurchase(productId: ProductId, permanent: boolean) {
    if (permanent || !awaiting.has(productId)) return null;
    return <><p className="cosmeticWhere" role="status">Дождись подтверждения оплаты от Telegram.</p><button className="action secondary" type="button" disabled={locked || !props.starsEnabled} onClick={() => {
      if (props.starsEnabled) void run(`recover:${productId}`, props.onRecover, 'Проверка покупки завершена.');
    }}>{pending === `recover:${productId}` ? 'Проверяем покупку…' : 'Проверить покупку'}</button></>;
  }

  return <div className="cosmeticsShop">
    {props.view !== 'collection' && <>
    <section className="card shopIntroduction" aria-labelledby={`${id}-shop`}><span className="shopEyebrow">Оформление колонии</span><h2 id={`${id}-shop`}>Твой город. Твой стиль.</h2><p>Посмотри, как предмет выглядит в игре, затем выбери оформление для своей колонии. Применение — отдельной кнопкой в коллекции.</p>{props.view === undefined && <nav className="shopJumpLinks" aria-label="Разделы магазина"><a href={`#${id}-collection`}>Моя коллекция</a><a href={`#${id}-offers`}>Витрина</a><a href={`#${id}-premium`}>Premium</a></nav>}{!props.starsEnabled && <div className="notice shopPaused" role="status">Покупки за Stars и восстановление временно недоступны. Premium можно приобрести за кристаллы.</div>}</section>

    <section className="shopOffers" aria-labelledby={`${id}-offers`}><div className="shopSectionHeading"><h2 id={`${id}-offers`}>Витрина</h2><span>Постоянное оформление</span></div><div className="cosmeticOfferGrid">{COSMETIC_PRODUCTS.map(([productId, product]) => {
      const description = DESCRIPTIONS[product.cosmeticId];
      const config = catalog.get(product.cosmeticId);
      const item = { id: product.cosmeticId, name: config?.name || description.name, category: config?.category || description.category };
      const inventory = owned.get(item.id);
      const permanent = inventory?.expiresAt === null;
      return <article key={productId} className="card cosmeticOffer" data-cosmetic-id={item.id} data-product-id={productId} aria-labelledby={`${id}-${productId}`}><CosmeticPreview cosmeticId={item.id} category={item.category} label={item.name} className="shopCosmeticArt" /><div className="cosmeticOfferBody"><span className="cosmeticCategory">{categoryInfo(item.category).name}</span><h3 id={`${id}-${productId}`}>{item.name}</h3><p>{description.text}</p><p className="cosmeticWhere">{categoryInfo(item.category).where}</p>{status(inventory)}{previewButton(item)}<button className="action cosmeticBuy" type="button" disabled={locked || !props.starsEnabled || permanent || awaiting.has(productId)} onClick={() => buy(productId, permanent)}>{pending === `buy:${productId}` ? 'Ожидаем Telegram…' : permanent ? 'Уже есть навсегда' : awaiting.has(productId) ? 'Ожидаем подтверждения' : <>{inventory ? 'Купить навсегда' : 'Купить'}<span><GameIcon name="star" size={16} />{product.stars} Stars</span></>}</button>{notice(`buy:${productId}`)}{awaitingPurchase(productId, permanent)}{notice(`recover:${productId}`)}</div></article>;
    })}</div></section>

    <section className="card founderOffer" data-product-id="founder_pack" aria-labelledby={`${id}-founder`}><div className="shopSectionHeading"><div><span className="shopEyebrow">Набор основателя</span><h2 id={`${id}-founder`}>{PRODUCTS.founder_pack.title}</h2></div><span className="cosmeticPermanent">4 предмета навсегда</span></div><p>Знак, монумент, рамка и небо основателя составляют единый образ колонии.</p><div className="founderCombinedPreview" data-cosmetic-id="founder_pack"><CosmeticPreview cosmeticId="founder_pack" label="Образ основателя" /></div><div className="founderContents">{FOUNDER_ITEMS.map((base) => {
      const item = { ...base, name: catalog.get(base.id)?.name || base.name };
      const inventory = owned.get(item.id);
      return <button className="founderPreview" type="button" key={item.id} data-cosmetic-id={item.id} aria-haspopup="dialog" aria-label={`Предпросмотр: ${item.name}`} onClick={() => setPreview(item)}><CosmeticPreview cosmeticId={item.id} category={item.category} label={item.name} className="founderCosmeticArt" /><strong>{item.name}</strong><span>{inventory?.expiresAt === null ? 'Есть навсегда' : 'Посмотреть'}</span></button>;
    })}</div>{founderOwned > 0 && founderPermanent < FOUNDER_ITEMS.length && <p className="founderPartial">В твоей коллекции {founderOwned} из {FOUNDER_ITEMS.length} предметов набора. Цена полная, без скидки за уже полученные предметы.</p>}<button className="action cosmeticBuy founderBuy" type="button" disabled={locked || !props.starsEnabled || founderPermanent === FOUNDER_ITEMS.length || awaiting.has('founder_pack')} onClick={() => buy('founder_pack', founderPermanent === FOUNDER_ITEMS.length)}>{pending === 'buy:founder_pack' ? 'Ожидаем Telegram…' : founderPermanent === FOUNDER_ITEMS.length ? 'Набор уже в коллекции' : awaiting.has('founder_pack') ? 'Ожидаем подтверждения' : <>Купить набор<span><GameIcon name="star" size={17} />{PRODUCTS.founder_pack.stars} Stars</span></>}</button>{notice('buy:founder_pack')}{awaitingPurchase('founder_pack', founderPermanent === FOUNDER_ITEMS.length)}{notice('recover:founder_pack')}</section>

    <section className="card premiumOffer" data-product-id="premium_30d" aria-labelledby={`${id}-premium`}><div className="shopSectionHeading"><div><span className="shopEyebrow">Для развития колонии</span><h2 id={`${id}-premium`}>COLONY Premium</h2></div><span className={`premiumOwnership${props.premium ? ' isActive' : ''}`}>{props.premium ? 'Активен' : `${PRODUCTS.premium_30d.days} дней`}</span></div>{props.premium && <p className="premiumUntil">{dateText(props.premiumUntil) ? `Действует до ${dateText(props.premiumUntil)}` : 'Premium активен в твоей колонии.'}</p>}<ul className="premiumBenefits"><li><GameIcon name="ore" size={20} /><span><strong>+{Math.round((PREMIUM_PRODUCTION_MULTIPLIER - 1) * 100)}% к добыче</strong>Руда, энергия и кредиты</span></li><li><GameIcon name="clock" size={20} /><span><strong>−{Math.round((1 - PREMIUM_BUILD_SPEED_MULTIPLIER) * 100)}% времени</strong>Строительство и улучшения зданий</span></li><li><GameIcon name="build" size={20} /><span><strong>2 → 3 стройки</strong>Больше работ одновременно</span></li><li><GameIcon name="city" size={20} /><span><strong>{DEFAULT_OFFLINE_CAP_HOURS} → {PREMIUM_OFFLINE_CAP_HOURS} часов</strong>Базовый лимит добычи без открытой игры</span></li></ul><p className="premiumExplanation">Каждая покупка добавляет {PRODUCTS.premium_30d.days} дней к действующему сроку Premium.</p><div className="premiumPurchaseOptions"><div><button className="action cosmeticBuy" type="button" disabled={locked || !props.starsEnabled} onClick={() => buy('premium_30d')}>{pending === 'buy:premium_30d' ? 'Ожидаем Telegram…' : <>{props.premium ? 'Продлить' : ('На ' + PRODUCTS.premium_30d.days + ' дней')}<span><GameIcon name="star" size={17} />{PRODUCTS.premium_30d.stars} Stars</span></>}</button>{notice('buy:premium_30d')}</div><div><button className="action secondary" type="button" disabled={locked || props.crystals < CRYSTAL_PREMIUM_PRICE} onClick={() => { if (props.crystals >= CRYSTAL_PREMIUM_PRICE) void run('premium:crystals', props.onPremiumCrystals, `Premium продлён на ${PRODUCTS.premium_30d.days} дней.`); }}>{pending === 'premium:crystals' ? 'Применяем…' : <><GameIcon name="crystals" size={17} />{number(CRYSTAL_PREMIUM_PRICE)} кристаллов</>}</button>{props.crystals < CRYSTAL_PREMIUM_PRICE && <p className="shopCrystalDeficit">Не хватает {number(CRYSTAL_PREMIUM_PRICE - props.crystals)} кристаллов.</p>}{notice('premium:crystals')}</div></div></section>

    </>}

    {props.view !== 'offers' && <>
    <section className="card cosmeticCollection" aria-labelledby={`${id}-collection`}><div className="shopSectionHeading"><div><span className="shopEyebrow">Полученные предметы</span><h2 id={`${id}-collection`}>Моя коллекция</h2></div><span>{collection.length}</span></div><p>Выбери по одному оформлению каждого вида. Надетый предмет можно снять.</p>{collection.length === 0 ? <div className="emptyCosmeticCollection"><GameIcon name="star" size={29} /><strong>Коллекция начинается с первого предмета</strong><span>Оформление приходит за достижения, задания, сезоны и покупки.</span></div> : <><div className="collectionCategories" role="group" aria-label="Виды оформления"><button type="button" className={selectedCategory === 'all' ? 'isSelected' : ''} aria-pressed={selectedCategory === 'all'} onClick={() => setCategory('all')}>Все · {collection.length}</button>{categories.map((value) => <button key={value} type="button" className={selectedCategory === value ? 'isSelected' : ''} aria-pressed={selectedCategory === value} onClick={() => setCategory(value)}>{categoryInfo(value).name} · {collection.filter((item) => item.category === value).length}</button>)}</div><div className="collectionGrid">{shownItems.map((item) => <article key={item.id} className={`collectionItem${item.equipped ? ' isEquipped' : ''}`} data-cosmetic-id={item.id} aria-labelledby={`${id}-owned-${item.id}`}><CosmeticPreview cosmeticId={item.id} category={item.category} label={item.name} className="collectionCosmeticArt" /><div className="collectionItemBody"><h3 id={`${id}-owned-${item.id}`}>{item.name}</h3><p className="cosmeticWhere">{categoryInfo(item.category).where}</p>{status(item)}<div className="collectionActions">{previewButton(item)}<button className={`action ${item.equipped ? 'secondary' : ''}`} type="button" disabled={locked} onClick={() => equip(item)}>{pending === `equip:${item.id}` ? 'Применяем…' : item.equipped ? 'Снять' : 'Надеть'}</button></div>{notice(`equip:${item.id}`)}</div></article>)}</div></>}</section>

    </>}

    <section className="card shopRecovery" aria-labelledby={`${id}-recovery`}><h2 id={`${id}-recovery`}>Покупка пока не появилась?</h2><p>Проверь подтверждённые покупки Telegram, чтобы обновить коллекцию и Premium.</p><button className="action secondary" type="button" disabled={locked || !props.starsEnabled} onClick={() => { if (props.starsEnabled) void run('recover', props.onRecover, 'Покупки проверены. Коллекция и Premium обновлены.'); }}>{pending === 'recover' ? 'Проверяем покупки…' : 'Проверить покупки'}</button>{notice('recover')}</section>

    <dialog ref={dialogRef} className="cosmeticsPreviewDialog" aria-modal="true" aria-labelledby={`${id}-preview-title`} aria-describedby={`${id}-preview-description`} onCancel={(event) => { event.preventDefault(); setPreview(null); }} onClick={(event) => { if (event.target === event.currentTarget) setPreview(null); }}>{preview && <div className="cosmeticsPreviewBody"><header><div><span className="shopEyebrow">Предпросмотр</span><h2 id={`${id}-preview-title`}>{preview.name}</h2></div><button ref={closeRef} className="cosmeticsPreviewClose" type="button" aria-label="Закрыть предпросмотр" onClick={() => setPreview(null)}><GameIcon name="close" size={21} /></button></header><p id={`${id}-preview-description`}>{categoryInfo(preview.category).where} Это пример для сравнения; применение доступно в коллекции.</p><div className="cosmeticsComparison"><div><span>Сейчас</span><CosmeticPreview cosmeticId={currentPreview?.id ?? ''} category={preview.category} label={currentPreview?.name ?? 'Базовое оформление'} /><strong>{currentPreview?.name ?? 'Базовое оформление'}</strong></div><div><span>Выбранный предмет</span><CosmeticPreview cosmeticId={preview.id} category={preview.category} label={preview.name} /><strong>{preview.name}</strong></div></div><button className="action secondary" type="button" onClick={() => setPreview(null)}>Вернуться к выбору</button></div>}</dialog>
  </div>;
}
