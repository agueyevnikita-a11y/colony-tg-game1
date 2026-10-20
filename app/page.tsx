'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CityGrid } from '@/components/CityGrid';
import { ResourceShortage } from '@/components/ResourceShortage';
import { ProductionPanel } from '@/components/ProductionPanel';
import { ResearchPanel } from '@/components/ResearchPanel';
import { GameIcon, GameAmount } from '@/components/GameIcon';
import { BuildingArt } from '@/components/BuildingArt';
import { ResourceBar } from '@/components/ResourceBar';
import { ConstructionStatus } from '@/components/ConstructionStatus';
import { ColonyWelcome } from '@/components/ColonyWelcome';
import { ColonyGuide } from '@/components/ColonyGuide';
import { MechanicsHelp } from '@/components/MechanicsHelp';
import { CosmeticsShop } from '@/components/CosmeticsShop';
import { ColonyIdentity } from '@/components/CosmeticAppearance';
import './front.css';
import type { FoundryLink, FoundryMode, FoundryRecipeKey } from '@/lib/game/foundry';
import { PRODUCTS } from '@/lib/game/config';
import { permanentProductOwned } from '@/lib/game/product-ownership';
import { APP_VERSION } from '@/lib/version';
import { useGameConnection } from '@/lib/client/use-game-connection';
import { RequestCancelled } from '@/lib/client/requests';
import { botAppLink, playerStartParam, shareTelegramLink, supportsTelegram, telegramHeaders } from '@/lib/client/telegram';

type Tab = 'city' | 'build' | 'market' | 'missions' | 'shop' | 'social';
const botLink = botAppLink(process.env.NEXT_PUBLIC_BOT_USERNAME);
const SECTION_TITLES: Record<Tab, { title: string; hint: string }> = {
  city: { title: 'COLONY', hint: 'Твой город и производство' },
  build: { title: 'Развитие', hint: 'Технологии и новые постройки' },
  market: { title: 'Рынок', hint: 'Обмен ресурсами между колониями' },
  missions: { title: 'Сезон', hint: 'Задания, достижения и награды' },
  shop: { title: 'Магазин', hint: 'Оформление твоей колонии' },
  social: { title: 'Связи', hint: 'Профиль, альянс и другие колонии' },
};
function readAwaitingProducts(key: string): string[] {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(key) ?? '[]');
    return Array.isArray(stored) ? [...new Set(stored.filter((id): id is string => typeof id === 'string' && Object.hasOwn(PRODUCTS, id) && PRODUCTS[id as keyof typeof PRODUCTS].kind !== 'premium'))] : [];
  } catch { return []; }
}
function saveAwaitingProducts(key: string, products: string[]) {
  try { if (products.length) sessionStorage.setItem(key, JSON.stringify(products)); else sessionStorage.removeItem(key); } catch { /* The in-memory hold still protects this session. */ }
}

function n(value: unknown) {
  return new Intl.NumberFormat('ru-RU', {
    notation: Number(value) > 99999 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(Number(value ?? 0));
}

function pct(progress: number, target: number) {
  return Math.max(0, Math.min(100, Math.round((Number(progress || 0) / Math.max(1, Number(target || 1))) * 100)));
}

function costDisplay(cost?: Record<string, number> | null) {
  if (!cost) return 'Максимальный уровень';
  return <span className="resourceCostInline">{Object.entries(cost).filter(([, value]) => Number(value) > 0).map(([resource, value]) => <GameAmount key={resource} resource={resource}>{n(value)}</GameAmount>)}</span>;
}

function productionText(p?: { resource: string; perHour: number } | null, type?: string) {
  if (type === 'foundry') return 'Детали по выбранному рецепту';
  if (type === 'research_lab') return 'Наука для исследований';
  if (!p) return 'не производит ресурс напрямую';
  return <GameAmount resource={p.resource}>{n(p.perHour)}/ч</GameAmount>;
}
function timeLeft(value?: string | null) { if(!value) return ''; const ms=Math.max(0,new Date(value).getTime()-Date.now()); const d=Math.floor(ms/86400000); const h=Math.floor((ms%86400000)/3600000); return d>0?`${d} дн. ${h} ч.`:`${h} ч.`; }
function countdown(value?: string | null) { if(!value) return ''; const ms=Math.max(0,new Date(value).getTime()-Date.now()); const h=Math.floor(ms/3600000); const m=Math.ceil((ms%3600000)/60000); return h>0?`${h} ч. ${m} мин.`:`${Math.max(1,m)} мин.`; }
function durationText(seconds:number){ if(Number(seconds)<60)return `${Math.max(1,Math.ceil(Number(seconds)))} сек.`; const h=Math.floor(Number(seconds)/3600); const m=Math.ceil((Number(seconds)%3600)/60); return h>0?`${h} ч. ${m?`${m} мин.`:''}`:`${Math.max(1,m)} мин.`; }
function marketResourceLabel(resource:string){return ({ore:'⛏ Руда',energy:'⚡ Энергия',parts:'⚙️ Детали'} as Record<string,string>)[resource]??resource;}

export default function Home() {
  const { game, setGame, busy, message, setMessage, phase, retry, api, refresh, connectionError } = useGameConnection();
  const [tab, setTab] = useState<Tab>('city');
  const [shareFallbackLink, setShareFallbackLink] = useState('');
  const handledStart = useRef(false);
  const requestingAccess = useRef(false);
  const [viewedCity, setViewedCity] = useState<any | null>(null);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const [placementType, setPlacementType] = useState<string | null>(null);
  const [moveBuildingId, setMoveBuildingId] = useState<string | null>(null);
  const [decorPlacementType, setDecorPlacementType] = useState<string | null>(null);
  const [selectedDecorId, setSelectedDecorId] = useState<string | null>(null);
  const [constructionFeedback, setConstructionFeedback] = useState<{ target: string; text: string; error: boolean } | null>(null);
  const cityMapRef = useRef<HTMLElement>(null);
  const mapFeedbackRef = useRef<HTMLDivElement>(null);
  const constructionFeedbackRef = useRef<HTMLDivElement>(null);
  const pendingProduction = useRef<{ key: string; requestId: string } | null>(null);
  const [focusedResearch, setFocusedResearch] = useState<string | null>(null);
  const [researchFocusVersion, setResearchFocusVersion] = useState(0);
  const [researchTarget, setResearchTarget] = useState<{ owner: string; key: string | null }>({ owner: '', key: null });
  const [requestedProductionRecipe, setRequestedProductionRecipe] = useState<FoundryRecipeKey | undefined>();
  const productionPanelRef = useRef<HTMLDivElement>(null);
  const productionNavigationPending = useRef(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [awaitingPurchases, setAwaitingPurchases] = useState<{ key: string; products: string[] }>({ key: '', products: [] });
  const invoiceOpening = useRef(false);
  const navigationToTop = useRef(false);
  const [guideNavigationVersion, setGuideNavigationVersion] = useState(0);
  const guideNavigationPending = useRef<'map' | 'production' | 'contracts' | 'hq' | 'research' | 'build' | null>(null);
  const contractsRef = useRef<HTMLElement>(null);
  const hqUpgradeRef = useRef<HTMLElement>(null);
  const researchPanelRef = useRef<HTMLDivElement>(null);
  const buildingCatalogRef = useRef<HTMLElement>(null);
  const [marketResource,setMarketResource]=useState<'ore'|'energy'|'parts'>('ore');
  const [marketAmount,setMarketAmount]=useState('100');
  const [marketPrice,setMarketPrice]=useState('3');
  const [buyAmounts,setBuyAmounts]=useState<Record<string,string>>({});
  const [allianceName,setAllianceName]=useState('');
  const [allianceCode,setAllianceCode]=useState('');
  const [allianceResource,setAllianceResource]=useState<'ore'|'energy'|'parts'>('ore');
  const [allianceAmount,setAllianceAmount]=useState('500');
  const [adminDashboard,setAdminDashboard]=useState<any | null>(null);
  const [profileName,setProfileName]=useState('');
  const [profileBio,setProfileBio]=useState('');
  const [betaCode,setBetaCode]=useState('');
  const [feedbackCategory,setFeedbackCategory]=useState('general');
  const [feedbackMessage,setFeedbackMessage]=useState('');
  const [adminGeneratedCode,setAdminGeneratedCode]=useState('');
  const purchaseUser = game?.userId ?? game?.telegramUser?.id;
  const purchaseStorageKey = purchaseUser ? `colony:awaiting-cosmetics:${purchaseUser}` : '';
  const awaitingProducts = awaitingPurchases.key === purchaseStorageKey ? awaitingPurchases.products : [];
  const planOwner = purchaseUser ? String(purchaseUser) : '';
  const plannedResearchKey = researchTarget.owner === planOwner ? researchTarget.key : null;

  useEffect(() => {
    if (!planOwner || !game?.research?.catalog) return;
    setResearchTarget(previous => {
      let key = previous.owner === planOwner ? previous.key : null;
      if (previous.owner !== planOwner) {
        try { key = localStorage.getItem(`colony:research-target:${planOwner}`); } catch { /* Planning remains available in memory. */ }
      }
      if (key && !game.research.catalog.some((item: any) => item.key === key)) key = null;
      return previous.owner === planOwner && previous.key === key ? previous : { owner: planOwner, key };
    });
  }, [planOwner, game?.research?.catalog]);

  function chooseResearchTarget(key: string | null) {
    if (!planOwner || (key && !game?.research?.catalog?.some((item: any) => item.key === key))) return;
    setResearchTarget({ owner: planOwner, key });
    try {
      const storageKey = `colony:research-target:${planOwner}`;
      if (key) localStorage.setItem(storageKey, key); else localStorage.removeItem(storageKey);
    } catch { /* The selected plan still works until this page is closed. */ }
    setFocusedResearch(null);
    guideNavigationPending.current = 'research';
    setGuideNavigationVersion(version => version + 1);
  }

  useEffect(() => {
    if (!purchaseStorageKey) return;
    setAwaitingPurchases(previous => {
      const products = previous.key === purchaseStorageKey ? previous.products : readAwaitingProducts(purchaseStorageKey);
      const waiting = products.filter(id => !permanentProductOwned(id, game?.cosmetics ?? []));
      if (previous.key === purchaseStorageKey && waiting.length === products.length) return previous;
      return { key: purchaseStorageKey, products: waiting };
    });
  }, [purchaseStorageKey, game?.cosmetics]);

  useEffect(() => {
    if (awaitingPurchases.key) saveAwaitingProducts(awaitingPurchases.key, awaitingPurchases.products);
  }, [awaitingPurchases]);

  useEffect(() => {
    if (!navigationToTop.current) return;
    navigationToTop.current = false;
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [tab]);

  function openSection(nextTab: Tab) {
    navigationToTop.current = true;
    setFocusedResearch(null);
    guideNavigationPending.current = null;
    productionNavigationPending.current = false;
    setPlacementType(null);
    setMoveBuildingId(null);
    setDecorPlacementType(null);
    setConstructionFeedback(null);
    setTab(nextTab);
    if (nextTab === tab) { navigationToTop.current = false; window.scrollTo({ top: 0, behavior: 'auto' }); }
  }

  useEffect(() => {
    if (tab === 'city' && (placementType || decorPlacementType || moveBuildingId)) {
      cityMapRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [tab, placementType, decorPlacementType, moveBuildingId]);

  useEffect(() => {
    if (constructionFeedback?.error) {
      const feedback = constructionFeedback.target === 'map' ? mapFeedbackRef.current : constructionFeedbackRef.current;
      feedback?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [tab, constructionFeedback]);

  useEffect(() => {
    if (tab === 'city' && productionNavigationPending.current) {
      productionNavigationPending.current = false;
      productionPanelRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [tab, requestedProductionRecipe]);

  useEffect(() => {
    const target = guideNavigationPending.current;
    const refs = { map: cityMapRef, production: productionPanelRef, contracts: contractsRef, hq: hqUpgradeRef, research: researchPanelRef, build: buildingCatalogRef };
    const element = target ? refs[target].current : null;
    if (element) {
      guideNavigationPending.current = null;
      element.setAttribute('tabindex', '-1');
      element.focus({ preventScroll: true });
      element.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  }, [tab, guideNavigationVersion]);

  function navigateGuide(action: string) {
    setHelpOpen(false);
    setConstructionFeedback(null);
    setMessage('');
    setPlacementType(null);
    setMoveBuildingId(null);
    setDecorPlacementType(null);
    setSelectedDecorId(null);
    productionNavigationPending.current = false;
    guideNavigationPending.current = null;
    if (action === 'build_foundry') return beginPlacement('foundry', 'Литейный цех');
    if (action === 'build_trade_hub') return beginPlacement('trade_hub', 'Торговый узел');
    if (action === 'build_lab') return beginPlacement('research_lab', 'Исследовательский центр');
    if (action === 'production') {
      const foundry = (game?.buildings ?? []).find((building: any) => building.type === 'foundry' && building.status === 'active');
      if (foundry) setSelectedBuildingId(foundry.id);
      if (game?.tutorial?.current?.key === 'first_smelt') setRequestedProductionRecipe('standard_alloy');
      setTab('city'); guideNavigationPending.current = 'production';
    } else if (action === 'contracts') {
      setTab('city'); guideNavigationPending.current = 'contracts';
    } else if (action === 'upgrade_hq') {
      const center = (game?.buildings ?? []).find((building: any) => building.type === 'hq');
      if (center) setSelectedBuildingId(center.id);
      setTab('city'); guideNavigationPending.current = 'map';
    } else if (action === 'upgrade_lab') {
      const labs = (game?.buildings ?? []).filter((building: any) => building.type === 'research_lab');
      const lab = labs.filter((building: any) => building.status === 'active').sort((a: any, b: any) => Number(b.level) - Number(a.level))[0]
        ?? labs.sort((a: any, b: any) => Number(b.level) - Number(a.level))[0];
      if (lab) setSelectedBuildingId(lab.id);
      setTab('city'); guideNavigationPending.current = 'map';
    } else if (action.startsWith('research:')) {
      const key = action.slice('research:'.length);
      if (game?.research?.catalog?.some((item: any) => item.key === key)) {
        setFocusedResearch(key);
        setResearchFocusVersion(version => version + 1);
      }
      setTab('build');
    } else if (action === 'research') {
      setFocusedResearch(null);
      setTab('build'); guideNavigationPending.current = 'research';
    } else if (action === 'build') {
      setTab('build'); guideNavigationPending.current = 'build';
    } else if (action === 'market') {
      setTab('market'); window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      const target = game?.tutorial?.current?.targetBuilding;
      const building = (game?.buildings ?? []).find((item: any) => item.type === target && item.status !== 'active');
      if (building) setSelectedBuildingId(building.id);
      setTab('city'); guideNavigationPending.current = 'map';
    }
    setGuideNavigationVersion((version) => version + 1);
  }

  function constructionNotice(target: string) {
    if (constructionFeedback?.target !== target) return null;
    return <div ref={constructionFeedbackRef} className={`notice actionFeedback ${constructionFeedback.error ? 'error' : ''}`} role={constructionFeedback.error ? 'alert' : 'status'}>{constructionFeedback.text}</div>;
  }

  async function constructionAction(target: string, path: string, body: object, successText: string) {
    setConstructionFeedback(null);
    try {
      await api(path, body);
      setConstructionFeedback({ target, text: successText, error: false });
      return true;
    } catch (error) {
      if (!(error instanceof RequestCancelled)) {
        setMessage('');
        setConstructionFeedback({ target, text: error instanceof Error ? error.message : 'Не удалось выполнить действие.', error: true });
      }
      return false;
    }
  }

  async function viewCity(telegramId: number) {
    try {
      const data = await api('/api/social/city', { telegramId });
      setViewedCity(data.city);
      setTab('social');
    } catch {}
  }

  async function startProduction(body: { buildingId: string; recipe: FoundryRecipeKey; mode: FoundryMode; link: FoundryLink; cycles: number }) {
    const key = JSON.stringify(body);
    if (pendingProduction.current?.key !== key) {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      pendingProduction.current = { key, requestId: `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}` };
    }
    const succeeded = await constructionAction(`production:${body.buildingId}`, '/api/game/foundry/start',
      { ...body, requestId: pendingProduction.current.requestId }, 'Партия принята. Цех выполнит циклы по порядку, даже когда игра закрыта.');
    if (succeeded) pendingProduction.current = null;
    return succeeded;
  }

  useEffect(() => {
    if (!game || phase !== 'ready') return;
    setProfileName((value) => value || game.profile?.colony_name || `Колония ${game.telegramUser?.first_name ?? ''}`.trim());
    setProfileBio((value) => value || game.profile?.profile_bio || '');
    if (handledStart.current || game.limited) return;
    handledStart.current = true;
    void (async () => {
      const start = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
      if (start && /^city_[1-9]\d*$/.test(start)) {
        const id = Number(start.slice(5));
        if (Number.isSafeInteger(id)) await viewCity(id);
      }
      if (start && /^ally_[a-zA-Z0-9_-]{1,64}$/.test(start)) {
        setAllianceCode(start.slice(5).toUpperCase());
        setTab('social');
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, phase]);

  useEffect(() => {
    const app = window.Telegram?.WebApp;
    if (phase !== 'ready' || !supportsTelegram(app, '6.1') || !app?.BackButton) return;
    const back = () => {
      const dialog = document.querySelector<HTMLDialogElement>('dialog[open]');
      if (dialog) { dialog.dispatchEvent(new Event('cancel', { cancelable: true })); return; }
      if (helpOpen) { setHelpOpen(false); return; }
      if (placementType || decorPlacementType || moveBuildingId) { cancelMapAction(); return; }
      if (selectedBuildingId || selectedDecorId) { setSelectedBuildingId(null); setSelectedDecorId(null); return; }
      if (viewedCity) { setViewedCity(null); return; }
      setTab('city');
    };
    const visible = !!game && !game.limited && !!game.profile?.profile_completed_at && (helpOpen || tab !== 'city' || !!viewedCity || !!placementType || !!decorPlacementType || !!moveBuildingId || !!selectedBuildingId || !!selectedDecorId);
    app.BackButton.onClick(back);
    if (visible) app.BackButton.show(); else app.BackButton.hide();
    return () => { app.BackButton?.offClick(back); app.BackButton?.hide(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, tab, helpOpen, viewedCity, placementType, decorPlacementType, moveBuildingId, selectedBuildingId, selectedDecorId, game?.limited, game?.profile?.profile_completed_at]);

  useEffect(() => {
    if (phase !== 'ready') return;
    const report = (message: string, stack?: string) => {
      if (!navigator.onLine) return;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      try {
        void fetch('/api/client/error', { method:'POST', headers:telegramHeaders(window.Telegram?.WebApp?.initData ?? '', process.env.NODE_ENV === 'development'), body:JSON.stringify({ message, stack, path:window.location.pathname }), signal:controller.signal }).catch(()=>{}).finally(() => clearTimeout(timeout));
      } catch { clearTimeout(timeout); }
    };
    const onError = (event: ErrorEvent) => report(event.message || 'window.error', event.error?.stack);
    const onRejection = (event: PromiseRejectionEvent) => report(`unhandledrejection: ${String(event.reason?.message ?? event.reason)}`, event.reason?.stack);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); };
  }, [phase]);

  const available = useMemo(
    () => (game?.catalog ?? []).filter((x: any) => x.type !== 'hq' && x.unlockHq <= Number(game?.state?.hq_level ?? 1)),
    [game],
  );

  const achievementRows = useMemo(() => {
    const unlocked = new Map((game?.achievements ?? []).map((x: any) => [x.achievement_key, x]));
    return (game?.achievementCatalog ?? []).map((a: any) => ({ ...a, status: unlocked.get(a.key), progress: Number(game?.stats?.[a.stat] ?? 0) }));
  }, [game]);

  const selectedBuilding = useMemo(
    () => (game?.buildings ?? []).find((b: any) => b.id === selectedBuildingId) ?? null,
    [game, selectedBuildingId],
  );

  const selectedDecor = useMemo(
    () => (game?.decor ?? []).find((d: any) => d.id === selectedDecorId) ?? null,
    [game, selectedDecorId],
  );

  const equippedTheme = (game?.cosmetics ?? []).find((c: any) => c.equipped && c.category === 'theme')?.cosmetic_id ?? '';
  const equippedWeather = (game?.cosmetics ?? []).find((c: any) => c.equipped && c.category === 'weather')?.cosmetic_id ?? '';
  const equippedBuildingSkin = (game?.cosmetics ?? []).find((c: any) => c.equipped && c.category === 'building_skin')?.cosmetic_id ?? '';
  const equippedFrame = (game?.cosmetics ?? []).find((c: any) => c.equipped && c.category === 'frame')?.cosmetic_id ?? '';
  const equippedEffect = (game?.cosmetics ?? []).find((c: any) => c.equipped && c.category === 'effect')?.cosmetic_id ?? '';
  const equippedBadge = (game?.cosmetics ?? []).find((c: any) => c.equipped && c.category === 'badge')?.cosmetic_id ?? '';

  async function toggleNotifications(enable: boolean) {
    if (enable && game?.flags?.notifications === false) { setMessage('Уведомления временно отключены для закрытого теста'); return; }
    if (!enable) {
      try {
        const data = await api('/api/settings/notifications', { enabled: false });
        setGame((old:any)=>({ ...old, notifications: data.notifications }));
        setMessage('Уведомления выключены');
      } catch {}
      return;
    }
    const app = window.Telegram?.WebApp;
    if (!app?.requestWriteAccess || !supportsTelegram(app, '6.9')) {
      setMessage('Разрешение на сообщения доступно только внутри актуального Telegram');
      return;
    }
    if (requestingAccess.current) return;
    requestingAccess.current = true;
    const timeout = setTimeout(() => { requestingAccess.current = false; }, 30_000);
    try {
      app.requestWriteAccess(async (granted) => {
        clearTimeout(timeout);
        requestingAccess.current = false;
        if (!granted) { setMessage('Telegram не дал разрешение на сообщения'); return; }
        try {
          const data = await api('/api/settings/notifications', { enabled: true });
          setGame((old:any)=>({ ...old, notifications: data.notifications }));
          setMessage(data.notifications?.bot_write_allowed ? 'Уведомления включены' : 'Разрешение получено, подтверждение Telegram ожидается');
        } catch {}
      });
    } catch {
      clearTimeout(timeout);
      requestingAccess.current = false;
      setMessage('Не удалось запросить разрешение. Обновите Telegram и попробуйте снова.');
    }
  }

  async function loadAdminDashboard() {
    try {
      const data = await api('/api/admin/dashboard');
      setAdminDashboard(data);
      setMessage('Метрики обновлены');
    } catch {}
  }

  async function redeemBetaAccess() {
    try {
      await api('/api/beta/redeem',{code:betaCode});
      setMessage('Доступ к бете активирован');
      await refresh();
    } catch {}
  }

  async function sendFeedback() {
    try {
      await api('/api/feedback',{category:feedbackCategory,message:feedbackMessage,context:{tab,version:game?.version}});
      setFeedbackMessage('');
      setMessage('Спасибо — сообщение сохранено');
    } catch {}
  }

  async function buyStars(productId: string) {
    if (game?.flags?.stars_shop === false) throw new Error('Покупки за Stars временно недоступны.');
    if (invoiceOpening.current) throw new Error('Сначала заверши или закрой открытый счёт Telegram.');
    if (awaitingProducts.includes(productId)) throw new Error('Ожидаем подтверждения предыдущей оплаты. Проверь покупку перед повтором.');
    const app = window.Telegram?.WebApp;
    if (!supportsTelegram(app, '6.1') || !app?.openInvoice) throw new Error('Покупки доступны внутри актуального Telegram.');
    invoiceOpening.current = true;
    setInvoiceOpen(true);
    try {
      const data = await api('/api/payments/invoice', { productId });
      const invoice = new URL(data.invoiceLink);
      if (invoice.protocol !== 'https:' || invoice.hostname !== 't.me') throw new Error('Не удалось открыть счёт Telegram. Попробуйте позже.');
      await new Promise<void>((resolve, reject) => {
        app.openInvoice!(invoice.href, (status) => {
          const product = PRODUCTS[productId as keyof typeof PRODUCTS];
          if ((status === 'paid' || status === 'pending') && product?.kind !== 'premium' && purchaseStorageKey) {
            const products = [...new Set([...awaitingProducts, productId])];
            saveAwaitingProducts(purchaseStorageKey, products);
            setAwaitingPurchases({ key: purchaseStorageKey, products });
          }
          invoiceOpening.current = false;
          setInvoiceOpen(false);
          void refresh(true);
          if (status === 'failed') reject(new Error('Платёж не завершён. Проверь покупки перед повтором.'));
          else if (status === 'cancelled') reject(new Error('Покупка отменена.'));
          else resolve();
        });
      });
    } catch (error) {
      invoiceOpening.current = false;
      setInvoiceOpen(false);
      setMessage('');
      throw error;
    }
  }

  async function shareLink(start: string | undefined, text: string) {
    const link = start ? botAppLink(process.env.NEXT_PUBLIC_BOT_USERNAME, start) : null;
    if (!link) { setMessage('Ссылка приглашения пока недоступна. Попробуйте позже.'); return; }
    setShareFallbackLink('');
    const result = await shareTelegramLink(link, text, window.Telegram?.WebApp, navigator);
    if (result === 'copied') setMessage('Ссылка скопирована');
    if (result === 'manual') { setShareFallbackLink(link); setMessage('Не удалось скопировать автоматически. Нажмите на поле со ссылкой и скопируйте её.'); }
  }

  function shareCity() {
    void shareLink(playerStartParam('city', game?.telegramUser?.id), 'Посмотри мою колонию в COLONY');
  }

  function shareReferral() {
    void shareLink(playerStartParam('ref', game?.telegramUser?.id), 'Я строю колонию в COLONY. Забирай свою');
  }

  function shareAlliance() {
    const code = game?.alliance?.alliance?.code;
    void shareLink(typeof code === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(code) ? `ally_${code}` : undefined, `Вступай в наш альянс «${game?.alliance?.alliance?.name}» в COLONY`);
  }

  async function handleCityCell(x: number, y: number, building?: any, decor?: any) {
    if (busy) return;
    if (building) {
      setSelectedBuildingId(building.id);
      setSelectedDecorId(null);
      setConstructionFeedback(placementType || decorPlacementType || moveBuildingId ? { target: 'map', text: 'Клетка занята. Выбери свободную.', error: true } : null);
      return;
    }
    if (decor) {
      setSelectedDecorId(decor.id);
      setSelectedBuildingId(null);
      setConstructionFeedback(placementType || decorPlacementType || moveBuildingId ? { target: 'map', text: 'Клетка занята декором. Выбери свободную.', error: true } : null);
      return;
    }
    if (decorPlacementType) {
      const type = decorPlacementType;
      if (await constructionAction('map', '/api/game/decor/place', { type, x, y }, 'Декор размещён')) {
        setDecorPlacementType(null);
      }
      return;
    }
    if (placementType) {
      const type = placementType;
      if (await constructionAction('map', '/api/game/build', { type, x, y }, 'Строительство начато')) {
        setPlacementType(null);
      }
      return;
    }
    if (moveBuildingId) {
      const buildingId = moveBuildingId;
      if (await constructionAction('map', '/api/game/building/move', { buildingId, x, y }, 'Здание перемещено')) {
        setMoveBuildingId(null);
        setSelectedBuildingId(buildingId);
      }
    }
  }

  function beginPlacement(type: string, name: string) {
    setPlacementType(type);
    setMoveBuildingId(null);
    setDecorPlacementType(null);
    setSelectedBuildingId(null);
    setSelectedDecorId(null);
    setTab('city');
    setMessage('');
    setConstructionFeedback({ target: 'map', text: `Выбери свободную клетку для «${name}»`, error: false });
  }

  function beginMove(building: any) {
    setMoveBuildingId(building.id);
    setPlacementType(null);
    setDecorPlacementType(null);
    setSelectedDecorId(null);
    setMessage('');
    setConstructionFeedback({ target: 'map', text: 'Выбери новую свободную клетку', error: false });
  }

  function beginDecorPlacement(type: string, name: string) {
    setDecorPlacementType(type);
    setPlacementType(null);
    setMoveBuildingId(null);
    setSelectedBuildingId(null);
    setSelectedDecorId(null);
    setTab('city');
    setMessage('');
    setConstructionFeedback({ target: 'map', text: `Выбери свободную клетку для «${name}»`, error: false });
  }

  function cancelMapAction() {
    setPlacementType(null);
    setDecorPlacementType(null);
    setMoveBuildingId(null);
    setMessage('');
    setConstructionFeedback(null);
  }

  if (phase !== 'ready') {
    return <main className="app colonyApp accessGate"><section className="card accessCard launchCard">
      <img className="launchArtwork" src="/art/colony-arrival.webp" alt="Колония на далёкой планете" width={1672} height={941} />
      <div className="betaMark">COLONY · v{APP_VERSION}</div>
      <h1>{phase === 'loading' ? 'Подключаем Telegram…' : phase === 'outside' ? 'Ваша колония в Telegram' : 'Не удалось подключить Telegram'}</h1>
      <p>{phase === 'loading' ? 'Проверяем запуск приложения. Это займёт несколько секунд.' : phase === 'outside' ? 'Построй производственный город: добывай ресурсы, выпускай детали, торгуй и открывай технологии. Войди через приложение в Telegram, чтобы сохранить свою колонию.' : 'Проверьте подключение к интернету и попробуйте снова. Если эта страница открыта в браузере, перейдите в бота.'}</p>
      {phase !== 'loading' && <>{botLink ? <a className="action launchLink" href={botLink}>Открыть COLONY в Telegram</a> : <p>Откройте приложение через бота, который прислал вам приглашение.</p>}<button className="action secondary" onClick={retry}>Попробовать снова</button></>}
    </section></main>;
  }

  if (!game) {
    const error = message || connectionError;
    return <main className="app accessGate"><section className="card accessCard launchCard"><div className="betaMark">COLONY · v{APP_VERSION}</div><h1>{error ? 'Колония пока недоступна' : 'Загружаем вашу колонию…'}</h1>{error && <><div className="notice error" role="alert">{error}</div><button className="action" disabled={busy} onClick={() => refresh()}>Попробовать снова</button>{botLink && <a className="action secondary launchLink" href={botLink}>Открыть из бота</a>}</>}</section></main>;
  }

  if (game.limited) {
    const maintenance=game.access?.blockReason==='maintenance';
    return <main className="app accessGate"><section className="card accessCard">
      <div className="betaMark">COLONY · v{APP_VERSION}</div>
      <h1>{maintenance?'🛠 Техническое обслуживание':'🔐 Закрытая бета'}</h1>
      <p>{maintenance?(game.access?.maintenance?.message??'Мы временно закрыли игру на обслуживание. Прогресс сохранён.'):'Для этого этапа нужен beta-код. После одной успешной активации доступ сохраняется за вашим Telegram-аккаунтом.'}</p>
      {!maintenance&&<><input className="gateInput" value={betaCode} maxLength={64} onChange={e=>setBetaCode(e.target.value.toUpperCase())} placeholder="Введите beta-код"/><button className="action" disabled={busy||betaCode.trim().length<4} onClick={redeemBetaAccess}>Активировать доступ</button></>}
      {maintenance&&<button className="action secondary" disabled={busy} onClick={()=>refresh()}>Проверить снова</button>}
      {message&&<div className="notice error">{message}</div>}
      {connectionError && connectionError !== message && <div className="notice error" role="status">{connectionError}</div>}
      <small>Telegram ID: {game.telegramUser?.id} · версия {game.version}</small>
    </section></main>;
  }

  const s = game.state;
  const qualified = (game.referrals ?? []).filter((r: any) => !!r.referral_qualified_at).length;
  const hq = (game.buildings ?? []).find((b: any) => b.type === 'hq');
  const usedCells = (game.buildings ?? []).length + (game.decor ?? []).length;
  const totalCells = Number(game.gridSize ?? 6) ** 2;

  return (
    <main className="app colonyApp">
      {!game.profile?.profile_completed_at && <ColonyWelcome colonyName={profileName} onNameChange={setProfileName} bio={profileBio} onBioChange={setProfileBio} busy={busy} onSubmit={async () => {
        try { await api('/api/profile/update', { colonyName: profileName, bio: profileBio }); }
        catch (error) { setMessage(''); throw error; }
      }} />}
      <MechanicsHelp open={helpOpen} onClose={() => setHelpOpen(false)} onNavigate={navigateGuide} />
      <div className={`header ${tab === 'city' ? 'cityHeader' : 'sectionHeader'}`}>
        <div className="brandGroup"><div className="brandMark" aria-hidden="true">{tab === 'city' ? <BuildingArt type="hq" /> : <GameIcon name={tab === 'build' ? 'research' : tab === 'missions' ? 'missions' : tab === 'social' ? 'social' : tab} size={26} />}</div><div><span className="brandKicker">{tab === 'city' ? 'ПОСТРОЙ СВОЮ КОЛОНИЮ' : 'COLONY'}</span><h1 className="brand">{SECTION_TITLES[tab].title}</h1><div className="level">{SECTION_TITLES[tab].hint}</div></div></div>
        <button type="button" className="headerHelp" aria-label="Открыть справочник игры" onClick={() => setHelpOpen(true)}><GameIcon name="help" size={23} /></button>
      </div>

      {tab === 'city' && <ResourceBar state={s} caps={game.caps} escrow={game.escrow} scienceRate={Number(game.scienceRate ?? 0)} onHelp={() => setHelpOpen(true)} />}
      {(tab === 'build' || tab === 'market') && <div className="sectionResources" aria-label="Ресурсы для этого раздела"><span>В наличии</span>{(tab === 'build' ? ['ore', 'energy', 'parts', 'credits', 'science'] : ['ore', 'energy', 'parts', 'credits']).map(resource => <GameAmount key={resource} resource={resource}>{n(s[resource])}</GameAmount>)}</div>}

      {tab === 'city' && game.flags?.closed_beta_banner && <details className="betaBanner compactBeta"><summary><GameIcon name="research" size={14} />Тестовая версия · {APP_VERSION}</summary><span>Баланс и механики ещё меняются. Прогресс тестовой версии может корректироваться перед публичным запуском.</span></details>}

      {connectionError && <div className="notice error connectionNotice" role="status"><span>{connectionError}</span><button className="miniButton" disabled={busy} onClick={() => refresh()}>Обновить</button>{botLink && connectionError.includes('Сессия Telegram') && <a href={botLink}>Открыть из бота</a>}</div>}
      {shareFallbackLink && <label className="shareFallback">Ссылка приглашения<input readOnly value={shareFallbackLink} onFocus={event => event.target.select()} /></label>}

      {message && <div role="status" className={`notice ${message.toLowerCase().includes('ошиб') || message.toLowerCase().includes('не хватает') || message.toLowerCase().includes('занята') ? 'error' : ''}`}>{message}</div>}

      {tab === 'city' && <ColonyGuide tutorial={game.tutorial} buildings={game.buildings ?? []} research={game.research} plannedResearchKey={plannedResearchKey} busy={busy}
        onAction={navigateGuide} onHelp={() => setHelpOpen(true)} onRefresh={() => { void refresh(); }}
        onClaim={async () => { try { await api('/api/game/tutorial/claim'); } catch (error) { setMessage(''); throw error; } }} />}

      {tab === 'city' && <>
        <section className="card cityCard" ref={cityMapRef}>
          <div className="cardTitleRow"><div><h2>Твой город</h2><p>Центр ур. {s.hq_level} · {game.gridSize}×{game.gridSize} · занято {usedCells} из {totalCells} клеток. Нажми на здание, чтобы узнать его пользу и улучшить.</p></div><button className="miniButton" onClick={shareCity}><GameIcon name="share" size={15} /> Поделиться</button></div>
          {(placementType || decorPlacementType || moveBuildingId) && <div className="mapModeBar">
            <span><GameIcon name={placementType ? 'build' : decorPlacementType ? 'tree' : 'move'} size={17} /> {placementType ? 'Размещение здания' : decorPlacementType ? 'Размещение декора' : 'Перемещение здания'}</span>
            <button className="miniButton" onClick={cancelMapAction}>Отмена</button>
          </div>}
          {placementType && (() => { const item = game.catalog?.find((entry: any) => entry.type === placementType); return item && <div className="placementPreview"><BuildingArt type={placementType} /><div><strong>{item.name}</strong>{costDisplay(item.baseBuildCost)}<small>Нажми на свободную клетку. Ресурсы спишутся при выборе места.</small></div></div>; })()}
          <CityGrid
            buildings={game.buildings ?? []}
            decor={game.decor ?? []}
            catalog={game.catalog ?? []}
            decorCatalog={game.decorCatalog ?? []}
            gridSize={Number(game.gridSize ?? 6)}
            selectedId={selectedBuildingId}
            selectedDecorId={selectedDecorId}
            placementMode={!!placementType}
            decorPlacementMode={!!decorPlacementType}
            moveMode={!!moveBuildingId}
            planningType={placementType ?? (game.buildings ?? []).find((building: any) => building.id === moveBuildingId)?.type}
            movingBuildingId={moveBuildingId ?? undefined}
            theme={equippedTheme}
            weather={equippedWeather}
            buildingSkin={equippedBuildingSkin}
            frame={equippedFrame}
            effect={equippedEffect}
            badge={equippedBadge}
            onCell={handleCityCell}
          />
          <div className="mapFeedback" ref={mapFeedbackRef}>
            {constructionNotice('map')}
            {placementType && <ResourceShortage cost={game.catalog?.find((item: any) => item.type === placementType)?.baseBuildCost} resources={s} />}
          </div>
        </section>

        {selectedBuilding && <section className="card buildingInspector">
          {(() => {
            const cfg = game.catalog.find((x: any) => x.type === selectedBuilding.type);
            return <>
              <div className="inspectorHead"><div className="inspectorEmoji"><BuildingArt type={selectedBuilding.type} /></div><div><h2>{cfg?.name ?? selectedBuilding.type}</h2><p>Уровень {selectedBuilding.level} · клетка {Number(selectedBuilding.x) + 1}:{Number(selectedBuilding.y) + 1}</p></div></div>
              {cfg?.description && <p className="buildingPurpose">{cfg.description}</p>}
              <div className="inspectorStats">
                <div><span>Статус</span><b>{selectedBuilding.status === 'active' ? 'Работает' : `${selectedBuilding.status === 'upgrading' ? 'Улучшается' : 'Строится'} → ур. ${selectedBuilding.target_level}`}</b></div>
                <div><span>Производство</span><b>{productionText(selectedBuilding.production, selectedBuilding.type)}</b></div>
              </div>
              <ConstructionStatus building={selectedBuilding} busy={busy} onRefresh={() => { void refresh(); }} />
              {selectedBuilding.nextUpgrade && <div className="upgradeBox"><span>Следующий уровень: {selectedBuilding.nextUpgrade.level}</span><b>{costDisplay(selectedBuilding.nextUpgrade.cost)}</b></div>}
              <div className="grid2">
                <button className="action" disabled={busy || selectedBuilding.status !== 'active' || !selectedBuilding.nextUpgrade} onClick={() => constructionAction(`upgrade:${selectedBuilding.id}`, '/api/game/building/upgrade', { buildingId: selectedBuilding.id }, 'Улучшение запущено')}><GameIcon name="upgrade" size={17} /> Улучшить</button>
                <button className="action secondary" disabled={busy || selectedBuilding.status !== 'active'} onClick={() => beginMove(selectedBuilding)}><GameIcon name="move" size={17} /> Переместить</button>
              </div>
              {selectedBuilding.status === 'active' && <ResourceShortage cost={selectedBuilding.nextUpgrade?.cost} resources={s} />}
              {constructionNotice(`upgrade:${selectedBuilding.id}`)}
            </>;
          })()}
        </section>}

        {selectedDecor && <section className="card buildingInspector">
          {(() => { const cfg=(game.decorCatalog??[]).find((x:any)=>x.type===selectedDecor.type); return <>
            <div className="inspectorHead"><div className="inspectorEmoji"><BuildingArt type={selectedDecor.type} /></div><div><h2>{cfg?.name ?? selectedDecor.type}</h2><p>Декор · клетка {Number(selectedDecor.x)+1}:{Number(selectedDecor.y)+1}</p></div></div>
            <p className="finePrint">Декор не даёт City Score и не влияет на производство. При демонтаже возвращается 50% кредитной стоимости.</p>
            <button className="action secondary" disabled={busy} onClick={()=>api('/api/game/decor/remove',{decorId:selectedDecor.id}).then((d:any)=>{setSelectedDecorId(null);setMessage(`Декор демонтирован · возврат 💰${n(d.result?.refund)}`)}).catch(()=>{})}>Убрать декор</button>
          </>})()}
        </section>}

        <div ref={productionPanelRef}><ProductionPanel
          buildings={game.buildings ?? []}
          jobs={game.activeJobs ?? []}
          resources={s}
          partsCapacity={Math.max(0, Number(game.caps?.parts ?? 800) - Number(game.escrow?.parts ?? 0))}
          partsMultiplier={Number(game.production?.partsMultiplier ?? 1)}
          unlockedRecipes={game.production?.unlockedRecipes ?? ['standard_alloy']}
          recipesEnabled={game.production?.recipesEnabled}
          selectedRecipe={requestedProductionRecipe}
          busy={busy}
          selectedBuildingId={selectedBuildingId}
          onFoundryChange={setSelectedBuildingId}
          onChangeSelection={() => setConstructionFeedback(null)}
          onStart={startProduction}
          onResearch={(key) => navigateGuide(`research:${key}`)}
          onRefresh={() => { void refresh(); }}
          onBuild={() => beginPlacement('foundry', 'Литейный цех')}
          onSelectBuilding={(id) => { setSelectedBuildingId(id); setSelectedDecorId(null); setConstructionFeedback(null); cityMapRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }}
          feedback={constructionFeedback?.target.startsWith('production:') ? constructionNotice(constructionFeedback.target) : undefined}
        /></div>

        <section className="card"><h2><GameIcon name="tree" />Дороги и декор</h2><p>Оформляй город за игровые кредиты. Декор не меняет производство и рейтинг.</p><div className="decorCatalog">{(game.decorCatalog??[]).filter((d:any)=>Number(s.hq_level)>=Number(d.unlockHq)).map((d:any)=><button className="decorPick" key={d.type} disabled={busy} onClick={()=>beginDecorPlacement(d.type,d.name)}><span><GameIcon name={d.type} size={28} /></span><b>{d.name}</b><small><GameAmount resource="credits">{n(d.credits)}</GameAmount></small></button>)}</div></section>

        <section className="card" ref={contractsRef}>
          <h2><GameIcon name="market" />Контракты колонии</h2><p>Передай ресурсы заказчику и получи кредиты на новые постройки. Выполнение расходует указанные ресурсы.</p>
          {(game.contracts?.length ?? 0) === 0 ? <p>Построй торговый узел — здесь появятся первые контракты. Они создают кредиты, но сжигают реальные ресурсы.</p> : <div className="stack">
            {game.contracts.map((c: any) => <div className="rowCard" key={c.id}>
              <div><strong><GameIcon name={c.resource} size={17} /> {c.resource === 'ore' ? 'Поставка руды' : 'Поставка деталей'}</strong><small>{n(c.amount)} → <GameAmount resource="credits">{n(c.credit_reward)}</GameAmount></small></div>
              <button className="miniButton" disabled={busy} onClick={() => api('/api/game/contracts/complete', { contractId: c.id }).then(() => setMessage('Контракт выполнен')).catch(()=>{})}>Выполнить</button>
            </div>)}
          </div>}
        </section>
        <section className="card dailyLoginCard"><div className="cardTitleRow"><div><h2><GameIcon name="star" />Серия входов · {n(game.dailyLogin?.streak?.current_streak ?? 1)} дн.</h2><p>Небольшая ежедневная награда за возвращение. На 7-й день цикл наград начинается заново, а сама серия продолжается.</p></div><span className="pill">рекорд {n(game.dailyLogin?.streak?.longest_streak ?? 1)}</span></div>
          {game.dailyLogin?.today && <div className="dailyReward"><span>День {game.dailyLogin.today.cycle_day}/7</span><b>💰 {n(game.dailyLogin.today.credit_reward)}{Number(game.dailyLogin.today.crystal_reward)>0?` · 💎 ${n(game.dailyLogin.today.crystal_reward)}`:''}</b><button className="miniButton" disabled={busy||!!game.dailyLogin.today.claimed_at} onClick={()=>api('/api/game/daily-login/claim').then(()=>setMessage('Ежедневная награда получена')).catch(()=>{})}>{game.dailyLogin.today.claimed_at?'Получено':'Забрать'}</button></div>}
        </section>
        <section className="card notificationCard">
          <div className="cardTitleRow"><div><h2><GameIcon name="info" />Уведомления Telegram</h2><p>Только готовность стройки, исследований и экспедиций. Без рекламных сообщений.</p></div><span className="pill">{game.notifications?.enabled ? game.notifications?.bot_write_allowed ? 'Включены' : 'Ожидают Telegram' : 'Выключены'}</span></div>
          <button className={`action ${game.notifications?.enabled?'secondary':''}`} disabled={busy} onClick={()=>toggleNotifications(!game.notifications?.enabled)}>{game.notifications?.enabled?'Выключить':'Разрешить уведомления'}</button>
        </section>
        <section className="card inboxCard"><div className="cardTitleRow"><div><h2><GameIcon name="social" />Входящие</h2><p>Системные сообщения колонии и важные результаты событий.</p></div><span className="pill">{n(game.inbox?.unread ?? 0)} новых</span></div>
          <div className="stack">{(game.inbox?.items??[]).slice(0,5).map((item:any)=><button className={`inboxItem ${item.read_at?'':'unread'}`} key={item.id} onClick={()=>!item.read_at&&api('/api/inbox/read',{id:item.id}).catch(()=>{})}><div><strong>{item.title}</strong><small>{item.body}</small></div><span>{item.read_at?'':'●'}</span></button>)}</div>
          {(game.inbox?.unread??0)>0&&<button className="miniButton inboxReadAll" disabled={busy} onClick={()=>api('/api/inbox/read',{all:true}).then(()=>setMessage('Все сообщения отмечены прочитанными')).catch(()=>{})}>Прочитать всё</button>}
        </section>
      </>}

      {tab === 'build' && <>
        <nav className="developmentNavigation" aria-label="Разделы развития"><a href="#colony-research"><GameIcon name="research" size={17} /> Исследования и чертежи</a><a href="#colony-buildings"><GameIcon name="build" size={17} /> Постройки</a></nav>
        {game.research && <div id="colony-research" ref={researchPanelRef}><ResearchPanel
          research={game.research}
          resources={s}
          hqLevel={Number(s.hq_level)}
          scienceRate={Number(game.scienceRate ?? 0)}
          offlineCapHours={Number(game.offlineCapHours ?? 8)}
          busy={busy}
          focusResearchKey={focusedResearch}
          focusResearchVersion={researchFocusVersion}
          plannedResearchKey={plannedResearchKey}
          onPlanChange={chooseResearchTarget}
          onInspectResearch={(key) => navigateGuide(`research:${key}`)}
          onUpgradeHq={() => navigateGuide('upgrade_hq')}
          onUpgradeLab={() => navigateGuide('upgrade_lab')}
          onShowProduction={() => navigateGuide('production')}
          onProduction={(recipe) => { setConstructionFeedback(null); productionNavigationPending.current = true; setRequestedProductionRecipe(recipe); setTab('city'); }}
          onStart={async (researchKey) => {
            try { await api('/api/game/research/start', { researchKey }); }
            catch (error) { setMessage(''); throw error; }
          }}
          onBuildLab={() => beginPlacement('research_lab', 'Исследовательский центр')}
          onBuild={beginPlacement}
          onRefresh={() => { void refresh(); }}
        /></div>}
        <section className="card" id="colony-buildings" ref={buildingCatalogRef}>
          <h2><GameIcon name="build" />Строительство</h2><p>Выбери здание и место на карте. У каждой постройки есть своя роль: добыча, производство или новые возможности. Можно вести 2 стройки одновременно, с Premium — 3.</p>
          <div className="catalog">
            {available.map((item: any) => <div className="catalogItem" key={item.type}>
              <BuildingArt type={item.type} className="catalogArt" /><b>{item.name}</b>
              {item.description && <p>{item.description}</p>}
              <small>{costDisplay(item.baseBuildCost)}</small><small><GameIcon name="clock" size={13} /> {durationText(item.baseBuildTimeSec)}</small>
              <button className="action secondary" disabled={busy || item.unlockedByResearch === false} onClick={() => beginPlacement(item.type, item.name)}>{item.unlockedByResearch === false ? 'Нужна технология' : 'Выбрать место'}</button>
              {item.unlockedByResearch === false && <small className="buildingResearchRequirement">Изучи «{item.researchRequirementName ?? item.unlockResearch}» в исследованиях.</small>}
              {item.unlockedByResearch === false && item.unlockResearch && <button type="button" className="miniButton buildingResearchPlan" disabled={busy} onClick={() => chooseResearchTarget(item.unlockResearch)}><GameIcon name="research" size={14} />План открытия</button>}
              <ResourceShortage cost={item.baseBuildCost} resources={s} />
            </div>)}
          </div>
        </section>
        <section className="card" ref={hqUpgradeRef}>
          <h2><GameIcon name="upgrade" />Центр управления · уровень {hq?.level ?? s.hq_level}</h2><p>Уровень 2 открывает исследовательский центр. Уровень 3 даёт новые здания и карту 7×7, уровень 5 расширяет её до 8×8.</p>
          <div className="upgradeBox"><span>Следующее улучшение</span><b>{hq?.nextUpgrade ? costDisplay(hq.nextUpgrade.cost) : 'пока максимум'}</b></div>
          {hq && hq.status !== 'active' && <ConstructionStatus building={hq} busy={busy} onRefresh={() => { void refresh(); }} />}
          <button className="action" disabled={busy || !hq?.nextUpgrade || hq?.status !== 'active'} onClick={() => constructionAction('hq', '/api/game/building/upgrade', { buildingId: hq.id }, 'Улучшение центра управления запущено')}><GameIcon name="upgrade" size={18} /> Улучшить центр управления</button>
          {hq?.status === 'active' && <ResourceShortage cost={hq.nextUpgrade?.cost} resources={s} />}
          {constructionNotice('hq')}
        </section>

        <section className="card expeditionCard">{game.flags?.expeditions===false&&<div className="notice">🚧 Экспедиции временно отключены feature flag.</div>}
          <div className="cardTitleRow"><div><h2><GameIcon name="rocket" />Экспедиции</h2><p>Отправляй аппараты за ресурсами, научными данными и редкими артефактами.</p></div><span className="pill">{game.expeditions?.activeCount ?? 0}/{game.expeditions?.slots ?? 1}</span></div>
          {!game.expeditions?.enabled ? <><p>Центр экспедиций открывается с HQ3. Stars не покупают слоты и не повышают шанс находок.</p><button className="action secondary" disabled={Number(s.hq_level)<3} onClick={()=>beginPlacement('expedition_center','Центр экспедиций')}>Построить центр</button></> : <>
            {(game.expeditions?.runs??[]).length>0&&<div className="stack expeditionRuns">{game.expeditions.runs.map((run:any)=><div className={`expeditionRun ${run.status}`} key={run.id}><div className="expeditionRunHead"><div><strong>{run.config?.emoji} {run.config?.name ?? run.expedition_key}</strong><small>{run.status==='active'?`Вернётся через ${countdown(run.completes_at)}`:run.status==='event'?`${run.event?.emoji??'⚠️'} Требуется решение`:'Экспедиция вернулась'}</small></div><span className="statusBadge">{run.status==='active'?'В пути':run.status==='event'?'Событие':'Готово'}</span></div>{run.status==='ready'&&<button className="action" disabled={busy} onClick={()=>api('/api/game/expedition/resolve',{expeditionId:run.id}).then((d:any)=>setMessage(`Экспедиция завершена: 💰${n(d.result?.credits)} · 🧠${n(d.result?.science)}`)).catch(()=>{})}>Забрать результат</button>}{run.status==='event'&&run.event&&<div className="eventCard"><b>{run.event.emoji} {run.event.title}</b><p>{run.event.description}</p><div className="eventChoices">{run.event.choices.map((choice:any)=><button className="eventChoice" key={choice.id} disabled={busy} onClick={()=>api('/api/game/expedition/resolve',{expeditionId:run.id,choiceId:choice.id}).then(()=>setMessage(`Решение принято: ${choice.title}`)).catch(()=>{})}><strong>{choice.title}</strong><small>{choice.description}</small></button>)}</div></div>}</div>)}</div>}
            <div className="expeditionCatalog">{(game.expeditions?.catalog??[]).map((e:any)=><div className={`expeditionOption ${e.unlocked?'':'locked'}`} key={e.key}><div className="researchTop"><span>{e.emoji}</span><div><b>{e.name}</b><small>{durationText(e.durationSec)}</small></div></div><p>{e.description}</p><div className="researchMeta"><span>{costDisplay(e.cost)}</span><span>🎲 события {Math.round(Number(e.eventChance)*100)}%</span></div><button className="action secondary" disabled={busy||game.flags?.expeditions===false||!e.unlocked||Number(game.expeditions.activeCount)>=Number(game.expeditions.slots)} onClick={()=>api('/api/game/expedition/start',{expeditionKey:e.key}).then(()=>setMessage(`Экспедиция «${e.name}» отправлена`)).catch(()=>{})}>{e.unlocked?'Отправить':e.lockReason}</button></div>)}</div>
          </>}
        </section>

        <section className="card"><h2><GameIcon name="star" />Коллекция артефактов</h2><p>Артефакты находятся только в экспедициях. Собери все четыре вида — постоянная рамка первопроходца.</p><div className="artifactGrid">{(game.expeditions?.artifacts??[]).map((a:any)=><div className={`artifact ${Number(a.count)>0?'found':'unknown'}`} key={a.id}><span>{Number(a.count)>0?a.emoji:'❔'}</span><b>{Number(a.count)>0?a.name:'Неизвестный объект'}</b><small>{Number(a.count)>0?`${a.rarity} · ×${a.count}`:'ещё не найден'}</small></div>)}</div></section>
      </>}

      {tab === 'market' && <>
        <section className="card"><div className="cardTitleRow"><div><h2><GameIcon name="market" />Рынок игроков</h2><p>Игроки продают реальные игровые ресурсы за кредиты. Комиссия 5% с продавца сгорает.</p></div><span className="pill">{game.flags?.market===false?'Пауза':game.market?.enabled?'Открыто':'Нужен торговый узел'}</span></div>{game.flags?.market===false?<div className="notice">Функция временно отключена feature flag во время теста.</div>:!game.market?.enabled&&<button className="action secondary" onClick={()=>setTab('build')}>🏗️ Построить торговый узел</button>}</section>
        {game.market?.enabled&&<section className="card"><h2>Выставить ресурс</h2><p>Ресурс резервируется сразу; непроданный остаток возвращается при отмене или через 24 часа.</p><div className="marketForm"><label><span>Ресурс</span><select value={marketResource} onChange={e=>setMarketResource(e.target.value as any)}><option value="ore">⛏ Руда</option><option value="energy">⚡ Энергия</option><option value="parts">⚙️ Детали</option></select></label><label><span>Количество</span><input inputMode="numeric" value={marketAmount} onChange={e=>setMarketAmount(e.target.value.replace(/\D/g,''))}/></label><label><span>Цена / ед.</span><input inputMode="numeric" value={marketPrice} onChange={e=>setMarketPrice(e.target.value.replace(/\D/g,''))}/></label></div><div className="marketPreview"><span>Сумма</span><b>💰 {n(Number(marketAmount||0)*Number(marketPrice||0))}</b></div><button className="action" disabled={busy} onClick={()=>api('/api/market/order/create',{resource:marketResource,amount:Number(marketAmount),unitPrice:Number(marketPrice)}).then(()=>setMessage('Ордер выставлен')).catch(()=>{})}>Выставить ордер</button><p className="finePrint">Цена: {game.market?.rules?.[marketResource]?.minUnitPrice}–{game.market?.rules?.[marketResource]?.maxUnitPrice}; минимум {game.market?.rules?.[marketResource]?.minAmount} ед.</p></section>}
        <section className="card"><h2>Стакан продаж</h2>{!game.market?.enabled?<p>Рынок откроется после торгового узла.</p>:(game.market?.orders?.length??0)===0?<p>Пока ордеров нет.</p>:<div className="stack">{game.market.orders.map((o:any)=>{const mine=o.user_id===game.userId;const av=buyAmounts[o.id]??String(Math.min(Number(o.amount_remaining),o.resource==='parts'?10:50));const amount=Math.max(0,Math.min(Number(o.amount_remaining),Number(av||0)));return <div className="marketOrder" key={o.id}><div className="marketOrderTop"><div><strong>{marketResourceLabel(o.resource)}</strong><small>{o.first_name||o.username||'Колонист'} · {n(o.amount_remaining)} · 💰{n(o.unit_price)}/ед.</small></div></div>{mine?<button className="miniButton" disabled={busy} onClick={()=>api('/api/market/order/cancel',{orderId:o.id}).then(()=>setMessage('Ордер отменён')).catch(()=>{})}>Отменить</button>:<div className="marketBuy"><input inputMode="numeric" value={av} onChange={e=>setBuyAmounts(v=>({...v,[o.id]:e.target.value.replace(/\D/g,'')}))}/><span>= 💰 {n(amount*Number(o.unit_price))}</span><button className="miniButton" disabled={busy||amount<=0} onClick={()=>api('/api/market/order/buy',{orderId:o.id,amount}).then(()=>setMessage('Покупка выполнена')).catch(()=>{})}>Купить</button></div>}</div>})}</div>}</section>
        {(game.market?.stats?.length??0)>0&&<section className="card"><h2>Рынок за 24 часа</h2><div className="marketStats">{game.market.stats.map((x:any)=><div key={x.resource}><span>{marketResourceLabel(x.resource)}</span><b>≈ 💰{n(x.median_price??x.avg_price)}</b><small>{n(x.volume)} ед. · {x.trades} сделок</small></div>)}</div></section>}
      </>}

      {tab === 'missions' && <>
        {game.season&&<section className="card seasonCard"><div className="cardTitleRow"><div><h2><GameIcon name="missions" />Сезон I · {game.season.title}</h2><p>{game.season.subtitle} · осталось {timeLeft(game.season.ends_at)}</p></div><div className="seasonPoints">{n(game.season.points)}<span>SP</span></div></div><div className="seasonTrack">{game.season.rewards.map((r:any)=>{const claimed=(game.season.claims??[]).some((c:any)=>Number(c.level)===Number(r.level));const reached=Number(game.season.points)>=Number(r.points);const rewardText=r.cosmeticId?`🎨 ${r.cosmeticDays?`${r.cosmeticDays} дн.`:'навсегда'}`:r.crystals?`💎 ${r.crystals}`:`💰 ${n(r.credits)}`;return <div className={`seasonReward ${reached?'reached':''}`} key={r.level}><div className="seasonLevel">{r.level}</div><div className="seasonRewardBody"><strong>{r.title}</strong><small>{r.points} SP · {rewardText}</small><div className="progress"><i style={{width:`${Math.min(100,Math.round(Number(game.season.points)/Number(r.points)*100))}%`}}/></div></div><button className="miniButton" disabled={busy||!reached||claimed} onClick={()=>api('/api/season/claim',{level:r.level}).then(()=>setMessage('Сезонная награда получена')).catch(()=>{})}>{claimed?'✓':reached?'Забрать':'🔒'}</button></div>})}</div><p className="finePrint">Платной дорожки в первом сезоне нет.</p></section>}
        <section className="card"><h2>Ежедневные задания</h2><p>За день можно получить до 💎15. Награды нужно забрать вручную.</p><div className="stack">
          {(game.dailyQuests ?? []).map((q: any) => {
            const cfg = game.dailyQuestCatalog.find((x: any) => x.key === q.quest_key);
            const done = Number(q.progress) >= Number(q.target);
            return <div className="mission" key={q.id}>
              <div className="missionHead"><div><strong>{cfg?.title ?? q.quest_key}</strong><small>{cfg?.description}</small></div><span>💎{q.crystal_reward}</span></div>
              <div className="progress"><i style={{width:`${pct(q.progress,q.target)}%`}} /></div>
              <div className="missionFoot"><span>{q.progress}/{q.target} · 💰{n(q.credit_reward)}</span><button className="miniButton" disabled={busy || !done || !!q.claimed_at} onClick={() => api('/api/game/quests/claim', { period:'daily', questKey:q.quest_key }).then(() => setMessage('Награда получена')).catch(()=>{})}>{q.claimed_at ? 'Получено' : done ? 'Забрать' : 'В процессе'}</button></div>
            </div>;
          })}
        </div></section>
        <section className="card"><h2>Недельные задания</h2><p>Полный недельный набор даёт 💎75 плюс кредиты.</p><div className="stack">
          {(game.weeklyQuests ?? []).map((q: any) => {
            const cfg = game.weeklyQuestCatalog.find((x: any) => x.key === q.quest_key);
            const done = Number(q.progress) >= Number(q.target);
            return <div className="mission" key={q.id}>
              <div className="missionHead"><div><strong>{cfg?.title ?? q.quest_key}</strong><small>{cfg?.description}</small></div><span>💎{q.crystal_reward}</span></div>
              <div className="progress"><i style={{width:`${pct(q.progress,q.target)}%`}} /></div>
              <div className="missionFoot"><span>{q.progress}/{q.target}</span><button className="miniButton" disabled={busy || !done || !!q.claimed_at} onClick={() => api('/api/game/quests/claim', { period:'weekly', questKey:q.quest_key }).then(() => setMessage('Награда получена')).catch(()=>{})}>{q.claimed_at ? 'Получено' : done ? 'Забрать' : 'В процессе'}</button></div>
            </div>;
          })}
        </div></section>
        <section className="card"><h2>Достижения</h2><p>Обычные достижения дают временный визуал, мастер-достижения — тот же предмет навсегда.</p><div className="stack">
          {achievementRows.map((a: any) => {
            const unlocked = !!a.status;
            const claimed = !!a.status?.claimed_at;
            const reward = a.reward ?? {};
            return <div className="rowCard" key={a.key}>
              <div><strong>{unlocked ? '🏆 ' : '🔒 '}{a.title}</strong><small>{a.description} · {Math.min(a.progress,a.target)}/{a.target}{reward.crystals ? ` · 💎${reward.crystals}` : ''}{reward.cosmeticId ? ` · 🎨 ${reward.cosmeticDays ? `${reward.cosmeticDays} дн.` : 'навсегда'}` : ''}</small></div>
              {unlocked && <button className="miniButton" disabled={busy || claimed} onClick={() => api('/api/game/achievements/claim', { achievementKey:a.key }).then(() => setMessage('Достижение получено')).catch(()=>{})}>{claimed ? 'Получено' : 'Забрать'}</button>}
            </div>;
          })}
        </div></section>
      </>}

      {tab === 'shop' && <CosmeticsShop
        cosmetics={game.cosmetics ?? []} shopCosmetics={game.shopCosmetics ?? []}
        busy={busy || invoiceOpen} starsEnabled={game.flags?.stars_shop !== false}
        awaitingProducts={awaitingProducts}
        premium={!!s.premium} premiumUntil={s.premium_until} crystals={Number(s.crystals ?? 0)}
        onBuy={buyStars}
        onEquip={async (cosmeticId, equipped = true) => {
          try { await api('/api/shop/equip', { cosmeticId, equipped }); }
          catch (error) { setMessage(''); throw error; }
        }}
        onPremiumCrystals={async () => {
          try { await api('/api/shop/premium-crystals'); }
          catch (error) { setMessage(''); throw error; }
        }}
        onRecover={async () => {
          try { await api('/api/payments/recover'); await api('/api/session'); }
          catch (error) { setMessage(''); throw error; }
        }}
      />}
      {tab === 'social' && <>
        <section className="card profileCard"><div className="cardTitleRow"><div><h2><GameIcon name="social" />Профиль колонии</h2><p>Имя и описание видны другим игрокам. Telegram-имя остаётся только служебным идентификатором.</p></div><span className="pill">@{game.telegramUser?.username ?? 'telegram'}</span></div>
          <ColonyIdentity name={game.profile?.colony_name || 'Твоя колония'} cosmetics={game.cosmetics ?? []} />
          <p className="profileCityStats">Центр ур. {s.hq_level} · Рейтинг города {n(s.city_score)}{s.premium ? ' · Premium' : ''}</p>
          <label className="profileField">Название<input value={profileName} maxLength={24} onChange={e=>setProfileName(e.target.value)}/></label><label className="profileField">Описание<input value={profileBio} maxLength={80} onChange={e=>setProfileBio(e.target.value)} placeholder="До 80 символов"/></label>
          <button className="action secondary" disabled={busy||profileName.trim().length<3} onClick={()=>api('/api/profile/update',{colonyName:profileName,bio:profileBio}).then(()=>setMessage('Профиль сохранён')).catch(()=>{})}>Сохранить профиль</button>
        </section>
        <section className="card feedbackCard"><div className="cardTitleRow"><div><h2><GameIcon name="info" />Обратная связь</h2><p>Баг, баланс или идея — сообщение попадёт в закрытую beta-панель вместе с вашим игровым ID.</p></div><span className="pill">до 2000 знаков</span></div><div className="feedbackForm"><select value={feedbackCategory} onChange={e=>setFeedbackCategory(e.target.value)}><option value="general">Общее</option><option value="bug">Баг</option><option value="balance">Баланс</option><option value="idea">Идея</option><option value="payment">Платёж</option></select><textarea value={feedbackMessage} maxLength={2000} onChange={e=>setFeedbackMessage(e.target.value)} placeholder="Что произошло или что стоит улучшить?"/><button className="action secondary" disabled={busy||feedbackMessage.trim().length<5} onClick={sendFeedback}>Отправить</button></div></section>
        {game.flags?.alliances===false&&<section className="card"><h2>🏳️ Альянсы временно на паузе</h2><p>Feature flag отключён для текущего этапа закрытого теста. Уже созданные данные сохраняются.</p></section>}
        {game.flags?.alliances!==false && (game.alliance?.membership ? <>
          <section className="card allianceHero">
            <div className="cardTitleRow"><div><h2>🏳️ {game.alliance.alliance.name}</h2><p>Код: <b>{game.alliance.alliance.code}</b> · {game.alliance.alliance.members?.length ?? 0}/{game.alliance.alliance.memberLimit} участников · престиж {n(game.alliance.alliance.prestige)}</p></div><div className="seasonPoints">{n(game.alliance.alliance.seasonPoints)}<span>AP</span></div></div>
            <div className="grid2"><button className="action" onClick={shareAlliance}>🔗 Пригласить в альянс</button><button className="action secondary" disabled={busy} onClick={()=>api('/api/alliance/leave').then(()=>setMessage('Вы вышли из альянса')).catch(()=>{})}>Выйти</button></div>
          </section>
          <section className="card"><h2>🎯 Командные цели дня</h2><p>Выполняются общими усилиями. Личную награду получает только участник, который внёс вклад до завершения цели.</p><div className="stack">{(game.alliance.dailyGoals??[]).map((g:any)=>{const done=!!g.completed_at;const contributed=Number(g.my_contribution??0)>0;return <div className="mission" key={g.goal_key}><div className="missionHead"><div><strong>{g.title??g.goal_key}</strong><small>{g.description}</small></div><span>💎{g.reward_crystals} · 💰{n(g.reward_credits)}</span></div><div className="progress"><i style={{width:`${pct(g.progress,g.target)}%`}}/></div><div className="missionFoot"><span>{n(g.progress)}/{n(g.target)} · ваш вклад {n(g.my_contribution)}</span><button className="miniButton" disabled={busy||!done||!contributed||!!g.my_claimed_at} onClick={()=>api('/api/alliance/daily/claim',{goalKey:g.goal_key}).then(()=>setMessage('Командная награда получена')).catch(()=>{})}>{g.my_claimed_at?'Получено':done?(contributed?'Забрать':'Нет вклада'):'В процессе'}</button></div></div>})}</div></section>
          <section className="card">
            <div className="cardTitleRow"><div><h2>🛰️ {game.alliance.project.title}</h2><p>{game.alliance.project.description}</p></div><div className="projectStage">{game.alliance.project.status==='completed'?`Цикл ${game.alliance.project.cycle} готов`:`Цикл ${game.alliance.project.cycle} · этап ${game.alliance.project.stage}/3`}</div></div>
            {game.alliance.project.status==='active' ? <>
              <h3>{game.alliance.project.stageConfig.title}</h3><p>{game.alliance.project.stageConfig.description}</p>
              <div className="projectResources">
                {(['ore','energy','parts'] as const).map((resource)=>{const icons:any={ore:'⛏',energy:'⚡',parts:'⚙️'};const column:any={ore:'ore_contributed',energy:'energy_contributed',parts:'parts_contributed'};const have=Number(game.alliance.project[column[resource]]??0);const target=Number(game.alliance.project.stageConfig.target[resource]??1);return <div className="projectResource" key={resource}><div><b>{icons[resource]} {n(have)}</b><span>/ {n(target)}</span></div><div className="progress"><i style={{width:`${pct(have,target)}%`}}/></div></div>})}
              </div>
              <div className="allianceContribution"><select value={allianceResource} onChange={e=>setAllianceResource(e.target.value as 'ore'|'energy'|'parts')}><option value="ore">⛏ Руда</option><option value="energy">⚡ Энергия</option><option value="parts">⚙️ Детали</option></select><input inputMode="numeric" value={allianceAmount} onChange={e=>setAllianceAmount(e.target.value)} placeholder="Количество"/><button className="action" disabled={busy} onClick={()=>api('/api/alliance/contribute',{resource:allianceResource,amount:Number(allianceAmount)}).then((d:any)=>setMessage(`Вклад принят: ${n(d.result?.accepted)} · +${n(d.result?.points)} AP`)).catch(()=>{})}>Внести</button></div>
              <p className="finePrint">Ресурсы не возвращаются. Stars в мегапроекте не используются. Награда этапа выдаётся только участникам, набравшим минимум {n(game.alliance.project.stageConfig.minimumContributionPoints)} очков личного вклада.</p>
            </> : <div className="projectComplete"><b>✅ Цикл {game.alliance.project.cycle} завершён</b><span>Следующий цикл сложнее на 35%, зато повышает пожизненный престиж альянса и продлевает ветеранский визуальный эффект.</span>{game.alliance.project.canRestart&&<button className="action" disabled={busy||new Date(game.alliance.project.restartAvailableAt).getTime()>Date.now()} onClick={()=>api('/api/alliance/project/restart').then(()=>setMessage('Новый цикл мегапроекта запущен')).catch(()=>{})}>🔁 {new Date(game.alliance.project.restartAvailableAt).getTime()>Date.now()?`Доступно через ${timeLeft(game.alliance.project.restartAvailableAt)}`:'Запустить следующий цикл'}</button>}</div>}
          </section>
          <section className="card"><h2>Участники альянса</h2><p className="finePrint">Владелец может назначить до {game.alliance.rules?.officerLimit??5} офицеров. Офицеры могут исключать обычных участников и запускать новый цикл мегапроекта.</p><div className="stack">{(game.alliance.alliance.members??[]).map((m:any,i:number)=>{const myRole=game.alliance.membership?.role;const isMe=Number(m.telegram_id)===Number(game.telegramUser?.id);const canKick=(myRole==='owner'&&!isMe&&m.role!=='owner')||(myRole==='officer'&&!isMe&&m.role==='member');return <div className="memberCard" key={m.telegram_id}><div><strong>{i+1}. {m.colony_name||m.first_name||m.username||m.telegram_id} {m.role==='owner'?'👑':m.role==='officer'?'🛡️':''}</strong><small>HQ {m.hq_level} · City Score {n(m.city_score)} · вклад {n(m.contribution_points)} AP</small></div><div className="memberActions"><button className="miniButton" onClick={()=>viewCity(Number(m.telegram_id))}>Город</button>{myRole==='owner'&&!isMe&&m.role!=='owner'&&<button className="miniButton" disabled={busy} onClick={()=>api('/api/alliance/manage/role',{telegramId:m.telegram_id,role:m.role==='officer'?'member':'officer'}).then(()=>setMessage(m.role==='officer'?'Офицер понижен':'Офицер назначен')).catch(()=>{})}>{m.role==='officer'?'Снять':'Офицер'}</button>}{myRole==='owner'&&!isMe&&<button className="miniButton" disabled={busy} onClick={()=>api('/api/alliance/manage/transfer',{telegramId:m.telegram_id}).then(()=>setMessage('Руководство передано')).catch(()=>{})}>Передать</button>}{canKick&&<button className="miniButton dangerMini" disabled={busy} onClick={()=>api('/api/alliance/manage/kick',{telegramId:m.telegram_id}).then(()=>setMessage('Участник исключён')).catch(()=>{})}>Исключить</button>}</div></div>})}</div></section>
        </> : <>
          <section className="card"><h2>🏳️ Альянсы</h2><p>Совместные мегапроекты и сезонный командный рейтинг. Вступление доступно с HQ{game.alliance?.rules?.joinHq ?? 2}, создание — с HQ{game.alliance?.rules?.createHq ?? 3}. Stars здесь ничего не ускоряют.</p>
            <div className="allianceJoin"><input value={allianceCode} onChange={e=>setAllianceCode(e.target.value.toUpperCase())} placeholder="Код альянса"/><button className="action" disabled={busy||Number(s.hq_level)<Number(game.alliance?.rules?.joinHq??2)} onClick={()=>api('/api/alliance/join',{code:allianceCode}).then(()=>setMessage('Вы вступили в альянс')).catch(()=>{})}>Вступить</button></div>
            <div className="allianceCreate"><input value={allianceName} onChange={e=>setAllianceName(e.target.value)} placeholder="Название нового альянса"/><button className="action secondary" disabled={busy||Number(s.hq_level)<Number(game.alliance?.rules?.createHq??3)} onClick={()=>api('/api/alliance/create',{name:allianceName}).then(()=>setMessage('Альянс создан')).catch(()=>{})}>Создать · 💰{n(game.alliance?.rules?.createCost??5000)}</button></div>
            <p className="finePrint">После выхода действует cooldown {game.alliance?.rules?.rejoinCooldownHours ?? 24} ч. Лимит — {game.alliance?.rules?.memberLimit ?? 30} участников.</p>
          </section>
          {(game.alliance?.recommended?.length??0)>0&&<section className="card"><h2>Открытые альянсы</h2><div className="stack">{game.alliance.recommended.map((a:any)=><div className="rowCard" key={a.id}><div><strong>{a.name}</strong><small>{a.code} · {a.members}/{a.member_limit} · {n(a.season_points)} AP</small></div><button className="miniButton" disabled={busy||Number(s.hq_level)<Number(game.alliance?.rules?.joinHq??2)} onClick={()=>api('/api/alliance/join',{code:a.code}).then(()=>setMessage(`Вы вступили в «${a.name}»`)).catch(()=>{})}>Вступить</button></div>)}</div></section>}
        </>)}

        <section className="card"><h2><GameIcon name="star" />Рейтинг I сезона</h2><div className="leaderboardColumns"><div><h3>Игроки</h3>{(game.alliance?.playerLeaderboard??[]).slice(0,10).map((p:any,i:number)=><div className="leaderRow" key={p.telegram_id}><span>{i+1}</span><b>{p.colony_name||p.first_name||p.username||p.telegram_id}</b><em>{n(p.points)} SP · 🏙 {n(p.city_score)}</em></div>)}</div><div><h3>Альянсы</h3>{(game.alliance?.allianceLeaderboard??[]).slice(0,10).map((a:any,i:number)=><div className="leaderRow" key={a.id}><span>{i+1}</span><b>{a.name}</b><em>{n(a.points)} AP · ✦ {n(a.prestige)}</em></div>)}</div></div><p className="finePrint">AP начисляются за реальные вклады ресурсов в мегапроект. Покупки за Stars не дают рейтинговых очков.</p></section>

        <section className="card">
          <h2>Сеть колоний</h2><p>Приглашение считается квалифицированным только после HQ3 приглашённого. Денежная affiliate-программа Telegram живёт отдельно от этих игровых наград.</p>
          <div className="socialStats"><div><b>{game.referrals?.length ?? 0}</b><span>приглашено</span></div><div><b>{qualified}</b><span>HQ3+</span></div><div><b>{game.stats?.qualified_referrals ?? 0}</b><span>зачтено</span></div></div>
          <button className="action" onClick={shareReferral}>👥 Пригласить друга</button>
        </section>
        {(game.referrals?.length ?? 0) > 0 && <section className="card"><h2>Мои приглашённые</h2><div className="stack">{game.referrals.map((r:any)=><div className="rowCard" key={r.telegram_id}><div><strong>{r.colony_name || r.first_name || r.username || r.telegram_id}</strong><small>HQ {r.hq_level} · {r.referral_qualified_at ? '✅ квалифицирован' : 'до HQ3 ещё не дошёл'}</small></div><button className="miniButton" onClick={()=>viewCity(Number(r.telegram_id))}>Город</button></div>)}</div></section>}
        {viewedCity && <section className="card publicCity"><div className="cardTitleRow"><div><ColonyIdentity name={viewedCity.colony_name || viewedCity.first_name || viewedCity.username || 'Колония'} cosmetics={(viewedCity.cosmetics ?? []).map((item: any) => ({ ...item, equipped: true }))} /><p>Центр ур. {viewedCity.hq_level} · Рейтинг города {n(viewedCity.city_score)}{viewedCity.premium ? ' · Premium' : ''}</p></div><button className="miniButton" onClick={()=>setViewedCity(null)}>Закрыть</button></div>
          {(viewedCity.cosmetics?.length ?? 0) > 0 && <div className="chips">{viewedCity.cosmetics.map((c:any)=><span key={c.cosmetic_id}>{c.name}</span>)}</div>}
          <CityGrid
            buildings={viewedCity.buildings ?? []}
            decor={viewedCity.decor ?? []}
            catalog={game.catalog ?? []}
            decorCatalog={game.decorCatalog ?? []}
            gridSize={Number(viewedCity.gridSize ?? 6)}
            theme={viewedCity.cosmetics?.find((c:any)=>c.category==='theme')?.cosmetic_id ?? ''}
            weather={viewedCity.cosmetics?.find((c:any)=>c.category==='weather')?.cosmetic_id ?? ''}
            buildingSkin={viewedCity.cosmetics?.find((c:any)=>c.category==='building_skin')?.cosmetic_id ?? ''}
            frame={viewedCity.cosmetics?.find((c:any)=>c.category==='frame')?.cosmetic_id ?? ''}
            effect={viewedCity.cosmetics?.find((c:any)=>c.category==='effect')?.cosmetic_id ?? ''}
            badge={viewedCity.cosmetics?.find((c:any)=>c.category==='badge')?.cosmetic_id ?? ''}
            compact
          />
        </section>}
      </>}

      {tab==='social' && game.admin && <section className="card adminCard">
        <div className="cardTitleRow"><div><h2>🛠 Закрытый тест · Admin</h2><p>Только агрегированные метрики и сигналы подозрительной активности. Автобанов нет.</p></div><button className="miniButton" disabled={busy} onClick={loadAdminDashboard}>Обновить</button></div>
        {!adminDashboard ? <button className="action secondary" disabled={busy} onClick={loadAdminDashboard}>Загрузить метрики</button> : <>
          <div className="socialStats"><div><b>{n(adminDashboard.users?.total)}</b><span>игроков</span></div><div><b>{n(adminDashboard.users?.active_24h)}</b><span>активны 24ч</span></div><div><b>{n(adminDashboard.users?.new_24h)}</b><span>новых 24ч</span></div></div>
          <div className="socialStats"><div><b>{n(adminDashboard.monetization?.stars_7d)} ⭐</b><span>Stars 7д</span></div><div><b>{n(adminDashboard.market?.trades_24h)}</b><span>сделок 24ч</span></div><div><b>{n(adminDashboard.market?.fee_sink_24h)}</b><span>сожжено 💰</span></div></div>
          <div className="socialStats"><div><b>{n(adminDashboard.errors?.errors_24h)}</b><span>ошибок 24ч</span></div><div><b>{n(adminDashboard.errors?.client_errors_24h)}</b><span>client errors</span></div><div><b>{(adminDashboard.featureFlags??[]).filter((f:any)=>f.enabled).length}</b><span>flags включено</span></div></div>
          <div className="stack"><b>Feature flags</b>{(adminDashboard.featureFlags??[]).map((f:any)=><div className="rowCard" key={f.flag_key}><div><strong>{f.flag_key}</strong><small>{f.description} · rollout {f.rollout_percent}%</small></div><button className="miniButton" disabled={busy} onClick={()=>api('/api/admin/feature-flag',{key:f.flag_key,enabled:!f.enabled,rolloutPercent:f.rollout_percent}).then(()=>loadAdminDashboard()).catch(()=>{})}>{f.enabled?'ON':'OFF'}</button></div>)}</div>
          <div className="stack adminOps"><b>Доступ и обслуживание</b>{(adminDashboard.systemSettings??[]).map((x:any)=><div className="rowCard" key={x.setting_key}><div><strong>{x.setting_key}</strong><small>{x.value?.enabled?'включено':'выключено'}</small></div><button className="miniButton" disabled={busy} onClick={()=>api('/api/admin/system-setting',{key:x.setting_key,enabled:!x.value?.enabled,message:x.value?.message}).then(()=>loadAdminDashboard()).catch(()=>{})}>{x.value?.enabled?'ON':'OFF'}</button></div>)}<div className="rowCard"><div><strong>Beta-коды</strong><small>доступов {n(adminDashboard.beta?.access_count)} · активных кодов {n(adminDashboard.beta?.active_codes)}</small></div><button className="miniButton" disabled={busy} onClick={()=>api('/api/admin/beta-code',{maxUses:25,expiresDays:30,label:'phone-beta'}).then((d:any)=>{setAdminGeneratedCode(d.code);setMessage('Beta-код создан')}).catch(()=>{})}>+ код ×25</button></div>{adminGeneratedCode&&<div className="generatedCode"><b>{adminGeneratedCode}</b><small>Показывается только сейчас — скопируй и отправь тестерам.</small></div>}</div>
          {(adminDashboard.feedback?.length??0)>0&&<div className="stack"><b>Последняя обратная связь</b>{adminDashboard.feedback.slice(0,10).map((f:any)=><div className="rowCard" key={f.id}><div><strong>{f.category} · {f.colony_name||f.username||f.telegram_id}</strong><small>{f.message}</small></div></div>)}</div>}
          <p>D1-когорта: {n(adminDashboard.d1?.returned_next_day)}/{n(adminDashboard.d1?.cohort)} · медиана City Score {n(adminDashboard.economy?.median_city_score)}.</p>
          <div className="stack"><b>Воронка обучения</b>{(adminDashboard.tutorial??[]).map((x:any)=><div className="rowCard" key={x.tutorial_step}><div><strong>Шаг {x.tutorial_step}</strong><small>{x.users} игроков</small></div></div>)}</div>
          {(adminDashboard.suspicious?.length??0)>0&&<div className="stack"><b>⚠️ Высокая активность за час</b>{adminDashboard.suspicious.map((x:any)=><div className="rowCard" key={x.telegram_id}><div><strong>{x.username||x.first_name||x.telegram_id}</strong><small>{x.signal}: {x.value} — только сигнал для ручной проверки</small></div></div>)}</div>}
        </>}
      </section>}

      <nav className="tabs">
        {([{ key:'city', label:'Город', icon:'city' }, { key:'build', label:'Развитие', icon:'research' }, { key:'market', label:'Рынок', icon:'market' }, { key:'missions', label:'Сезон', icon:'missions' }, { key:'shop', label:'Магазин', icon:'shop' }, { key:'social', label:'Связи', icon:'social' }] as const).map((item) => <button key={item.key} className={`tab ${tab===item.key?'active':''}`} aria-current={tab===item.key?'page':undefined} onClick={()=>openSection(item.key)}><GameIcon name={item.icon} size={22} /><span>{item.label}</span></button>)}
      </nav>
    </main>
  );
}
