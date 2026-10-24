'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CosmeticPreview } from '@/components/CosmeticAppearance';
import { GameIcon } from '@/components/GameIcon';
import { BuildingArt } from '@/components/BuildingArt';
import { DecorArt } from '@/components/DecorArt';
import { MechanicGuide } from '@/components/MechanicGuide';
import { APPEARANCE_OBJECTS, APPEARANCE_PAGE_SIZE, appearancePage, type AppearanceKind } from '@/lib/game/appearance';
import { cosmeticInventory, type CosmeticInventoryItem } from '@/lib/game/cosmetic-inventory';
import { premiumDisplayStatus, recoveryReceiptMessage } from '@/lib/game/shop-status';
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
  crystalCheckRequired?: boolean;
  awaitingProducts?: string[];
  onBuy: (productId: string) => Promise<void>;
  onEquip: (cosmeticId: string, equipped?: boolean) => Promise<void>;
  onPremiumCrystals: () => Promise<void>;
  onRecover: () => Promise<unknown>;
  onRefresh?: () => Promise<unknown>;
  onOpenCollection?: () => void;
  onOpenMap?: () => void;
  onOpenDecor?: () => void;
  onAchievements?: () => void;
};

type Item = CosmeticInventoryItem;
type PreviewItem = Pick<Item, 'id' | 'name' | 'category'>;
type Feedback = { text: string; error: boolean; receipt?: unknown };
type ProductId = keyof typeof PRODUCTS;

const CATEGORIES: Record<string, { name: string; where: string; icon: string }> = {
  theme: { name: 'Стили колонии', where: 'Единое оформление всех зданий, декора, настилов и входов. Новые объекты получают его автоматически.', icon: 'city' },
  weather: { name: 'Небо', where: 'Видно над картой твоего города и при его просмотре.', icon: 'star' },
  frame: { name: 'Рамки', where: 'Обрамляет карту города и имя в профиле колонии.', icon: 'social' },
  badge: { name: 'Знаки', where: 'Знак рядом с названием колонии.', icon: 'star' },
  title: { name: 'Титулы', where: 'Подпись под названием колонии.', icon: 'social' },
  effect: { name: 'Эффекты', where: 'Добавляет визуальный эффект на карте города.', icon: 'energy' },
  building_skin: { name: 'Монументы', where: 'Появляется под картой города. Не занимает клетку и не повышает комфорт.', icon: 'building' },
};

const COSMETIC_PRODUCTS = (Object.entries(PRODUCTS) as [ProductId, typeof PRODUCTS[ProductId]][])
  .filter((entry): entry is [ProductId, Extract<typeof PRODUCTS[ProductId], { kind: 'cosmetic' }>] => entry[1].kind === 'cosmetic');

const DESCRIPTIONS: Record<string, { name: string; category: string; text: string }> = {
  theme_neon: { name: 'Неоновый город', category: 'theme', text: 'Неоновая палитра, световые контуры платформ и отделка панелей для всей колонии. Одна покупка — все типы объектов.' },
  weather_aurora: { name: 'Северное сияние', category: 'weather', text: 'Мягкие переливы северного сияния над колонией.' },
  frame_orbit: { name: 'Орбитальная рамка', category: 'frame', text: 'Светлая орбитальная окантовка карты города и имени в профиле.' },
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
  const [collectionPage, setCollectionPage] = useState(0);
  const [preview, setPreview] = useState<PreviewItem | null>(null);
  const [previewKind, setPreviewKind] = useState<AppearanceKind>('building');
  const [previewPage, setPreviewPage] = useState(0);
  const [previewObjectIndex, setPreviewObjectIndex] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [ownershipNow, setOwnershipNow] = useState(() => Date.now());
  const [localCrystalCheckRequired, setCrystalCheckRequired] = useState(false);
  const [collectionFocus, setCollectionFocus] = useState<{ id: string; requestId: number } | null>(null);
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  const inFlight = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<Element | null>(null);
  const focusedCollectionRef = useRef<HTMLElement>(null);
  const collectionFocusPending = useRef(false);
  const locked = props.busy || pending !== null;
  const crystalCheckRequired = props.crystalCheckRequired === true || localCrystalCheckRequired;
  const premiumStatus = premiumDisplayStatus(props.premium, props.premiumUntil, Date.now());
  const catalog = useMemo(() => new Map((props.shopCosmetics ?? []).map((item: any) => [String(item.id), item])), [props.shopCosmetics]);
  const collection = useMemo(() => cosmeticInventory(props.cosmetics ?? [], props.shopCosmetics ?? []), [props.cosmetics, props.shopCosmetics, ownershipNow]);
  const owned = new Map(collection.map((item) => [item.id, item]));
  const awaiting = new Set(props.awaitingProducts ?? []);
  const categories = [...new Set(collection.map((item) => item.category))];
  const selectedCategory = categories.includes(category) ? category : 'all';
  const shownItems = selectedCategory === 'all' ? collection : collection.filter((item) => item.category === selectedCategory);
  const collectionPages = Math.max(1, Math.ceil(shownItems.length / APPEARANCE_PAGE_SIZE));
  const selectedCollectionPage = Math.min(collectionPage, collectionPages - 1);
  const visibleItems = shownItems.slice(selectedCollectionPage * APPEARANCE_PAGE_SIZE, (selectedCollectionPage + 1) * APPEARANCE_PAGE_SIZE);
  const founderPermanent = FOUNDER_ITEMS.filter((item) => owned.get(item.id)?.expiresAt === null).length;
  const founderOwned = FOUNDER_ITEMS.filter((item) => owned.has(item.id)).length;
  const ownedFounderItem = FOUNDER_ITEMS.find(item => owned.has(item.id));
  const currentPreview = preview ? collection.find((item) => item.category === preview.category && item.equipped) : null;
  const themePreview = preview?.category === 'theme';
  const objects = appearancePage(previewKind, previewPage);
  const previewSubject = objects.items[previewObjectIndex] ?? objects.items[0];
  const buildingCount = APPEARANCE_OBJECTS.filter(item => item.kind === 'building').length;
  const decorCount = APPEARANCE_OBJECTS.filter(item => item.kind === 'decor').length;

  useEffect(() => {
    if (props.crystalCheckRequired === false) setCrystalCheckRequired(false);
  }, [props.crystalCheckRequired]);

  // Known deadlines expire even while the player keeps this screen open.
  useEffect(() => {
    const now = Date.now();
    const deadlines = (props.cosmetics ?? []).map(row => row.expires_at ? new Date(row.expires_at).getTime() : Infinity);
    if (props.premium && props.premiumUntil) deadlines.push(new Date(props.premiumUntil).getTime());
    const nextExpiry = Math.min(...deadlines.filter(time => time > now));
    if (!Number.isFinite(nextExpiry)) return;
    const timer = window.setTimeout(() => setOwnershipNow(Date.now()), Math.min(2_147_483_647, Math.max(1, nextExpiry - now)));
    return () => window.clearTimeout(timer);
  }, [props.cosmetics, props.premium, props.premiumUntil, ownershipNow]);

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

  useEffect(() => {
    if (!collectionFocusPending.current || !collectionFocus || props.view === 'offers') return;
    if (!collection.some(item => item.id === collectionFocus.id)) { collectionFocusPending.current = false; return; }
    const element = focusedCollectionRef.current;
    if (!element) return;
    // The parent first scrolls a changed subsection to the top.
    const frame = window.requestAnimationFrame(() => {
      collectionFocusPending.current = false;
      element.focus({ preventScroll: true });
      element.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [props.view, collectionFocus, selectedCategory, selectedCollectionPage, collection]);

  async function run<T,>(key: string, operation: () => Promise<T>, success: string | ((result: T) => string)) {
    if (locked || inFlight.current) return;
    inFlight.current = true;
    setPending(key);
    setFeedback((previous) => { const next = { ...previous }; delete next[key]; return next; });
    try {
      const result = await operation();
      setFeedback((previous) => ({ ...previous, [key]: { text: typeof success === 'function' ? success(result) : success, error: false, ...(key.startsWith('recover') ? { receipt: result } : {}) } }));
    } catch (cause) {
      setFeedback((previous) => ({ ...previous, [key]: { text: cause instanceof Error ? cause.message : 'Не удалось выполнить действие. Попробуй ещё раз.', error: true } }));
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }

  function recover(key: string) {
    if (!props.starsEnabled) return;
    if (locked || inFlight.current) return;
    setFeedback(previous => Object.fromEntries(Object.entries(previous).filter(([entry]) => !entry.startsWith('recover') && !entry.startsWith('check:recover'))));
    void run(key, props.onRecover, recoveryReceiptMessage);
  }

  function refreshAction(key: string, recoveryKey?: string) {
    if (!props.onRefresh) return null;
    return <>
      <button type="button" className="action secondary shopStateCheck" disabled={locked} onClick={() => void run(key, async () => {
        await props.onRefresh!();
        setCrystalCheckRequired(false);
        setFeedback(previous => {
          const next = { ...previous };
          for (const [entry, value] of Object.entries(next)) {
            if (entry.startsWith('check:')) delete next[entry];
            if (entry.startsWith('recover')) {
              const receipt = value.receipt && typeof value.receipt === 'object' && !Array.isArray(value.receipt)
                ? { ...value.receipt, stateUpdated: true } : { stateUpdated: true };
              next[entry] = { text: value.error ? 'Данные колонии обновлены. Проверь коллекцию и срок Premium.' : recoveryReceiptMessage(receipt), error: false, receipt };
            }
          }
          if (next['premium:crystals']?.error) next['premium:crystals'] = { text: 'Данные обновлены. Проверь срок Premium перед новой покупкой.', error: false };
          return next;
        });
      }, 'Данные колонии обновлены.')}>
        {pending === key ? 'Обновляем данные…' : 'Обновить данные'}
      </button>
      {(!recoveryKey || feedback[key]?.error) && notice(key)}
    </>;
  }

  function buyPremiumCrystals() {
    if (crystalCheckRequired || props.crystals < CRYSTAL_PREMIUM_PRICE) return;
    void run('premium:crystals', async () => {
      try { await props.onPremiumCrystals(); }
      catch (cause) { setCrystalCheckRequired(true); throw cause; }
    }, `К сроку Premium добавлено ${PRODUCTS.premium_30d.days} дней.`);
  }

  function buy(productId: ProductId, permanent = false) {
    if (!props.starsEnabled || permanent || awaiting.has(productId)) return;
    void run(`buy:${productId}`, () => props.onBuy(productId), productId === 'premium_30d'
      ? 'Ответ Telegram получен. После подтверждения оплаты срок Premium обновится.'
      : 'Ответ Telegram получен. После подтверждения оплаты оформление появится в коллекции.');
  }
  function equip(item: Item, equipped = !item.equipped || item.needsLongerApplication) {
    if (item.expiresAt && !(new Date(item.expiresAt).getTime() > Date.now())) {
      setOwnershipNow(Date.now());
      return;
    }
    void run(`equip:${item.id}`, () => props.onEquip(item.id, equipped), equipped ? 'Оформление применено.' : 'Оформление снято.');
  }
  function notice(key: string) {
    const value = feedback[key];
    return value ? <div className={`notice shopFeedback${value.error ? ' error' : ''}`} role={value.error ? 'alert' : 'status'}><span>{value.text}</span>{!value.error && key.startsWith('equip:') && props.onOpenMap && <button type="button" className="action secondary shopMapLink" onClick={props.onOpenMap}>Посмотреть город<GameIcon name="arrow" size={14} /></button>}{key.startsWith('recover') && refreshAction(`check:${key}`, key)}</div> : null;
  }
  function status(item?: Item) {
    return item && <div className="cosmeticOwnership">{item.equipped && <span className="cosmeticEquipped"><GameIcon name="check" size={14} />{item.appliedExpiresAt === null ? 'Применено навсегда' : `Применено до ${dateText(item.appliedExpiresAt)}`}</span>}<span>{item.expiresAt === null ? 'Есть навсегда' : `Временно · до ${dateText(item.expiresAt)}`}</span>{item.needsLongerApplication && <span className="cosmeticApplyHint">{item.expiresAt === null ? 'Постоянное право ещё нужно применить.' : 'Более долгий срок ещё нужно применить.'}</span>}</div>;
  }
  function openCollection(cosmeticId?: string) {
    const item = cosmeticId ? owned.get(cosmeticId) : undefined;
    setPreview(null);
    if (item) {
      const index = collection.filter(entry => entry.category === item.category).findIndex(entry => entry.id === item.id);
      setCategory(item.category);
      setCollectionPage(Math.floor(Math.max(0, index) / APPEARANCE_PAGE_SIZE));
      collectionFocusPending.current = true;
      setCollectionFocus(previous => ({ id: item.id, requestId: (previous?.requestId ?? 0) + 1 }));
    } else {
      setCategory('all'); setCollectionPage(0); collectionFocusPending.current = false;
    }
    props.onOpenCollection?.();
  }
  function collectionButton(cosmeticId: string, label = 'Найти в коллекции') {
    return owned.has(cosmeticId) && (props.view !== 'offers' || props.onOpenCollection) ? <button type="button" className="action secondary shopCollectionLink" data-shop-open-collection={cosmeticId} onClick={() => openCollection(cosmeticId)}><GameIcon name="palette" size={16} />{label}<GameIcon name="arrow" size={14} /></button> : null;
  }
  function openPreview(item: PreviewItem) {
    setPreviewKind('building');
    setPreviewPage(0);
    setPreviewObjectIndex(0);
    setPreview(item);
  }
  function previewButton(item: PreviewItem) {
    return <button className="action secondary cosmeticPreviewButton" type="button" aria-haspopup="dialog" onClick={() => openPreview(item)}><GameIcon name="info" size={17} />Предпросмотр</button>;
  }
  function awaitingPurchase(productId: ProductId, permanent: boolean) {
    if (permanent || !awaiting.has(productId)) return null;
    return <><p className="shopPurchaseNote" role="status">Оплата ожидает подтверждения Telegram. Проверь покупку перед повтором.{!props.starsEnabled && ' Проверка станет доступна, когда возобновятся покупки за Telegram Stars.'}</p><button className="action secondary" type="button" disabled={locked || !props.starsEnabled} onClick={() => {
      recover(`recover:${productId}`);
    }}>{pending === `recover:${productId}` ? 'Проверяем покупку…' : 'Проверить покупку'}</button></>;
  }
  function starsAvailability(productId: ProductId, permanent = false) {
    if (props.starsEnabled || permanent || awaiting.has(productId)) return null;
    return <p className="shopPurchaseNote" role="status">Оплата за Telegram Stars временно недоступна. Предпросмотр работает.</p>;
  }

  return <div className="cosmeticsShop">
    {props.view !== 'collection' && <>
    <section className="card shopIntroduction" aria-labelledby={`${id}-shop`}><span className="shopEyebrow">Оформление колонии</span><h2 id={`${id}-shop`}>Твой город. Твой стиль.</h2><p>Примеряй оформление бесплатно и применяй полученные предметы в коллекции. Стили и украшения не меняют добычу и комфорт.</p><p className="shopCurrencyNote"><span><GameIcon name="stars" size={17} />Telegram Stars — валюта Telegram.</span><span><GameIcon name="crystals" size={17} />Кристаллы — ресурс COLONY.</span></p><MechanicGuide steps={[
      'Предпросмотр ничего не покупает и не применяет. Сравни оформление с текущим видом колонии перед выбором.',
      'Стиль покрывает все здания и декор, включая будущие типы объектов. Он не открывает постройки: для них по-прежнему нужны уровень Центра колонии и технологии.',
      'Покупка и применение — разные действия. После подтверждения оплаты предмет появится в коллекции; там можно применить по одному оформлению каждого вида. Premium имеет отдельные бонусы и срок.',
    ]} />{props.view === undefined && <nav className="shopJumpLinks" aria-label="Разделы магазина"><a href={`#${id}-collection`}>Моя коллекция</a><a href={`#${id}-offers`}>Витрина</a><a href={`#${id}-premium`}>Premium</a></nav>}{!props.starsEnabled && <div className="notice shopPaused" role="status">Покупки за Telegram Stars и проверка платежей временно недоступны. Premium можно приобрести за кристаллы.</div>}</section>

    <section className="shopOffers" aria-labelledby={`${id}-offers`}><div className="shopSectionHeading"><h2 id={`${id}-offers`}>Витрина</h2><span>Постоянное оформление</span></div><div className="cosmeticOfferGrid">{COSMETIC_PRODUCTS.map(([productId, product]) => {
      const description = DESCRIPTIONS[product.cosmeticId];
      const config = catalog.get(product.cosmeticId);
      const item = { id: product.cosmeticId, name: config?.name || description.name, category: config?.category || description.category };
      const inventory = owned.get(item.id);
      const permanent = inventory?.expiresAt === null;
      return <article key={productId} className="card cosmeticOffer" data-cosmetic-id={item.id} data-product-id={productId} aria-labelledby={`${id}-${productId}`}><CosmeticPreview cosmeticId={item.id} category={item.category} label={item.name} className="shopCosmeticArt" /><div className="cosmeticOfferBody"><span className="cosmeticCategory">{categoryInfo(item.category).name}</span><h3 id={`${id}-${productId}`}>{item.name}</h3><p>{description.text}</p><p className="cosmeticWhere">{categoryInfo(item.category).where}</p>{status(inventory)}{previewButton(item)}{collectionButton(item.id)}<button className="action cosmeticBuy" type="button" disabled={locked || !props.starsEnabled || permanent || awaiting.has(productId)} onClick={() => buy(productId, permanent)}>{pending === `buy:${productId}` ? 'Ожидаем Telegram…' : permanent ? 'Уже есть навсегда' : awaiting.has(productId) ? 'Ожидаем подтверждения' : <>{inventory ? 'Купить навсегда' : 'Купить'}<span><GameIcon name="stars" size={16} />{product.stars} Telegram Stars</span></>}</button>{starsAvailability(productId, permanent)}{notice(`buy:${productId}`)}{awaitingPurchase(productId, permanent)}{notice(`recover:${productId}`)}</div></article>;
    })}</div></section>

    <section className="card founderOffer" data-product-id="founder_pack" aria-labelledby={`${id}-founder`}><div className="shopSectionHeading"><div><span className="shopEyebrow">Набор основателя</span><h2 id={`${id}-founder`}>{PRODUCTS.founder_pack.title}</h2></div><span className="cosmeticPermanent">4 предмета навсегда</span></div><p>Знак, монумент, рамка и небо основателя составляют единый образ колонии.</p><div className="founderCombinedPreview" data-cosmetic-id="founder_pack"><CosmeticPreview cosmeticId="founder_pack" label="Образ основателя" /></div><div className="founderContents">{FOUNDER_ITEMS.map((base) => {
      const item = { ...base, name: catalog.get(base.id)?.name || base.name };
      const inventory = owned.get(item.id);
      return <button className="founderPreview" type="button" key={item.id} data-cosmetic-id={item.id} aria-haspopup="dialog" aria-label={`Предпросмотр: ${item.name}`} onClick={() => openPreview(item)}><CosmeticPreview cosmeticId={item.id} category={item.category} label={item.name} className="founderCosmeticArt" /><strong>{item.name}</strong><span>{inventory?.expiresAt === null ? 'Есть навсегда' : 'Посмотреть'}</span></button>;
    })}</div>{founderOwned > 0 && founderPermanent < FOUNDER_ITEMS.length && <p className="founderPartial">Навсегда получено {founderPermanent} из {FOUNDER_ITEMS.length} предметов набора.{founderOwned > founderPermanent && ` Ещё ${founderOwned - founderPermanent} доступны временно.`} Цена полная, без скидки за уже полученные предметы. Все четыре станут постоянными.</p>}{ownedFounderItem && <>{collectionButton(ownedFounderItem.id, 'Открыть предметы в коллекции')}<p className="shopPurchaseNote">Каждый вид оформления применяется отдельно. Найти нужный предмет можно и через его предпросмотр.</p></>}<button className="action cosmeticBuy founderBuy" type="button" disabled={locked || !props.starsEnabled || founderPermanent === FOUNDER_ITEMS.length || awaiting.has('founder_pack')} onClick={() => buy('founder_pack', founderPermanent === FOUNDER_ITEMS.length)}>{pending === 'buy:founder_pack' ? 'Ожидаем Telegram…' : founderPermanent === FOUNDER_ITEMS.length ? 'Набор уже в коллекции' : awaiting.has('founder_pack') ? 'Ожидаем подтверждения' : <>Купить набор<span><GameIcon name="stars" size={17} />{PRODUCTS.founder_pack.stars} Telegram Stars</span></>}</button>{starsAvailability('founder_pack', founderPermanent === FOUNDER_ITEMS.length)}{notice('buy:founder_pack')}{awaitingPurchase('founder_pack', founderPermanent === FOUNDER_ITEMS.length)}{notice('recover:founder_pack')}</section>

    <section className="card premiumOffer" data-product-id="premium_30d" aria-labelledby={`${id}-premium`}>
      <div className="shopSectionHeading"><div><span className="shopEyebrow">Для развития колонии</span><h2 id={`${id}-premium`}>COLONY Premium</h2></div><span className={`premiumOwnership${premiumStatus.active ? ' isActive' : premiumStatus.expiredNeedsRefresh ? ' isExpired' : ''}`} data-premium-status>{premiumStatus.active ? 'Активен' : premiumStatus.expiredNeedsRefresh ? 'Нужна проверка срока' : `${PRODUCTS.premium_30d.days} дней`}</span></div>
      {premiumStatus.active && <p className="premiumUntil">{dateText(premiumStatus.expiresAt) ? `Действует до ${dateText(premiumStatus.expiresAt)}` : 'Premium активен в твоей колонии.'}</p>}
      {premiumStatus.expiredNeedsRefresh && <div className="premiumStatusCheck" data-premium-expired role="status"><strong>Указанный срок Premium истёк</strong><p>Срок закончился {dateText(premiumStatus.expiresAt)}. Обнови данные, чтобы проверить текущий статус и бонусы. Проверка бесплатна.</p>{refreshAction('check:premium')}</div>}
      {!premiumStatus.expiredNeedsRefresh && notice('check:premium')}
      <ul className="premiumBenefits"><li><GameIcon name="ore" size={20} /><span><strong>+{Math.round((PREMIUM_PRODUCTION_MULTIPLIER - 1) * 100)}% к добыче</strong>Руда, энергия и кредиты</span></li><li><GameIcon name="clock" size={20} /><span><strong>−{Math.round((1 - PREMIUM_BUILD_SPEED_MULTIPLIER) * 100)}% времени</strong>Строительство и улучшения зданий</span></li><li><GameIcon name="build" size={20} /><span><strong>2 → 3 стройки</strong>Больше работ одновременно</span></li><li><GameIcon name="city" size={20} /><span><strong>{DEFAULT_OFFLINE_CAP_HOURS} → {PREMIUM_OFFLINE_CAP_HOURS} часов</strong>Базовый лимит добычи без открытой игры</span></li></ul>
      <p className="premiumExplanation">Выбери один способ оплаты. Каждая покупка добавляет {PRODUCTS.premium_30d.days} дней к действующему сроку Premium. Автоматического продления нет.</p>
      {awaiting.has('premium_30d') && <p className="shopPurchaseNote premiumPendingNote">Одна оплата Premium ещё ожидает подтверждения. Покупка за кристаллы будет отдельной покупкой и добавит ещё {PRODUCTS.premium_30d.days} дней.</p>}
      <div className="premiumPurchaseOptions">
        <div><button className="action cosmeticBuy" type="button" disabled={locked || !props.starsEnabled || awaiting.has('premium_30d')} onClick={() => buy('premium_30d')}>{pending === 'buy:premium_30d' ? 'Ожидаем Telegram…' : awaiting.has('premium_30d') ? 'Ожидаем подтверждения' : <>{premiumStatus.active ? 'Продлить' : ('На ' + PRODUCTS.premium_30d.days + ' дней')}<span><GameIcon name="stars" size={17} />{PRODUCTS.premium_30d.stars} Telegram Stars</span></>}</button>{starsAvailability('premium_30d')}{notice('buy:premium_30d')}{awaitingPurchase('premium_30d', false)}{notice('recover:premium_30d')}</div>
        <div><button className="action secondary" type="button" data-premium-crystals disabled={locked || crystalCheckRequired || props.crystals < CRYSTAL_PREMIUM_PRICE} onClick={buyPremiumCrystals}>{pending === 'premium:crystals' ? 'Применяем…' : <>{premiumStatus.active ? `Продлить на ${PRODUCTS.premium_30d.days} дней` : `На ${PRODUCTS.premium_30d.days} дней`}<span><GameIcon name="crystals" size={17} />{number(CRYSTAL_PREMIUM_PRICE)} кристаллов</span></>}</button><p className="shopPurchaseNote">В наличии: {number(props.crystals)} кристаллов.</p>{props.crystals < CRYSTAL_PREMIUM_PRICE && <p className="shopCrystalDeficit" role="status">Не хватает {number(CRYSTAL_PREMIUM_PRICE - props.crystals)} кристаллов.</p>}{notice('premium:crystals')}{crystalCheckRequired && <div className="premiumStatusCheck" data-crystal-check-required><p>Обнови данные перед повторной покупкой: кристаллы могли уже списаться, а срок Premium — продлиться.</p>{props.onRefresh ? refreshAction('check:crystals') : <p>Закрой и снова открой игру, чтобы проверить результат.</p>}</div>}{!crystalCheckRequired && notice('check:crystals')}</div>
      </div>
    </section>

    </>}

    {props.view !== 'offers' && <>
    <section className="card cosmeticCollection" aria-labelledby={`${id}-collection`}>
      <div className="shopSectionHeading"><div><span className="shopEyebrow">Полученные предметы</span><h2 id={`${id}-collection`}>Моя коллекция</h2></div><span>{collection.length}</span></div>
      <p>Выбери по одному оформлению каждого вида. Стиль колонии применяется ко всем объектам сразу.</p>
      <div className="shopAppearanceHelp"><p>Оформление меняет внешний вид. Комфорт повышают предметы благоустройства, размещённые на карте города.</p>{props.onOpenDecor && <button type="button" className="action secondary" onClick={props.onOpenDecor}>К благоустройству<GameIcon name="arrow" size={14} /></button>}</div>
      {props.view === 'collection' && <MechanicGuide steps={[
        'Здесь собраны предметы из покупок и игровых наград. Предпросмотр бесплатный: сравнение не меняет твой город.',
        'Нажми «Применить», чтобы включить выбранное оформление. В каждом виде действует один предмет; кнопка «Снять» возвращает базовый вид.',
        '«Есть навсегда» означает постоянный доступ. Временный предмет можно применять до указанной даты; после неё он исчезнет из доступной коллекции.',
      ]} />}
      {collection.length === 0 ? <div className="emptyCosmeticCollection"><GameIcon name="star" size={29} /><strong>Коллекция начинается с первого предмета</strong><span>Оформление приходит за достижения, задания, сезоны и покупки.</span>{props.onAchievements && <button type="button" className="action secondary" onClick={props.onAchievements}>Посмотреть награды достижений<GameIcon name="arrow" size={14} /></button>}</div> : <>
        <div className="collectionCategories" role="group" aria-label="Виды оформления">
          <button type="button" className={selectedCategory === 'all' ? 'isSelected' : ''} aria-pressed={selectedCategory === 'all'} onClick={() => { setCategory('all'); setCollectionPage(0); }}>Все · {collection.length}</button>
          {categories.map(value => <button key={value} type="button" className={selectedCategory === value ? 'isSelected' : ''} aria-pressed={selectedCategory === value} onClick={() => { setCategory(value); setCollectionPage(0); }}>{categoryInfo(value).name} · {collection.filter(item => item.category === value).length}</button>)}
        </div>
        <div className="collectionGrid">{visibleItems.map(item => <article key={item.id} ref={item.id === collectionFocus?.id ? focusedCollectionRef : undefined} tabIndex={-1} className={`collectionItem${item.equipped ? ' isEquipped' : ''}`} data-cosmetic-id={item.id} data-shop-collection-item={item.id} aria-labelledby={`${id}-owned-${item.id}`}>
          <CosmeticPreview cosmeticId={item.id} category={item.category} label={item.name} className="collectionCosmeticArt" />
          <div className="collectionItemBody"><h3 id={`${id}-owned-${item.id}`}>{item.name}</h3><p className="cosmeticWhere">{categoryInfo(item.category).where}</p>{status(item)}
            <div className="collectionActions">{previewButton(item)}<button className={`action ${item.equipped && !item.needsLongerApplication ? 'secondary' : ''}`} type="button" data-shop-equip={item.id} disabled={locked} onClick={() => equip(item)}>{pending === `equip:${item.id}` ? 'Меняем оформление…' : item.needsLongerApplication ? item.expiresAt === null ? 'Применить навсегда' : 'Применить на весь срок' : item.equipped ? 'Снять' : 'Применить'}</button>{item.needsLongerApplication && <button type="button" className="action secondary collectionRemove" disabled={locked} onClick={() => equip(item, false)}>{pending === `equip:${item.id}` ? 'Меняем оформление…' : 'Снять текущее оформление'}</button>}</div>{notice(`equip:${item.id}`)}
          </div>
        </article>)}</div>
        {collectionPages > 1 && <nav className="cosmeticPager" aria-label="Страницы коллекции"><button type="button" disabled={selectedCollectionPage === 0} onClick={() => setCollectionPage(selectedCollectionPage - 1)}>Назад</button><span aria-live="polite">{selectedCollectionPage + 1} / {collectionPages}</span><button type="button" disabled={selectedCollectionPage + 1 === collectionPages} onClick={() => setCollectionPage(selectedCollectionPage + 1)}>Дальше</button></nav>}
      </>}
    </section>

    </>}

    <section className="card shopRecovery" aria-labelledby={`${id}-recovery`}><h2 id={`${id}-recovery`}>Покупка пока не появилась?</h2><p>Проверь подтверждённые покупки Telegram, чтобы обновить коллекцию и Premium. Проверка не списывает Telegram Stars или кристаллы.</p><button className="action secondary" type="button" disabled={locked || !props.starsEnabled} onClick={() => recover('recover')}>{pending === 'recover' ? 'Проверяем покупки…' : 'Проверить покупки'}</button>{!props.starsEnabled && <p className="shopPurchaseNote" role="status">Проверка временно недоступна: покупки за Telegram Stars приостановлены. Просмотр и применение коллекции работают.</p>}{notice('recover')}{!feedback.recover && props.onRefresh && <div className="shopSessionRefresh"><p>Если покупка уже подтверждена, сначала обнови данные колонии. Это не запускает проверку транзакций и доступно даже при паузе покупок за Stars.</p>{refreshAction('check:recovery')}</div>}</section>

    <dialog ref={dialogRef} className="cosmeticsPreviewDialog" aria-modal="true" aria-labelledby={`${id}-preview-title`} aria-describedby={`${id}-preview-description`} onCancel={event => { event.preventDefault(); setPreview(null); }} onClick={event => { if (event.target === event.currentTarget) setPreview(null); }}>
      {preview && <div className="cosmeticsPreviewBody">
        <header><div><span className="shopEyebrow">Бесплатный предпросмотр</span><h2 id={`${id}-preview-title`}>{preview.name}</h2></div><button ref={closeRef} className="cosmeticsPreviewClose" type="button" aria-label="Закрыть предпросмотр" onClick={() => setPreview(null)}><GameIcon name="close" size={21} /></button></header>
        <p id={`${id}-preview-description`}>{categoryInfo(preview.category).where} Применение доступно в коллекции.</p>
        {themePreview && <section className="themeObjectBrowser" data-theme-object-browser aria-label="Покрытие стиля колонии">
          <div className="themeCoverage"><GameIcon name="palette" size={18} /><span><strong>Весь город в одном стиле</strong>{buildingCount} типов зданий · {decorCount} видов декора</span></div>
          <div className="themeObjectKinds" role="group" aria-label="Объекты для предпросмотра">{(['building', 'decor'] as const).map(kind => <button key={kind} type="button" aria-pressed={previewKind === kind} className={previewKind === kind ? 'isSelected' : ''} onClick={() => { setPreviewKind(kind); setPreviewPage(0); setPreviewObjectIndex(0); }}>{kind === 'building' ? 'Здания' : 'Декор'} · {kind === 'building' ? buildingCount : decorCount}</button>)}</div>
          <div className="themeObjectChoices">{objects.items.map((item, index) => <button type="button" key={item.key} className={previewSubject?.key === item.key ? 'isSelected' : ''} aria-pressed={previewSubject?.key === item.key} aria-label={`Предпросмотр: ${item.name}`} data-theme-object={item.key} onClick={() => setPreviewObjectIndex(index)}>
            <span aria-hidden="true">{item.kind === 'building' ? <BuildingArt type={item.type} /> : <DecorArt type={item.type} />}</span><strong>{item.name}</strong>
          </button>)}</div>
          {objects.pages > 1 && <nav className="cosmeticPager" aria-label="Страницы объектов стиля"><button type="button" disabled={objects.page === 0} onClick={() => { setPreviewPage(objects.page - 1); setPreviewObjectIndex(0); }}>Назад</button><span aria-live="polite">{objects.page + 1} / {objects.pages}</span><button type="button" disabled={objects.page + 1 === objects.pages} onClick={() => { setPreviewPage(objects.page + 1); setPreviewObjectIndex(0); }}>Дальше</button></nav>}
          <p className="themeUnlockNote">Открытие построек по-прежнему зависит от уровня базы и исследований.</p>
        </section>}
        {themePreview && previewSubject && <h3 className="themeComparedObject" data-theme-compared-object={previewSubject.key}>{previewSubject.name}</h3>}
        <div className={`cosmeticsComparison${themePreview ? ' isThemeComparison' : ''}`}>
          <div><span>Сейчас</span><CosmeticPreview cosmeticId={currentPreview?.id ?? ''} category={preview.category} label={currentPreview?.name ?? 'Базовое оформление'} subject={themePreview ? previewSubject : undefined} /><strong>{currentPreview?.name ?? 'Базовое оформление'}</strong></div>
          <div><span>{themePreview ? 'Выбранный стиль' : 'Выбранный предмет'}</span><CosmeticPreview cosmeticId={preview.id} category={preview.category} label={preview.name} subject={themePreview ? previewSubject : undefined} /><strong>{preview.name}</strong></div>
        </div>
        {collectionButton(preview.id, 'Показать в коллекции')}
        <button className="action secondary" type="button" onClick={() => setPreview(null)}>Вернуться к выбору</button>
      </div>}
    </dialog>
  </div>;
}
