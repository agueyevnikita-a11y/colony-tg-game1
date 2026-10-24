'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CityGrid } from '@/components/CityGrid';
import { CityActionDock } from '@/components/CityActionDock';
import { CityActionSheet } from '@/components/CityActionSheet';
import { BuildingCatalog, type BuildingCategory } from '@/components/BuildingCatalog';
import { BuildingUpgradePreview } from '@/components/BuildingUpgradePreview';
import { FoundryLinksCard } from '@/components/FoundryLinksCard';
import { DecorPanel } from '@/components/DecorPanel';
import { DecorInspector } from '@/components/DecorInspector';
import { DecorArt } from '@/components/DecorArt';
import { ReferralsPanel } from '@/components/ReferralsPanel';
import { FeatureUnlock } from '@/components/FeatureUnlock';
import { ResourceShortage } from '@/components/ResourceShortage';
import { ProductionPanel } from '@/components/ProductionPanel';
import { ResearchPanel } from '@/components/ResearchPanel';
import { GameIcon, GameAmount } from '@/components/GameIcon';
import { AchievementsPanel, type AchievementCategory } from '@/components/AchievementsPanel';
import { InboxPanel } from '@/components/InboxPanel';
import { AlliancePanel } from '@/components/AlliancePanel';
import { AllianceCompetitionPanel } from '@/components/AllianceCompetitionPanel';
import { BuildingArt } from '@/components/BuildingArt';
import { ResourceBar } from '@/components/ResourceBar';
import { ConstructionStatus } from '@/components/ConstructionStatus';
import { ColonyWelcome } from '@/components/ColonyWelcome';
import { ColonyGuide } from '@/components/ColonyGuide';
import { ColonyGuideEntry } from '@/components/ColonyGuideEntry';
import { ColonyEventCard } from '@/components/ColonyEventCard';
import { ContractsPanel } from '@/components/ContractsPanel';
import { SupplyProjectsPanel } from '@/components/SupplyProjectsPanel';
import type { SupplyProjectState } from '@/lib/game/supply-projects';
import { currentScienceSupply, nextResearchScienceGoal } from '@/lib/game/research-supply';
import { DailyLoginPanel } from '@/components/DailyLoginPanel';
import { QuestPanel } from '@/components/QuestPanel';
import { SeasonPanel } from '@/components/SeasonPanel';
import { ExpeditionsPanel, type ArtifactExpeditionFocus } from '@/components/ExpeditionsPanel';
import { ArtifactsPanel, type ArtifactCollectionFocus } from '@/components/ArtifactsPanel';
import { MarketPanel } from '@/components/MarketPanel';
import { SectionTabs } from '@/components/SectionTabs';
import { SectionAtmosphere } from '@/components/SectionAtmosphere';
import { MechanicsHelp } from '@/components/MechanicsHelp';
import { CosmeticsShop } from '@/components/CosmeticsShop';
import { ColonyIdentity } from '@/components/CosmeticAppearance';
import { AudioSettings, useColonyMedia } from '@/components/AudioSettings';
import { ColonyProfilePanel, NotificationSettings, FeedbackPanel } from '@/components/PlayerSettingsPanels';
import { primeColonyAudioFromGesture, playColonySound } from '@/lib/client/colony-audio';
import './front.css';
import type { FoundryLink, FoundryMode, FoundryRecipeKey } from '@/lib/game/foundry';
import { PRODUCTS } from '@/lib/game/config';
import { calculateComfort, comfortPlacementGain } from '@/lib/game/comfort';
import { cityActionItems } from '@/lib/game/city-actions';
import { durationText } from '@/lib/game/format';
import { buildingHourlyProduction, buildingUpgradePreview } from '@/lib/game/upgrade-preview';
import { createProductionNetwork, foundryLinksPreview, type ProductionResource } from '@/lib/game/production-network';
import { permanentProductOwned } from '@/lib/game/product-ownership';
import { parsePremiumHold, premiumHoldConfirmed, type PremiumHold } from '@/lib/client/purchase-holds';
import { usePremiumPurchaseHold } from '@/lib/client/use-premium-purchase-hold';
import { recoverShopPurchases } from '@/lib/client/shop-recovery';
import { APP_VERSION } from '@/lib/version';
import { useGameConnection } from '@/lib/client/use-game-connection';
import { useMissionReadiness } from '@/lib/client/use-mission-readiness';
import { RequestCancelled } from '@/lib/client/requests';
import { botAppLink, playerStartParam, shareTelegramLink, supportsTelegram, telegramHeaders } from '@/lib/client/telegram';

type Tab = 'city' | 'build' | 'market' | 'missions' | 'shop' | 'social';
const botLink = botAppLink(process.env.NEXT_PUBLIC_BOT_USERNAME);
const SECTION_TITLES: Record<Tab, { title: string; hint: string }> = {
  city: { title: 'COLONY', hint: 'Твой город и производство' },
  build: { title: 'Развитие', hint: 'Технологии и новые постройки' },
  market: { title: 'Рынок', hint: 'Обмен ресурсами между колониями' },
  missions: { title: 'Задания', hint: 'Цели и награды колонии' },
  shop: { title: 'Магазин', hint: 'Оформление твоей колонии' },
  social: { title: 'Связи', hint: 'Профиль, альянс и другие колонии' },
};
const SUBSECTIONS: Record<Tab, { key: string; label: string; icon?: string }[]> = {
  city: [{ key: 'map', label: 'Карта', icon: 'map' }, { key: 'production', label: 'Цеха', icon: 'foundry' }, { key: 'contracts', label: 'Поставки', icon: 'contracts' }, { key: 'events', label: 'События', icon: 'events' }, { key: 'decor', label: 'Декор', icon: 'decor' }],
  build: [{ key: 'research', label: 'Исследования', icon: 'research' }, { key: 'buildings', label: 'Постройки', icon: 'build' }, { key: 'expeditions', label: 'Экспедиции', icon: 'rocket' }, { key: 'artifacts', label: 'Артефакты', icon: 'artifact_lens' }],
  market: [{ key: 'buy', label: 'Купить', icon: 'buy' }, { key: 'sell', label: 'Продать', icon: 'sell' }, { key: 'mine', label: 'Мои ордера', icon: 'orders' }, { key: 'prices', label: 'Цены', icon: 'chart' }],
  missions: [{ key: 'daily', label: 'Сегодня', icon: 'missions' }, { key: 'weekly', label: 'Неделя', icon: 'clock' }, { key: 'achievements', label: 'Достижения', icon: 'trophy' }, { key: 'season', label: 'Сезон', icon: 'star' }],
  shop: [{ key: 'offers', label: 'Предложения', icon: 'shop' }, { key: 'collection', label: 'Моё оформление', icon: 'palette' }],
  social: [{ key: 'profile', label: 'Профиль', icon: 'city' }, { key: 'alliance', label: 'Альянс', icon: 'social' }, { key: 'rating', label: 'Рейтинг', icon: 'trophy' }, { key: 'friends', label: 'Друзья', icon: 'network' }, { key: 'inbox', label: 'Почта', icon: 'mail' }, { key: 'settings', label: 'Настройки', icon: 'settings' }, { key: 'admin', label: 'Управление', icon: 'shield' }],
};
const DEFAULT_SUBSECTIONS: Record<Tab, string> = { city: 'map', build: 'research', market: 'buy', missions: 'daily', shop: 'offers', social: 'profile' };
const BUILDING_SHORTCUTS: Record<string, { action: string; label: string; icon: string }> = {
  foundry: { action: 'production', label: 'Открыть этот цех', icon: 'foundry' },
  research_lab: { action: 'research', label: 'Открыть исследования', icon: 'research' },
  trade_hub: { action: 'contracts', label: 'Открыть контракты', icon: 'contracts' },
  logistics: { action: 'supplies', label: 'Проекты снабжения', icon: 'contracts' },
  expedition_center: { action: 'expeditions', label: 'Открыть экспедиции', icon: 'rocket' },
  alliance_hub: { action: 'alliance', label: 'Открыть альянс', icon: 'social' },
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
function readPremiumHold(key: string): PremiumHold | null {
  try { return parsePremiumHold(sessionStorage.getItem(`${key}:premium`)); } catch { return null; }
}

function n(value: unknown) {
  return new Intl.NumberFormat('ru-RU', {
    notation: Number(value) > 99999 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(Number(value ?? 0));
}

function costDisplay(cost?: Record<string, number> | null) {
  if (!cost) return 'Максимальный уровень';
  return <span className="resourceCostInline">{Object.entries(cost).filter(([, value]) => Number(value) > 0).map(([resource, value]) => <GameAmount key={resource} resource={resource}>{n(value)}</GameAmount>)}</span>;
}

function productionText(p?: { resource: string; perHour: number } | null, type?: string) {
  if (p) return <GameAmount resource={p.resource}>{n(p.perHour)}/ч</GameAmount>;
  if (type === 'foundry') return 'Детали по выбранному рецепту';
  if (type === 'research_lab') return 'Наука для исследований';
  return 'не производит ресурс напрямую';
}

export default function Home() {
  const { game, setGame, busy, message, setMessage, phase, retry, api, refresh, connectionError } = useGameConnection();
  const readyMissionCounts = useMissionReadiness(game);
  const media = useColonyMedia();
  const [tab, setTab] = useState<Tab>('city');
  const [subsections, setSubsections] = useState(DEFAULT_SUBSECTIONS);
  const [catalogCategory, setCatalogCategory] = useState<BuildingCategory>('resources');
  const [shareFallbackLink, setShareFallbackLink] = useState('');
  const handledStart = useRef(false);
  const [viewedCity, setViewedCity] = useState<any | null>(null);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const [placementType, setPlacementType] = useState<string | null>(null);
  const [moveBuildingId, setMoveBuildingId] = useState<string | null>(null);
  const [productionNetworkVisible, setProductionNetworkVisible] = useState(false);
  const [planningCell, setPlanningCell] = useState<{ x: number; y: number } | null>(null);
  const foundryConfirmation = useRef(false);
  const foundryPlanningRef = useRef<HTMLDivElement>(null);
  const [moveDecorId, setMoveDecorId] = useState<string | null>(null);
  const [decorPlacementType, setDecorPlacementType] = useState<string | null>(null);
  const [selectedDecorId, setSelectedDecorId] = useState<string | null>(null);
  const [decorMapFocus, setDecorMapFocus] = useState<{ owner: string; id: string; requestId: number } | null>(null);
  const decorMapFocusVersion = useRef(0);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [constructionFeedback, setConstructionFeedback] = useState<{ target: string; text: string; error: boolean } | null>(null);
  const cityMapRef = useRef<HTMLElement>(null);
  const mapFeedbackRef = useRef<HTMLDivElement>(null);
  const constructionFeedbackRef = useRef<HTMLDivElement>(null);
  const pendingProduction = useRef<{ key: string; requestId: string } | null>(null);
  const [focusedResearch, setFocusedResearch] = useState<string | null>(null);
  const [researchFocusVersion, setResearchFocusVersion] = useState(0);
  const [artifactExpedition, setArtifactExpedition] = useState<(ArtifactExpeditionFocus & { owner: string }) | null>(null);
  const artifactExpeditionVersion = useRef(0);
  const [artifactCollection, setArtifactCollection] = useState<(ArtifactCollectionFocus & { owner: string }) | null>(null);
  const artifactCollectionVersion = useRef(0);
  const [researchTarget, setResearchTarget] = useState<{ owner: string; key: string | null }>({ owner: '', key: null });
  const [requestedProductionRecipe, setRequestedProductionRecipe] = useState<FoundryRecipeKey | undefined>();
  const [supplyView, setSupplyView] = useState<'projects' | 'contracts'>('projects');
  const [supplyFocus, setSupplyFocus] = useState<{ owner: string; key: string | null }>({ owner: '', key: null });
  const [requestedProductionLink, setRequestedProductionLink] = useState<{ buildingId: string; link: FoundryLink; request: number } | null>(null);
  const productionPanelRef = useRef<HTMLDivElement>(null);
  const productionNavigationPending = useRef(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [awaitingPurchases, setAwaitingPurchases] = useState<{ key: string; products: string[] }>({ key: '', products: [] });
  const [crystalPurchaseChecks, setCrystalPurchaseChecks] = useState<Set<string>>(() => new Set());
  const crystalPurchaseChecksRef = useRef<Set<string>>(new Set());
  const invoiceOpening = useRef(false);
  const navigationToTop = useRef(false);
  const [guideNavigationVersion, setGuideNavigationVersion] = useState(0);
  const guideNavigationPending = useRef<'map' | 'production' | 'contracts' | 'research' | 'build' | 'events' | 'publicCity' | null>(null);
  const publicCityRef = useRef<HTMLElement>(null);
  const colonyEventsRef = useRef<HTMLDivElement>(null);
  const contractsRef = useRef<HTMLDivElement>(null);
  const researchPanelRef = useRef<HTMLDivElement>(null);
  const buildingCatalogRef = useRef<HTMLElement>(null);
  const [allianceCode,setAllianceCode]=useState('');
  const [achievementFocus, setAchievementFocus] = useState<{ category: AchievementCategory; requestId: number }>({ category: 'all', requestId: 0 });
  const [adminDashboard,setAdminDashboard]=useState<any | null>(null);
  const [profileName,setProfileName]=useState('');
  const [profileBio,setProfileBio]=useState('');
  const profileDraftSource = useRef<{ owner: string; colonyName: string; bio: string } | null>(null);
  const [betaCode,setBetaCode]=useState('');
  const [feedbackCategory,setFeedbackCategory]=useState('general');
  const [feedbackMessage,setFeedbackMessage]=useState('');
  const [adminGeneratedCode,setAdminGeneratedCode]=useState('');
  const purchaseUser = game?.userId ?? game?.telegramUser?.id;
  const purchaseStorageKey = purchaseUser ? `colony:awaiting-cosmetics:${purchaseUser}` : '';
  const { pending: premiumAwaiting, remember: rememberPremiumPurchase } = usePremiumPurchaseHold(purchaseStorageKey, game?.paidPremiumPurchaseIds);
  const awaitingCosmetics = awaitingPurchases.key === purchaseStorageKey ? awaitingPurchases.products : [];
  const awaitingProducts = premiumAwaiting
    ? [...awaitingCosmetics, 'premium_30d'] : awaitingCosmetics;
  const planOwner = purchaseUser ? String(purchaseUser) : '';
  const artifactExpeditionFocus = artifactExpedition?.owner === planOwner ? artifactExpedition : null;
  const artifactCollectionFocus = artifactCollection?.owner === planOwner ? artifactCollection : null;
  const settingsOwner = useRef(planOwner);
  settingsOwner.current = planOwner;
  function requireCrystalCheck(owner: string, required: boolean) {
    if (!owner || crystalPurchaseChecksRef.current.has(owner) === required) return;
    const next = new Set(crystalPurchaseChecksRef.current);
    if (required) next.add(owner); else next.delete(owner);
    crystalPurchaseChecksRef.current = next;
    setCrystalPurchaseChecks(next);
  }
  const supplyProjects = (game?.supplyProjects?.projects ?? []) as SupplyProjectState[];
  const selectedSupplyKey = supplyFocus.owner === planOwner ? supplyFocus.key : null;
  const selectedSupply = supplyProjects.find(project => project.id === selectedSupplyKey)
    ?? supplyProjects.find(project => project.started && !project.completed)
    ?? supplyProjects.find(project => !project.completed) ?? supplyProjects[0];
  const plannedResearchKey = researchTarget.owner === planOwner ? researchTarget.key : null;
  const scienceSupply = game?.supplyProjects?.available ? currentScienceSupply(supplyProjects, selectedSupply?.id) : null;
  const researchScienceGoal = nextResearchScienceGoal(game?.research?.catalog ?? [], game?.research?.completed ?? [],
    plannedResearchKey, game?.research?.active?.research_key);
  const [guideFocus, setGuideFocus] = useState<{ owner: string; kind: 'research' | 'supplies' | null }>({ owner: '', kind: null });
  const activeGuideFocus = guideFocus.owner === planOwner && guideFocus.kind ? guideFocus.kind
    : plannedResearchKey ? 'research' : selectedSupply?.started && !selectedSupply.completed ? 'supplies' : 'research';

  useEffect(() => { setArtifactExpedition(null); setArtifactCollection(null); setDecorMapFocus(null); }, [planOwner]);

  useEffect(() => {
    if (!planOwner) return;
    let kind: 'research' | 'supplies' | null = null;
    try {
      const saved = localStorage.getItem(`colony:guide-focus:${planOwner}`);
      if (saved === 'research' || saved === 'supplies') kind = saved;
    } catch { /* An unavailable preference never blocks development. */ }
    setGuideFocus({ owner: planOwner, kind });
  }, [planOwner]);

  function chooseGuideFocus(kind: 'research' | 'supplies') {
    if (!planOwner) return;
    setGuideFocus({ owner: planOwner, kind });
    try { localStorage.setItem(`colony:guide-focus:${planOwner}`, kind); } catch { /* The choice remains available in memory. */ }
  }

  useEffect(() => {
    if (!game || phase !== 'ready' || !planOwner) return;
    const previous = profileDraftSource.current;
    const next = { owner: planOwner, colonyName: game.profile?.colony_name || `Колония ${game.telegramUser?.first_name ?? ''}`.trim(), bio: game.profile?.profile_bio || '' };
    profileDraftSource.current = next;
    setProfileName(value => previous?.owner === planOwner && value !== previous.colonyName ? value : next.colonyName);
    setProfileBio(value => previous?.owner === planOwner && value !== previous.bio ? value : next.bio);
    if (previous?.owner !== planOwner) { setFeedbackCategory('general'); setFeedbackMessage(''); }
  }, [planOwner, phase, game?.profile?.colony_name, game?.profile?.profile_bio, game?.telegramUser?.first_name]);

  useEffect(() => {
    if (!planOwner || !game?.supplyProjects?.projects) return;
    setSupplyFocus(previous => {
      let key = previous.owner === planOwner ? previous.key : null;
      if (previous.owner !== planOwner) {
        try { key = localStorage.getItem(`colony:supply-goal:${planOwner}`); } catch { /* Focus is optional and never sends supplies. */ }
      }
      if (key && !game.supplyProjects.projects.some((project: SupplyProjectState) => project.id === key)) key = null;
      return previous.owner === planOwner && previous.key === key ? previous : { owner: planOwner, key };
    });
  }, [planOwner, game?.supplyProjects?.projects]);

  function chooseSupplyProject(key: string) {
    if (!planOwner || !supplyProjects.some(project => project.id === key)) return;
    setSupplyFocus({ owner: planOwner, key });
    chooseGuideFocus('supplies');
    try { localStorage.setItem(`colony:supply-goal:${planOwner}`, key); } catch { /* The current focus remains available in memory. */ }
  }

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
    showSection('build', 'research');
    setResearchTarget({ owner: planOwner, key });
    chooseGuideFocus('research');
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
  }, [tab, subsections]);

  function showSection(nextTab: Tab, section: string) {
    setInspectorOpen(false);
    setDecorMapFocus(null);
    setTab(nextTab);
    setSubsections(previous => previous[nextTab] === section ? previous : { ...previous, [nextTab]: section });
  }

  function showSectionFromGuide(nextTab: Tab, section: string) {
    const alreadyVisible = tab === nextTab && subsections[nextTab] === section;
    navigationToTop.current = !alreadyVisible;
    showSection(nextTab, section);
    if (alreadyVisible) window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function openAchievements(category: AchievementCategory = 'all') {
    setAchievementFocus(previous => ({ category, requestId: previous.requestId + 1 }));
    openSection('missions');
    showSection('missions', 'achievements');
  }

  function openSubsection(section: string) {
    if (!SUBSECTIONS[tab].some(item => item.key === section)) return;
    setArtifactExpedition(null);
    setArtifactCollection(null);
    setDecorMapFocus(null);
    if (tab === 'missions' && section === 'achievements') setAchievementFocus(previous => ({ category: 'all', requestId: previous.requestId + 1 }));
    navigationToTop.current = true;
    guideNavigationPending.current = null;
    productionNavigationPending.current = false;
    setFocusedResearch(null);
    setPlacementType(null); setMoveBuildingId(null); setMoveDecorId(null); setDecorPlacementType(null);
    setPlanningCell(null);
    setConstructionFeedback(null); setMessage('');
    showSection(tab, section);
    if (subsections[tab] === section) { navigationToTop.current = false; window.scrollTo({ top: 0, behavior: 'auto' }); }
  }

  function openSection(nextTab: Tab) {
    setArtifactExpedition(null);
    setArtifactCollection(null);
    setDecorMapFocus(null);
    setInspectorOpen(false);
    navigationToTop.current = true;
    setFocusedResearch(null);
    guideNavigationPending.current = null;
    productionNavigationPending.current = false;
    setPlacementType(null);
    setPlanningCell(null);
    setMoveBuildingId(null); setMoveDecorId(null);
    setDecorPlacementType(null);
    setConstructionFeedback(null);
    setTab(nextTab);
    if (nextTab === tab) { showSection(nextTab, DEFAULT_SUBSECTIONS[nextTab]); navigationToTop.current = false; window.scrollTo({ top: 0, behavior: 'auto' }); }
  }

  useEffect(() => {
    if (tab === 'city' && (placementType || decorPlacementType || moveBuildingId || moveDecorId)) {
      cityMapRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [tab, subsections.city, placementType, decorPlacementType, moveBuildingId, moveDecorId]);

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
  }, [tab, subsections.city, requestedProductionRecipe]);

  useEffect(() => {
    const target = guideNavigationPending.current;
    if (inspectorOpen && target === 'map') { guideNavigationPending.current = null; return; }
    const refs = { map: cityMapRef, production: productionPanelRef, contracts: contractsRef, research: researchPanelRef, build: buildingCatalogRef, events: colonyEventsRef, publicCity: publicCityRef };
    const element = target ? refs[target].current : null;
    if (element) {
      guideNavigationPending.current = null;
      element.setAttribute('tabindex', '-1');
      element.focus({ preventScroll: true });
      element.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  }, [tab, subsections, guideNavigationVersion, inspectorOpen]);

  function navigateGuide(action: string) {
    setArtifactExpedition(null);
    setArtifactCollection(null);
    setDecorMapFocus(null);
    setInspectorOpen(false);
    setHelpOpen(false);
    setConstructionFeedback(null);
    setMessage('');
    setPlacementType(null);
    setPlanningCell(null);
    setMoveBuildingId(null); setMoveDecorId(null);
    setDecorPlacementType(null);
    setSelectedDecorId(null);
    productionNavigationPending.current = false;
    guideNavigationPending.current = null;
    if (action === 'build_foundry') return beginPlacement('foundry', 'Литейный цех');
    if (action === 'build_trade_hub') return beginPlacement('trade_hub', 'Торговый узел');
    if (action === 'build_lab') return beginPlacement('research_lab', 'Исследовательский центр');
    if (action === 'build_logistics') return beginPlacement('logistics', 'Логистический центр');
    if (action === 'build_expedition_center') return beginPlacement('expedition_center', 'Центр экспедиций');
    if (action === 'production') {
      setRequestedProductionLink(null);
      const foundry = (game?.buildings ?? []).find((building: any) => building.type === 'foundry' && building.status === 'active');
      if (foundry) setSelectedBuildingId(foundry.id);
      if (game?.tutorial?.current?.key === 'first_smelt') setRequestedProductionRecipe('standard_alloy');
      showSection('city', 'production'); guideNavigationPending.current = 'production';
    } else if (action === 'events') {
      showSection('city', 'events'); guideNavigationPending.current = 'events';
    } else if (action.startsWith('building:')) {
      const type = action.slice('building:'.length);
      const building = (game?.buildings ?? []).find((item: any) => item.type === type && item.status === 'active')
        ?? (game?.buildings ?? []).find((item: any) => item.type === type);
      if (building) setSelectedBuildingId(building.id);
      showSection('city', 'map'); guideNavigationPending.current = 'map';
      setInspectorOpen(!!building);
    } else if (action === 'contracts') {
      setSupplyView('contracts');
      showSection('city', 'contracts'); guideNavigationPending.current = 'contracts';
    } else if (action === 'supplies') {
      setSupplyView('projects');
      showSection('city', 'contracts'); guideNavigationPending.current = 'contracts';
    } else if (action === 'upgrade_hq') {
      const center = (game?.buildings ?? []).find((building: any) => building.type === 'hq');
      if (center) setSelectedBuildingId(center.id);
      showSection('city', 'map'); guideNavigationPending.current = 'map';
      setInspectorOpen(!!center);
    } else if (action === 'upgrade_lab') {
      const labs = (game?.buildings ?? []).filter((building: any) => building.type === 'research_lab');
      const lab = labs.filter((building: any) => building.status === 'active').sort((a: any, b: any) => Number(b.level) - Number(a.level))[0]
        ?? labs.sort((a: any, b: any) => Number(b.level) - Number(a.level))[0];
      if (lab) setSelectedBuildingId(lab.id);
      showSection('city', 'map'); guideNavigationPending.current = 'map';
      setInspectorOpen(!!lab);
    } else if (action.startsWith('research:')) {
      const key = action.slice('research:'.length);
      if (game?.research?.catalog?.some((item: any) => item.key === key)) {
        setFocusedResearch(key);
        setResearchFocusVersion(version => version + 1);
      }
      showSection('build', 'research');
    } else if (action === 'research') {
      setFocusedResearch(null);
      showSection('build', 'research'); guideNavigationPending.current = 'research';
    } else if (action === 'build') {
      showSection('build', 'buildings'); guideNavigationPending.current = 'build';
    } else if (action === 'market') {
      showSection('market', 'buy'); window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (action === 'expeditions') {
      showSectionFromGuide('build', 'expeditions');
    } else if (action === 'artifacts') {
      showSectionFromGuide('build', 'artifacts');
    } else if (action === 'achievements') {
      openAchievements('all');
    } else if (action === 'daily') {
      showSectionFromGuide('missions', 'daily');
    } else if (action === 'alliance') {
      showSectionFromGuide('social', 'alliance');
    } else if (action === 'decor') {
      showSectionFromGuide('city', 'decor');
    } else if (action === 'friends') {
      showSectionFromGuide('social', 'friends');
    } else {
      const target = game?.tutorial?.current?.targetBuilding;
      const building = (game?.buildings ?? []).find((item: any) => item.type === target && item.status !== 'active');
      if (building) setSelectedBuildingId(building.id);
      showSection('city', 'map'); guideNavigationPending.current = 'map';
      setInspectorOpen(!!building);
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
      showSection('social', 'friends');
      guideNavigationPending.current = 'publicCity';
      setGuideNavigationVersion(version => version + 1);
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
        showSection('social', 'alliance');
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
      if (placementType || decorPlacementType || moveBuildingId || moveDecorId) { cancelMapAction(); return; }
      if (tab === 'city' && subsections.city === 'map' && (selectedBuildingId || selectedDecorId)) { setSelectedBuildingId(null); setSelectedDecorId(null); return; }
      if (tab === 'social' && subsections.social === 'friends' && viewedCity) { setViewedCity(null); return; }
      if (subsections[tab] !== DEFAULT_SUBSECTIONS[tab]) { openSubsection(DEFAULT_SUBSECTIONS[tab]); return; }
      openSection('city'); showSection('city', 'map');
    };
    const visible = !!game && !game.limited && !!game.profile?.profile_completed_at && (helpOpen || tab !== 'city' || subsections.city !== 'map' || !!placementType || !!decorPlacementType || !!moveBuildingId || !!moveDecorId || (subsections.city === 'map' && (!!selectedBuildingId || !!selectedDecorId)));
    app.BackButton.onClick(back);
    if (visible) app.BackButton.show(); else app.BackButton.hide();
    return () => { app.BackButton?.offClick(back); app.BackButton?.hide(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, tab, subsections, helpOpen, viewedCity, placementType, decorPlacementType, moveBuildingId, moveDecorId, selectedBuildingId, selectedDecorId, game?.limited, game?.profile?.profile_completed_at]);

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

  const movingFoundry = (game?.buildings ?? []).find((building: any) => building.id === moveBuildingId && building.type === 'foundry');
  const planningFoundry = placementType === 'foundry' || Boolean(movingFoundry);
  const productionNetwork = useMemo(() => createProductionNetwork(game?.buildings ?? [], game?.decor ?? [], Number(game?.gridSize ?? 6)), [game?.buildings, game?.decor, game?.gridSize]);
  const productionResourceRates = useMemo(() => {
    if (!Array.isArray(game?.buildings)) return undefined;
    const rates = { ore: 0, energy: 0 };
    for (const building of game.buildings) {
      const rate = buildingHourlyProduction({ ...building, level: Number(building.level) }, { completedResearch: game?.research?.completed ?? [], premium: !!game?.state?.premium });
      if (rate && (rate.resource === 'ore' || rate.resource === 'energy')) {
        if (!Number.isFinite(rate.perHour)) return undefined;
        rates[rate.resource] += rate.perHour;
      }
    }
    return rates;
  }, [game?.buildings, game?.research?.completed, game?.state?.premium]);
  const foundrySite = planningFoundry && planningCell ? productionNetwork.placement(planningCell.x, planningCell.y, movingFoundry?.id) : null;
  const sitePreview = foundrySite?.foundry ? foundryLinksPreview(foundrySite.foundry, game?.buildings ?? []) : null;

  useEffect(() => {
    if (planningCell && (!planningFoundry || !foundrySite?.available)) setPlanningCell(null);
  }, [planningFoundry, foundrySite?.available, planningCell]);

  useEffect(() => {
    if (!planningCell) return;
    foundryPlanningRef.current?.focus({ preventScroll: true });
    foundryPlanningRef.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }, [planningCell?.x, planningCell?.y]);

  const equippedTheme = (game?.cosmetics ?? []).find((c: any) => c.equipped && c.category === 'theme')?.cosmetic_id ?? '';
  const equippedWeather = (game?.cosmetics ?? []).find((c: any) => c.equipped && c.category === 'weather')?.cosmetic_id ?? '';
  const equippedBuildingSkin = (game?.cosmetics ?? []).find((c: any) => c.equipped && c.category === 'building_skin')?.cosmetic_id ?? '';
  const equippedFrame = (game?.cosmetics ?? []).find((c: any) => c.equipped && c.category === 'frame')?.cosmetic_id ?? '';
  const equippedEffect = (game?.cosmetics ?? []).find((c: any) => c.equipped && c.category === 'effect')?.cosmetic_id ?? '';
  const equippedBadge = (game?.cosmetics ?? []).find((c: any) => c.equipped && c.category === 'badge')?.cosmetic_id ?? '';

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

  async function buyStars(productId: string) {
    if (game?.flags?.stars_shop === false) throw new Error('Покупки за Stars временно недоступны.');
    if (invoiceOpening.current) throw new Error('Сначала заверши или закрой открытый счёт Telegram.');
    if (awaitingProducts.includes(productId)) throw new Error('Ожидаем подтверждения предыдущей оплаты. Проверь покупку перед повтором.');
    const storedPremium = productId === 'premium_30d' && purchaseStorageKey ? readPremiumHold(purchaseStorageKey) : null;
    if (storedPremium && !premiumHoldConfirmed(storedPremium, game?.paidPremiumPurchaseIds)) throw new Error('Ожидаем подтверждения оплаты Premium. Проверь покупку перед повтором.');
    const app = window.Telegram?.WebApp;
    if (!supportsTelegram(app, '6.1') || !app?.openInvoice) throw new Error('Покупки доступны внутри актуального Telegram.');
    invoiceOpening.current = true;
    setInvoiceOpen(true);
    try {
      const data = await api('/api/payments/invoice', { productId });
      const product = PRODUCTS[productId as keyof typeof PRODUCTS];
      const premiumHold = product?.kind === 'premium' ? parsePremiumHold({ purchaseId: data.purchaseId }) : null;
      if (product?.kind === 'premium' && !premiumHold) throw new Error('Не удалось подтвердить номер покупки. Обнови игру перед оплатой Premium.');
      const invoice = new URL(data.invoiceLink);
      if (invoice.protocol !== 'https:' || invoice.hostname !== 't.me') throw new Error('Не удалось открыть счёт Telegram. Попробуйте позже.');
      await new Promise<void>((resolve, reject) => {
        app.openInvoice!(invoice.href, (status) => {
          if ((status === 'paid' || status === 'pending') && purchaseStorageKey) {
            if (premiumHold) {
              rememberPremiumPurchase(premiumHold);
            } else {
              const products = [...new Set([...awaitingCosmetics, productId])];
              saveAwaitingProducts(purchaseStorageKey, products);
              setAwaitingPurchases({ key: purchaseStorageKey, products });
            }
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
    setDecorMapFocus(null);
    if (moveDecorId && (building || decor)) {
      if (decor?.id === moveDecorId) {
        cancelMapAction();
        setSelectedDecorId(moveDecorId);
        setInspectorOpen(true);
        setConstructionFeedback({ target: 'map', text: 'Декор остался на прежнем месте. Перенос отменён.', error: false });
      } else {
        setConstructionFeedback({ target: 'map', text: 'Клетка занята. Выбери свободную клетку для выбранного декора.', error: true });
      }
      return;
    }
    if (building) {
      if (planningFoundry) setPlanningCell(null);
      setSelectedBuildingId(building.id);
      setSelectedDecorId(null);
      setConstructionFeedback(placementType || decorPlacementType || moveBuildingId || moveDecorId ? { target: 'map', text: 'Клетка занята. Выбери свободную.', error: true } : null);
      setInspectorOpen(!placementType && !decorPlacementType && !moveBuildingId && !moveDecorId);
      return;
    }
    if (decor) {
      if (planningFoundry) setPlanningCell(null);
      setSelectedDecorId(decor.id);
      setSelectedBuildingId(null);
      setConstructionFeedback(placementType || decorPlacementType || moveBuildingId || moveDecorId ? { target: 'map', text: 'Клетка занята декором. Выбери свободную.', error: true } : null);
      setInspectorOpen(!placementType && !decorPlacementType && !moveBuildingId && !moveDecorId);
      return;
    }
    if (planningFoundry) {
      const site = productionNetwork.placement(x, y, movingFoundry?.id);
      if (!site.available) return;
      setPlanningCell({ x, y });
      setConstructionFeedback(null);
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
        setMoveBuildingId(null); setMoveDecorId(null);
        setSelectedBuildingId(buildingId);
      }
      return;
    }
    if (moveDecorId) {
      const decorId = moveDecorId;
      if (await constructionAction('map', '/api/game/decor/move', { decorId, x, y }, 'Декор перемещён бесплатно')) {
        setMoveDecorId(null); setSelectedDecorId(decorId);
      }
      return;
    }
    setSelectedBuildingId(null); setSelectedDecorId(null);
    setConstructionFeedback({ target: 'map', text: 'Свободная клетка. Нажми «Построить» для здания или открой «Декор» для благоустройства. Затем выбери место на карте.', error: false });
  }

  function beginPlacement(type: string, name: string) {
    setPlanningCell(null);
    setPlacementType(type);
    setMoveBuildingId(null); setMoveDecorId(null);
    setDecorPlacementType(null);
    setSelectedBuildingId(null);
    setSelectedDecorId(null);
    showSection('city', 'map');
    setMessage('');
    setConstructionFeedback({ target: 'map', text: `Выбери свободную клетку для «${name}»`, error: false });
  }

  function beginMove(building: any) {
    setPlanningCell(null);
    setInspectorOpen(false);
    setMoveDecorId(null);
    setMoveBuildingId(building.id);
    setPlacementType(null);
    setDecorPlacementType(null);
    setSelectedDecorId(null);
    setMessage('');
    setConstructionFeedback({ target: 'map', text: 'Выбери новую свободную клетку', error: false });
  }

  function beginDecorPlacement(type: string, name: string) {
    setPlanningCell(null);
    if (busy) return;
    if ((game?.buildings ?? []).length + (game?.decor ?? []).length >= Number(game?.gridSize ?? 6) ** 2) {
      showSection('city', 'map');
      setMessage('');
      setConstructionFeedback({ target: 'map', text: 'Нет свободных клеток. Освободи место для нового объекта. Территория расширяется при достижении базы ур. 3 и 5.', error: true });
      return;
    }
    setDecorPlacementType(type);
    setPlacementType(null);
    setMoveBuildingId(null); setMoveDecorId(null);
    setSelectedBuildingId(null);
    setSelectedDecorId(null);
    showSection('city', 'map');
    setMessage('');
    setConstructionFeedback({ target: 'map', text: `Выбери свободную клетку для «${name}»`, error: false });
  }

  function beginDecorMove(decor: any) {
    if (busy) return;
    if ((game?.buildings ?? []).length + (game?.decor ?? []).length >= Number(game?.gridSize ?? 6) ** 2) {
      setConstructionFeedback({ target: 'map', text: 'Для переноса нужна свободная клетка. Освободи место на карте.', error: true });
      return;
    }
    setPlanningCell(null);
    setInspectorOpen(false); setMoveDecorId(decor.id); setMoveBuildingId(null);
    setPlacementType(null); setDecorPlacementType(null); setSelectedBuildingId(null);
    setMessage(''); setConstructionFeedback({ target: 'map', text: 'Выбери свободную клетку. Перемещение декора бесплатно.', error: false });
  }

  function findPlacedDecor(decorId: string) {
    const target = (game?.decor ?? []).find((item: any) => item.id === decorId);
    if (!target) { setMessage('Объект больше не найден. Обнови данные колонии.'); return; }
    openSection('city');
    showSection('city', 'map');
    setSelectedBuildingId(null);
    setSelectedDecorId(target.id);
    setDecorMapFocus({ owner: planOwner, id: target.id, requestId: ++decorMapFocusVersion.current });
    setConstructionFeedback({ target: 'map', text: 'Декор выделен на карте. Нажми на него, чтобы посмотреть действия: перенос и демонтаж выполняются отдельно.', error: false });
  }

  function cancelMapAction() {
    setPlanningCell(null);
    setPlacementType(null);
    setDecorPlacementType(null);
    setMoveBuildingId(null); setMoveDecorId(null);
    setMessage('');
    setConstructionFeedback(null);
  }

  async function confirmFoundrySite() {
    if (busy || foundryConfirmation.current || !planningFoundry || !planningCell) return;
    const site = productionNetwork.placement(planningCell.x, planningCell.y, movingFoundry?.id);
    if (!site.available) { setPlanningCell(null); return; }
    const { x, y } = planningCell;
    foundryConfirmation.current = true;
    try {
      const movedId = movingFoundry?.id;
      const succeeded = await constructionAction('map', movedId ? '/api/game/building/move' : '/api/game/build',
        movedId ? { buildingId: movedId, x, y } : { type: 'foundry', x, y }, movedId ? 'Цех перемещён бесплатно. Новые связи доступны в производстве.' : 'Строительство цеха начато. Связи станут доступны после готовности.');
      if (succeeded) {
        setPlanningCell(null); setPlacementType(null); setMoveBuildingId(null);
        if (movedId) { setSelectedBuildingId(movedId); setProductionNetworkVisible(true); }
      }
    } finally { foundryConfirmation.current = false; }
  }

  function chooseProductionLink(buildingId: string, link: ProductionResource) {
    const foundry = (game?.buildings ?? []).find((building: any) => building.id === buildingId);
    if (!foundry || !foundryLinksPreview(foundry, game?.buildings ?? [])?.options.some(option => option.link === link)) return;
    navigateGuide('production');
    setSelectedBuildingId(buildingId);
    setRequestedProductionRecipe('standard_alloy');
    setRequestedProductionLink(previous => ({ buildingId, link, request: (previous?.request ?? 0) + 1 }));
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
      <h1><GameIcon name={maintenance ? 'settings' : 'lock'} size={24} className="interfaceActionIcon" />{maintenance ? 'Техническое обслуживание' : 'Закрытая бета'}</h1>
      <p>{maintenance?(game.access?.maintenance?.message??'Мы временно закрыли игру на обслуживание. Прогресс сохранён.'):'Для этого этапа нужен beta-код. После одной успешной активации доступ сохраняется за вашим Telegram-аккаунтом.'}</p>
      {!maintenance&&<><input className="gateInput" value={betaCode} maxLength={64} onChange={e=>setBetaCode(e.target.value.toUpperCase())} placeholder="Введите beta-код"/><button className="action" disabled={busy||betaCode.trim().length<4} onClick={redeemBetaAccess}>Активировать доступ</button></>}
      {maintenance&&<button className="action secondary" disabled={busy} onClick={()=>refresh()}>Проверить снова</button>}
      {message&&<div className="notice error">{message}</div>}
      {connectionError && connectionError !== message && <div className="notice error" role="status">{connectionError}</div>}
      <small>Telegram ID: {game.telegramUser?.id} · версия {game.version}</small>
    </section></main>;
  }

  const s = game.state;
  const comfort = game.comfort ?? calculateComfort(game.decor ?? []);
  const marketLocked = game.unlocks?.market?.unlocked === false;
  const expeditionsLocked = game.unlocks?.expeditions?.unlocked === false;
  const usedCells = (game.buildings ?? []).length + (game.decor ?? []).length;
  const totalCells = Number(game.gridSize ?? 6) ** 2;
  const foundryPlacementCost = game.catalog?.find((item: any) => item.type === 'foundry')?.baseBuildCost;
  const foundrySiteAffordable = placementType !== 'foundry' || Boolean(foundryPlacementCost && Object.entries(foundryPlacementCost).every(([resource, cost]) => Number(s[resource] ?? 0) >= Number(cost ?? 0)));

  return (
    <main className="app colonyApp" data-section={tab} data-city-motion={media.motionActive ? 'on' : 'off'} onClickCapture={(event) => {
      if (event.target instanceof Element && event.target.closest('button,summary,a,[role="button"]')) {
        primeColonyAudioFromGesture();
        playColonySound('tap');
      }
    }}>
      <SectionAtmosphere section={tab} />
      {!game.profile?.profile_completed_at && <ColonyWelcome colonyName={profileName} onNameChange={setProfileName} bio={profileBio} onBioChange={setProfileBio} busy={busy} onSubmit={async () => {
        try { await api('/api/profile/update', { colonyName: profileName, bio: profileBio }); }
        catch (error) { setMessage(''); throw error; }
      }} />}
      <MechanicsHelp open={helpOpen} onClose={() => setHelpOpen(false)} onNavigate={navigateGuide} />
      <div className={`header ${tab === 'city' ? 'cityHeader' : 'sectionHeader'}`}>
        <div className="brandGroup"><div className="brandMark" aria-hidden="true">{tab === 'city' ? <BuildingArt type="hq" /> : <GameIcon name={tab === 'build' ? 'research' : tab === 'missions' ? 'missions' : tab === 'social' ? 'social' : tab} size={26} />}</div><div><span className="brandKicker">{tab === 'city' ? 'ПОСТРОЙ СВОЮ КОЛОНИЮ' : 'COLONY'}</span><h1 className="brand">{SECTION_TITLES[tab].title}</h1><div className="level">{SECTION_TITLES[tab].hint}</div></div></div>
      </div>

      {tab === 'city' && <details className="resourceOverview"><summary><span>Ресурсы</span><span>{['ore', 'energy', 'parts', 'credits', 'science', 'crystals'].map(resource => <GameAmount key={resource} resource={resource}>{n(s[resource])}</GameAmount>)}</span></summary><ResourceBar state={s} caps={game.caps} escrow={game.escrow} scienceRate={Number(game.scienceRate ?? 0)} onHelp={() => setHelpOpen(true)} /></details>}
      {(tab === 'build' || tab === 'market') && <div className="sectionResources" aria-label="Ресурсы для этого раздела"><span>В наличии</span>{(tab === 'build' ? ['ore', 'energy', 'parts', 'credits', 'science'] : ['ore', 'energy', 'parts', 'credits']).map(resource => <GameAmount key={resource} resource={resource}>{n(s[resource])}</GameAmount>)}</div>}

      {tab === 'city' && game.flags?.closed_beta_banner && <details className="betaBanner compactBeta"><summary><GameIcon name="research" size={14} />Тестовая версия · {APP_VERSION}</summary><span>Баланс и механики ещё меняются. Прогресс тестовой версии может корректироваться перед публичным запуском.</span></details>}

      {connectionError && <div className="notice error connectionNotice" role="status"><span>{connectionError}</span><button className="miniButton" disabled={busy} onClick={() => refresh()}>Обновить</button>{botLink && connectionError.includes('Сессия Telegram') && <a href={botLink}>Открыть из бота</a>}</div>}
      {shareFallbackLink && <label className="shareFallback">Ссылка приглашения<input readOnly value={shareFallbackLink} onFocus={event => event.target.select()} /></label>}

      {message && <div role="status" className={`notice ${message.toLowerCase().includes('ошиб') || message.toLowerCase().includes('не хватает') || message.toLowerCase().includes('занята') ? 'error' : ''}`}>{message}</div>}

      <SectionTabs key={tab} label={`Подразделы: ${SECTION_TITLES[tab].title}`}
        items={SUBSECTIONS[tab].filter(item => item.key !== 'admin' || game.admin).map(item => ({ ...item, locked: tab === 'build' && item.key === 'expeditions' && expeditionsLocked, badge: tab === 'city' && item.key === 'events' && game.colonyEvents?.active ? 1 : tab === 'social' && item.key === 'inbox' ? Number(game.inbox?.unread ?? 0) : tab === 'social' && item.key === 'friends' ? Number(game.referralProgram?.pendingCount ?? 0) : tab === 'missions' ? readyMissionCounts[item.key as keyof typeof readyMissionCounts] : undefined }))}
        value={subsections[tab]} onChange={openSubsection} />

      {tab === 'city' && subsections.city === 'map' && <ColonyGuide key={planOwner} tutorial={game.tutorial} buildings={game.buildings ?? []} research={game.research} plannedResearchKey={plannedResearchKey} busy={busy}
        focus={activeGuideFocus} onFocusChange={chooseGuideFocus}
        development={{ resources: s, caps: game.caps, escrow: game.escrow, jobs: game.activeJobs ?? [], supplyGoal: game.supplyProjects?.available ? selectedSupply : null, supplyUnlocked: game.supplyProjects?.unlocked }}
        onAction={navigateGuide} onHelp={() => setHelpOpen(true)} onRefresh={() => { void refresh(); }}
        onClaim={async () => { try { await api('/api/game/tutorial/claim'); } catch (error) { setMessage(''); throw error; } }} />}

      {tab === 'city' && <>
        {subsections.city === 'map' && <div data-section-panel="city-map">
<section className="card cityCard" ref={cityMapRef}>
          <div className="cardTitleRow"><div><h2>Твой город</h2><p>Центр ур. {s.hq_level} · {game.gridSize}×{game.gridSize} · занято {usedCells} из {totalCells} клеток. Нажми на здание или декор — откроются его действия.</p></div></div>
          <button type="button" className="cityComfortSummary" onClick={() => openSubsection('decor')}><span><GameIcon name="comfort" size={18} />Комфорт <strong>{comfort.score}/100</strong></span><span>Благоустроить<GameIcon name="arrow" size={15} /></span></button>
          {(placementType || decorPlacementType || moveBuildingId || moveDecorId) && <div className="mapModeBar">
            <span><GameIcon name={placementType ? 'build' : decorPlacementType ? 'decor' : 'move'} size={17} /> {placementType ? 'Размещение здания' : decorPlacementType ? 'Размещение декора' : moveDecorId ? 'Перемещение декора' : 'Перемещение здания'}</span>
            <button className="miniButton" disabled={busy} onClick={cancelMapAction}>Отмена</button>
          </div>}
          {placementType && (() => { const item = game.catalog?.find((entry: any) => entry.type === placementType); return item && <div className="placementPreview"><BuildingArt type={placementType} /><div><strong>{item.name}</strong>{costDisplay(item.baseBuildCost)}<small>{placementType === 'foundry' ? 'Выбери свободную клетку, сравни связи и подтверди строительство. Ресурсы спишутся после подтверждения.' : 'Нажми на свободную клетку. Ресурсы спишутся при выборе места.'}</small></div></div>; })()}
          {decorPlacementType && (() => { const item = game.decorCatalog?.find((entry: any) => entry.type === decorPlacementType); return item && <div className="placementPreview"><DecorArt type={decorPlacementType} /><div><strong>{item.name}</strong><GameAmount resource="credits">{n(item.credits)}</GameAmount><small>Комфорт +{comfortPlacementGain(game.decor ?? [], decorPlacementType)}. Нажми свободную клетку для размещения.</small></div></div>; })()}
          {!placementType && !decorPlacementType && !moveBuildingId && !moveDecorId && <div className="cityNetworkControl"><button type="button" className="miniButton" aria-pressed={productionNetworkVisible} onClick={() => setProductionNetworkVisible(value => !value)}><GameIcon name="network" size={17} />Связи производства</button><span>{productionNetworkVisible ? 'Доступные связи, не активные заказы' : 'Покажи полезное соседство'}</span></div>}
          <CityGrid
            buildings={game.buildings ?? []}
            decor={game.decor ?? []}
            catalog={game.catalog ?? []}
            decorCatalog={game.decorCatalog ?? []}
            gridSize={Number(game.gridSize ?? 6)}
            selectedId={selectedBuildingId}
            selectedDecorId={selectedDecorId}
            decorFocus={decorMapFocus?.owner === planOwner ? decorMapFocus : null}
            onDecorFocused={(requestId, found) => {
              if (decorMapFocusVersion.current !== requestId || settingsOwner.current !== decorMapFocus?.owner) return;
              setDecorMapFocus(null);
              if (!found) setConstructionFeedback({ target: 'map', text: 'Объект больше не виден на карте. Обнови данные колонии.', error: true });
            }}
            placementMode={!!placementType}
            decorPlacementMode={!!decorPlacementType}
            moveMode={!!moveBuildingId || !!moveDecorId}
            planningType={placementType ?? (game.buildings ?? []).find((building: any) => building.id === moveBuildingId)?.type}
            movingBuildingId={moveBuildingId ?? undefined}
            productionNetwork={productionNetworkVisible}
            planningCell={planningFoundry && foundrySite?.available ? planningCell : null}
            theme={equippedTheme}
            weather={equippedWeather}
            buildingSkin={equippedBuildingSkin}
            frame={equippedFrame}
            effect={equippedEffect}
            badge={equippedBadge}
            onCell={handleCityCell}
          />
          {planningFoundry && foundrySite?.available && sitePreview && planningCell && <div className="foundrySitePreview" ref={foundryPlanningRef} tabIndex={-1} data-foundry-site-preview>
            <FoundryLinksCard preview={sitePreview} title={`Цех · клетка ${planningCell.x + 1}:${planningCell.y + 1}`} caption={`Стандартный сплав · обычный режим · 1 цикл. ${movingFoundry ? 'Сравнение новых заказов после переноса; оплаченная очередь сохранится.' : 'Связи будут доступны после завершения строительства, если соседние поставщики работают.'}`}>
              <div className="foundrySiteCost">{movingFoundry ? 'Перемещение бесплатно' : <>Стоимость строительства {costDisplay(foundryPlacementCost)}</>}</div>
              {!movingFoundry && <ResourceShortage cost={foundryPlacementCost} resources={s} />}
              <div className="foundrySiteActions"><button type="button" className="action" disabled={busy || !foundrySiteAffordable} onClick={() => void confirmFoundrySite()}>{movingFoundry ? 'Переместить сюда' : 'Построить здесь'}</button><button type="button" className="miniButton" disabled={busy} onClick={() => { setPlanningCell(null); cityMapRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' }); }}>Другое место</button></div>
            </FoundryLinksCard>
          </div>}
          {!placementType && !decorPlacementType && !moveBuildingId && !moveDecorId && <CityActionDock
            items={cityActionItems({ ...game, comfort })} busy={busy}
            onAction={action => action === 'share' ? shareCity() : navigateGuide(cityActionItems(game).find(item => item.key === action)?.action ?? action)} />}
          <div className="mapFeedback" ref={mapFeedbackRef}>
            {constructionNotice('map')}
            {placementType && !sitePreview && <ResourceShortage cost={game.catalog?.find((item: any) => item.type === placementType)?.baseBuildCost} resources={s} />}
            {decorPlacementType && <ResourceShortage cost={{ credits: Number(game.decorCatalog?.find((item: any) => item.type === decorPlacementType)?.credits ?? 0) }} resources={s} />}
          </div>
        </section>

        <CityActionSheet open={inspectorOpen && !!(selectedBuilding || selectedDecor)} title="Действия на карте" onClose={() => setInspectorOpen(false)}>
        {selectedBuilding && <section className="card buildingInspector">
          {(() => {
            const cfg = game.catalog.find((x: any) => x.type === selectedBuilding.type);
            const upgradeContext = { buildings: game.buildings ?? [], completedResearch: game.research?.completed ?? [], premium: Boolean(s.premium) };
            const upgradePreview = buildingUpgradePreview(selectedBuilding, upgradeContext);
            const hourlyProduction = buildingHourlyProduction(selectedBuilding, upgradeContext);
            const linksPreview = foundryLinksPreview(selectedBuilding, game.buildings ?? []);
            return <>
              <div className="inspectorHead"><div className="inspectorEmoji"><BuildingArt type={selectedBuilding.type} /></div><div><h2>{cfg?.name ?? selectedBuilding.type}</h2><p>Уровень {selectedBuilding.level} · клетка {Number(selectedBuilding.x) + 1}:{Number(selectedBuilding.y) + 1}</p></div></div>
              {cfg?.description && <p className="buildingPurpose">{cfg.description}</p>}
              {selectedBuilding.type === 'hq' && <details className="inspectorUnlocks"><summary>Что открывают уровни базы</summary><p>Уровень 2 открывает исследовательский центр. Уровень 3 даёт новые здания и карту 7×7, уровень 5 расширяет её до 8×8.</p></details>}
              <div className="inspectorStats">
                <div><span>Статус</span><b>{selectedBuilding.status === 'active' ? 'Работает' : `${selectedBuilding.status === 'upgrading' ? 'Улучшается' : 'Строится'} → ур. ${selectedBuilding.target_level}`}</b></div>
                {!upgradePreview && <div><span>Производство</span><b>{selectedBuilding.status !== 'active' && (selectedBuilding.production || selectedBuilding.type === 'research_lab') ? 'Возобновится после работ' : productionText(hourlyProduction, selectedBuilding.type)}</b></div>}
              </div>
              {BUILDING_SHORTCUTS[selectedBuilding.type] && <button type="button" className="action inspectorShortcut" disabled={busy || selectedBuilding.status !== 'active'} onClick={() => {
                const id = selectedBuilding.id;
                navigateGuide(BUILDING_SHORTCUTS[selectedBuilding.type].action);
                if (selectedBuilding.type === 'foundry') setSelectedBuildingId(id);
              }}><GameIcon name={BUILDING_SHORTCUTS[selectedBuilding.type].icon} size={18} /> {BUILDING_SHORTCUTS[selectedBuilding.type].label}</button>}
              <ConstructionStatus building={selectedBuilding} busy={busy} onRefresh={() => { void refresh(); }} />
              {linksPreview && <FoundryLinksCard preview={linksPreview} caption="Стандартный сплав · обычный режим · 1 цикл. Выбор откроет этот вариант в производстве без запуска." disabled={busy} onChooseLink={link => chooseProductionLink(selectedBuilding.id, link)} />}
              <BuildingUpgradePreview preview={upgradePreview} />
              {selectedBuilding.status === 'active' && (selectedBuilding.nextUpgrade ? <div className="upgradeBox"><span>Следующий уровень: {selectedBuilding.nextUpgrade.level}</span><b>{costDisplay(selectedBuilding.nextUpgrade.cost)}</b>{Number(selectedBuilding.nextUpgrade.timeSec) > 0 && <small className="inspectorUpgradeTime"><GameIcon name="clock" size={14} /> {durationText(selectedBuilding.nextUpgrade.timeSec)}</small>}</div> : <p className="finePrint">Достигнут максимальный уровень здания.</p>)}
              <div className="grid2">
                <button className="action" disabled={busy || selectedBuilding.status !== 'active' || !selectedBuilding.nextUpgrade} onClick={() => constructionAction(`upgrade:${selectedBuilding.id}`, '/api/game/building/upgrade', { buildingId: selectedBuilding.id }, 'Улучшение запущено')}><GameIcon name="upgrade" size={17} /> Улучшить</button>
                <button className="action secondary" disabled={busy || selectedBuilding.status !== 'active'} onClick={() => beginMove(selectedBuilding)}><GameIcon name="move" size={17} /> Переместить</button>
              </div>
              {selectedBuilding.status === 'active' && <ResourceShortage cost={selectedBuilding.nextUpgrade?.cost} resources={s} />}
              {constructionNotice(`upgrade:${selectedBuilding.id}`)}
            </>;
          })()}
        </section>}

        {selectedDecor && <DecorInspector key={selectedDecor.id} decor={selectedDecor}
          catalogItem={(game.decorCatalog ?? []).find((item: any) => item.type === selectedDecor.type)}
          allDecor={game.decor ?? []} open={inspectorOpen} busy={busy} freeCells={Math.max(0, totalCells - usedCells)} onMove={() => beginDecorMove(selectedDecor)}
          onRemove={async () => {
            try {
              const data = await api('/api/game/decor/remove', { decorId: selectedDecor.id });
              setInspectorOpen(false); setSelectedDecorId(null);
              setConstructionFeedback({ target: 'map', text: `Декор демонтирован · возврат кредитов: ${n(data.result?.refund)}`, error: false });
            } catch (error) { setMessage(''); throw error; }
          }} />}
        </CityActionSheet>
        </div>}
        <div data-section-panel="city-production" hidden={subsections.city !== 'production'}>
<div ref={productionPanelRef}><ProductionPanel
          buildings={game.buildings ?? []}
          jobs={game.activeJobs ?? []}
          resources={s}
          partsCapacity={Math.max(0, Number(game.caps?.parts ?? 800) - Number(game.escrow?.parts ?? 0))}
          partsMultiplier={Number(game.production?.partsMultiplier ?? 1)}
          resourceRates={productionResourceRates}
          unlockedRecipes={game.production?.unlockedRecipes ?? ['standard_alloy']}
          recipesEnabled={game.production?.recipesEnabled}
          supplyGoal={selectedSupply && game.supplyProjects?.available && (game.supplyProjects?.unlocked || selectedSupply.started) ? {
            projectKey: selectedSupply.id, name: selectedSupply.name,
            stageName: selectedSupply.stages[selectedSupply.stageIndex]?.name ?? 'Проект завершён',
            requiredParts: selectedSupply.remaining.parts, ready: selectedSupply.ready, completed: selectedSupply.completed,
          } : undefined}
          onSupplyProjects={() => navigateGuide('supplies')}
          selectedRecipe={requestedProductionRecipe}
          requestedLink={requestedProductionLink}
          busy={busy}
          selectedBuildingId={selectedBuildingId}
          onFoundryChange={setSelectedBuildingId}
          onChangeSelection={() => setConstructionFeedback(null)}
          onStart={startProduction}
          onResearch={(key) => navigateGuide(`research:${key}`)}
          onRefresh={() => { void refresh(); }}
          onBuild={() => beginPlacement('foundry', 'Литейный цех')}
          onSelectBuilding={(id) => { setSelectedBuildingId(id); setSelectedDecorId(null); setConstructionFeedback(null); showSection('city', 'map'); setInspectorOpen(true); guideNavigationPending.current = 'map'; setGuideNavigationVersion(version => version + 1); }}
          feedback={constructionFeedback?.target.startsWith('production:') ? constructionNotice(constructionFeedback.target) : undefined}
        /></div>
        </div>
        {subsections.city === 'contracts' && <div data-section-panel="city-contracts">
<div ref={contractsRef}>
        <SectionTabs label="Поставки колонии" value={supplyView} items={[
          { key: 'projects', label: 'Проекты', icon: 'build', badge: supplyProjects.filter(project => project.ready).length },
          { key: 'contracts', label: 'Контракты', icon: 'contracts' },
        ]} onChange={key => setSupplyView(key as 'projects' | 'contracts')} />
        <div hidden={supplyView !== 'projects'}><SupplyProjectsPanel key={planOwner}
          state={game.supplyProjects} resources={s} queuedParts={(game.activeJobs ?? []).reduce((total: number, job: any) => total + Number(job.parts_reward), 0)} ownerKey={planOwner} selectedProjectKey={selectedSupply?.id ?? ''}
          onSelectProject={chooseSupplyProject} busy={busy}
          onAction={async body => { try { return await api('/api/game/supply-projects', body); } catch (error) { setMessage(''); throw error; } }}
          onBuildLogistics={() => beginPlacement('logistics', 'Логистический центр')}
          onUpgradeHq={() => navigateGuide('upgrade_hq')}
          onProduction={() => navigateGuide('production')} onRefresh={() => { void refresh(); }}
          researchGoal={researchScienceGoal} onResearch={key => navigateGuide(key ? `research:${key}` : 'research')}
          onOpenCollection={() => { openSection('shop'); showSection('shop', 'collection'); }}
        /></div>
        <div hidden={supplyView !== 'contracts'}><ContractsPanel key={planOwner}
          contracts={game.contracts ?? []} info={game.contractsInfo}
          buildings={game.buildings ?? []} resources={s} busy={busy}
          onComplete={async (contractId) => {
            try { return await api('/api/game/contracts/complete', { contractId }); }
            catch (error) { setMessage(''); throw error; }
          }}
          onBuild={() => beginPlacement('trade_hub', 'Торговый узел')}
          onProduction={() => navigateGuide('production')}
          onRefresh={() => { void refresh(); }}
        /></div></div>
        </div>}
        {subsections.city === 'events' && <div data-section-panel="city-events">
{!game.colonyEvents?.enabled ? <section className="card"><h2>События колонии</h2><p>События пока недоступны. Остальные возможности колонии продолжают работать.</p><button className="action secondary" disabled={busy} onClick={() => { void refresh(); }}>Проверить снова</button></section>
  : !game.colonyEvents.unlocked ? <section className="card"><h2>События колонии</h2><p>Заверши первые шаги и улучши базу до уровня 2. После этого здесь появятся ситуации с выбором решения.</p><button className="action secondary" onClick={() => openSubsection('map')}>К первым шагам</button></section>
  : !game.colonyEvents.active && !game.colonyEvents.lastResolved && !game.colonyEvents.nextAt ? <section className="card"><h2>В колонии спокойно</h2><p>Новые ситуации появляются у действующих шахт, электростанций, литейных цехов и лабораторий.</p><button className="action secondary" disabled={busy} onClick={() => { void refresh(); }}>Проверить события</button></section> : null}
<div ref={colonyEventsRef}><ColonyEventCard
          key={planOwner}
          eventState={game.colonyEvents}
          resources={s}
          capacities={{
            ore: Math.max(0, Number(game.caps?.ore ?? 0) - Number(game.escrow?.ore ?? 0)),
            energy: Math.max(0, Number(game.caps?.energy ?? 0) - Number(game.escrow?.energy ?? 0)),
            parts: Math.max(0, Number(game.caps?.parts ?? 0) - Number(game.escrow?.parts ?? 0)),
          }}
          completedResearch={game.research?.completed ?? []}
          busy={busy}
          onResolve={async (eventId, choiceId) => {
            try { return await api('/api/game/event/resolve', { eventId, choiceId }); }
            catch (error) { setMessage(''); throw error; }
          }}
          onShowBuilding={(type) => navigateGuide(`building:${type}`)}
          onResearch={(key) => navigateGuide(`research:${key}`)}
          onRefresh={() => { void refresh(); }}
        /></div>
        </div>}
        {subsections.city === 'decor' && <div data-section-panel="city-decor">
          <DecorPanel key={planOwner} catalog={game.decorCatalog ?? []} decor={game.decor ?? []}
            hqLevel={Number(s.hq_level)} completedResearch={game.research?.completed ?? []} resources={s} busy={busy}
            freeCells={Math.max(0, totalCells - usedCells)} highestComfort={Number(game.stats?.max_comfort ?? comfort.score)}
            onOpenMap={() => showSection('city', 'map')} onFindOnMap={findPlacedDecor}
            onPlace={beginDecorPlacement} onResearch={chooseResearchTarget}
            onUpgradeHq={() => navigateGuide('upgrade_hq')} onAchievements={() => openAchievements('comfort')} />
        </div>}
      </>}

      {tab === 'build' && <>
        {subsections.build === 'research' && <div data-section-panel="build-research">
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
          productionBuildings={game.buildings ?? []} selectedProductionBuildingId={selectedBuildingId}
          scienceSupply={scienceSupply}
          onScienceSupply={projectKey => {
            if (!game.supplyProjects?.available || !currentScienceSupply(supplyProjects.filter(project => project.id === projectKey))) return;
            chooseSupplyProject(projectKey);
            navigateGuide('supplies');
          }}
          onPlanChange={chooseResearchTarget}
          onInspectResearch={(key) => navigateGuide(`research:${key}`)}
          onUpgradeHq={() => navigateGuide('upgrade_hq')}
          onUpgradeLab={() => navigateGuide('upgrade_lab')}
          onShowProduction={() => navigateGuide('production')}
          onOpenFeature={(feature) => { if (feature === 'decor') { openSection('city'); showSection('city', 'decor'); } else if (feature === 'market') { openSection('market'); showSection('market', 'buy'); } else { openSection('build'); showSection('build', 'expeditions'); } }}
          onProduction={(recipe, buildingId) => {
            const requestedId = buildingId ?? selectedBuildingId;
            const activeFoundries = (game.buildings ?? []).filter((building: any) => building.type === 'foundry' && building.status === 'active');
            const foundry = activeFoundries.find((building: any) => building.id === requestedId) ?? activeFoundries[0];
            if (foundry) setSelectedBuildingId(foundry.id);
            setConstructionFeedback(null); setRequestedProductionLink(null); productionNavigationPending.current = true; setRequestedProductionRecipe(recipe); showSection('city', 'production');
          }}
          onStart={async (researchKey) => {
            try { await api('/api/game/research/start', { researchKey }); }
            catch (error) { setMessage(''); throw error; }
          }}
          onBuildLab={() => beginPlacement('research_lab', 'Исследовательский центр')}
          onBuild={beginPlacement}
          onRefresh={() => { void refresh(); }}
        /></div>}
        </div>}
        {subsections.build === 'buildings' && <div data-section-panel="build-buildings">
<section className="card" id="colony-buildings" ref={buildingCatalogRef}>
          <BuildingCatalog catalog={game.catalog ?? []} buildings={game.buildings ?? []}
            hqLevel={Number(s.hq_level)} resources={s} busy={busy}
            category={catalogCategory} onCategoryChange={setCatalogCategory}
            onBuild={beginPlacement} onPlanResearch={chooseResearchTarget}
            onUpgradeHq={() => navigateGuide('upgrade_hq')} />
        </section>
        </div>}
        {subsections.build === 'expeditions' && <div data-section-panel="build-expeditions">
{expeditionsLocked && !artifactExpeditionFocus ? <FeatureUnlock feature="expeditions" busy={busy} onResearch={chooseResearchTarget} /> : <ExpeditionsPanel key={planOwner}
          expeditions={game.expeditions} resources={s} hqLevel={Number(s.hq_level)}
          completedResearch={game.research?.completed} researchGoal={researchScienceGoal}
          featureEnabled={game.flags?.expeditions !== false} busy={busy}
          accessUnlocked={!expeditionsLocked} artifactFocus={artifactExpeditionFocus}
          onArtifacts={(artifactId) => {
            navigateGuide('artifacts');
            if (artifactId) {
              navigationToTop.current = false;
              setArtifactCollection({ owner: planOwner, artifactId, requestId: ++artifactCollectionVersion.current });
            }
          }}
          capacities={{
            ore: Math.max(0, Number(game.caps?.ore ?? 0) - Number(game.escrow?.ore ?? 0)),
            energy: Math.max(0, Number(game.caps?.energy ?? 0) - Number(game.escrow?.energy ?? 0)),
            parts: Math.max(0, Number(game.caps?.parts ?? 0) - Number(game.escrow?.parts ?? 0)),
          }}
          onStart={async (expeditionKey) => {
            try { return await api('/api/game/expedition/start', { expeditionKey }); }
            catch (error) { setMessage(''); throw error; }
          }}
          onResolve={async (expeditionId, choiceId) => {
            try { return await api('/api/game/expedition/resolve', { expeditionId, choiceId }); }
            catch (error) { setMessage(''); throw error; }
          }}
          onBuild={() => (game.buildings ?? []).some((building: any) => building.type === 'expedition_center') ? navigateGuide('building:expedition_center') : beginPlacement('expedition_center', 'Центр экспедиций')}
          onUpgradeHq={() => navigateGuide('upgrade_hq')}
          onResearch={(key) => navigateGuide(key ? `research:${key}` : 'research')}
          onRefresh={() => { void refresh(); }}
        />}
        </div>}
        {subsections.build === 'artifacts' && <div data-section-panel="build-artifacts">
<ArtifactsPanel key={planOwner} artifacts={game.expeditions?.artifacts} artifactFocus={artifactCollectionFocus} onExpeditions={() => navigateGuide('expeditions')} onAchievements={() => openAchievements('exploration')}
  routeCatalog={game.expeditions?.catalog} accessUnlocked={!expeditionsLocked} featureEnabled={game.flags?.expeditions !== false} onRefresh={() => { void refresh(); }}
  onShowRoute={(routeKey, artifactId) => {
    navigateGuide('expeditions');
    navigationToTop.current = false;
    setArtifactExpedition({ owner: planOwner, routeKey, artifactId, requestId: ++artifactExpeditionVersion.current });
  }} />
        </div>}
      </>}

      {tab === 'market' && <div data-section-panel={`market-${subsections.market}`}>{marketLocked && subsections.market !== 'mine' ? <FeatureUnlock feature="market" busy={busy} onResearch={chooseResearchTarget} /> : <MarketPanel
        key={planOwner} market={game.market} view={subsections.market as 'buy' | 'sell' | 'mine' | 'prices'}
        tradeHub={(game.buildings ?? []).find((building: any) => building.type === 'trade_hub' && building.status === 'active') ?? (game.buildings ?? []).find((building: any) => building.type === 'trade_hub')}
        resources={s} userId={String(game.userId ?? '')} featureEnabled={game.flags?.market !== false} busy={busy}
        capacities={{ ore: Math.max(0, Number(game.caps?.ore ?? 0) - Number(game.escrow?.ore ?? 0)), energy: Math.max(0, Number(game.caps?.energy ?? 0) - Number(game.escrow?.energy ?? 0)), parts: Math.max(0, Number(game.caps?.parts ?? 0) - Number(game.escrow?.parts ?? 0)) }}
        onCreate={async (body) => { try { return await api('/api/market/order/create', body); } catch (error) { setMessage(''); throw error; } }}
        onBuy={async (body) => { try { return await api('/api/market/order/buy', body); } catch (error) { setMessage(''); throw error; } }}
        onCancel={async (orderId) => { try { return await api('/api/market/order/cancel', { orderId }); } catch (error) { setMessage(''); throw error; } }}
        onOwnOrders={() => showSectionFromGuide('market', 'mine')}
        onBuild={() => (game.buildings ?? []).some((building: any) => building.type === 'trade_hub') ? navigateGuide('building:trade_hub') : beginPlacement('trade_hub', 'Торговый узел')} onRefresh={() => { void refresh(); }}
      />}</div>}

      {tab === 'missions' && <>
        {subsections.missions === 'daily' && <div data-section-panel="missions-daily">
          <DailyLoginPanel key={planOwner} dailyLogin={game.dailyLogin} resetsAt={game.questPeriods?.daily?.resetsAt} busy={busy}
            onClaim={async () => { try { return await api('/api/game/daily-login/claim'); } catch (error) { setMessage(''); throw error; } }}
            onRefresh={() => { void refresh(); }} />
          <QuestPanel key={planOwner + ':daily'} period="daily" quests={game.dailyQuests ?? []} catalog={game.dailyQuestCatalog ?? []} resetsAt={game.questPeriods?.daily?.resetsAt} busy={busy}
            onClaim={async (selection) => { try { const data = await api('/api/game/quests/claim', selection); return data.result; } catch (error) { setMessage(''); throw error; } }}
            onNavigate={navigateGuide} onRefresh={() => { void refresh(); }} />
        </div>}
        {subsections.missions === 'weekly' && <div data-section-panel="missions-weekly">
          <QuestPanel key={planOwner + ':weekly'} period="weekly" quests={game.weeklyQuests ?? []} catalog={game.weeklyQuestCatalog ?? []} resetsAt={game.questPeriods?.weekly?.resetsAt} busy={busy}
            onClaim={async (selection) => { try { const data = await api('/api/game/quests/claim', selection); return data.result; } catch (error) { setMessage(''); throw error; } }}
            onNavigate={navigateGuide} onRefresh={() => { void refresh(); }} />
        </div>}
        {subsections.missions === 'achievements' && <div data-section-panel="missions-achievements">
          <AchievementsPanel key={planOwner} rows={achievementRows} cosmetics={game.shopCosmetics ?? []} busy={busy} focusCategory={achievementFocus.category} focusRequestId={achievementFocus.requestId}
            onClaim={async (achievementKey) => { try { await api('/api/game/achievements/claim', { achievementKey }); } catch (error) { setMessage(''); throw error; } }}
            onOpenCollection={() => { openSection('shop'); showSection('shop', 'collection'); }} />
        </div>}
        {subsections.missions === 'season' && <div data-section-panel="missions-season">
          <SeasonPanel key={planOwner + ':' + (game.season?.id ?? 'none')} season={game.season} busy={busy}
            onClaim={async (selection) => { try { const data = await api('/api/season/claim', selection); return data.result; } catch (error) { setMessage(''); throw error; } }}
            onNavigate={(nextTab, section) => { openSection(nextTab); showSection(nextTab, section); }}
            onRefresh={() => { void refresh(); }} />
        </div>}
      </>}

      {tab === 'shop' && <div data-section-panel={`shop-${subsections.shop}`}><CosmeticsShop key={planOwner} view={subsections.shop as 'offers' | 'collection'}
        cosmetics={game.cosmetics ?? []} shopCosmetics={game.shopCosmetics ?? []}
        busy={busy || invoiceOpen} starsEnabled={game.flags?.stars_shop !== false}
        awaitingProducts={awaitingProducts}
        premium={!!s.premium} premiumUntil={s.premium_until} crystals={Number(s.crystals ?? 0)}
        crystalCheckRequired={crystalPurchaseChecks.has(planOwner)}
        onBuy={buyStars}
        onOpenCollection={() => showSectionFromGuide('shop', 'collection')}
        onOpenMap={() => { openSection('city'); showSection('city', 'map'); }}
        onOpenDecor={() => { openSection('city'); showSection('city', 'decor'); }}
        onAchievements={() => openAchievements()}
        onEquip={async (cosmeticId, equipped = true) => {
          try { await api('/api/shop/equip', { cosmeticId, equipped }); }
          catch (error) { setMessage(''); throw error; }
        }}
        onPremiumCrystals={async () => {
          const owner = planOwner;
          if (settingsOwner.current !== owner) throw new Error('Профиль изменился. Открой магазин заново.');
          if (crystalPurchaseChecksRef.current.has(owner)) throw new Error('Сначала обнови данные и проверь результат предыдущей покупки.');
          try { await api('/api/shop/premium-crystals'); }
          catch (error) { requireCrystalCheck(owner, true); setMessage(''); throw error; }
        }}
        onRefresh={async () => {
          const owner = planOwner;
          try {
            if (settingsOwner.current !== owner) throw new Error('Профиль изменился. Открой магазин заново.');
            await api('/api/session');
            if (settingsOwner.current !== owner) throw new Error('Профиль изменился. Открой магазин заново.');
            requireCrystalCheck(owner, false);
          } catch (error) { setMessage(''); throw error; }
        }}
        onRecover={async () => {
          const owner = planOwner;
          try {
            const receipt = await recoverShopPurchases({
              recover: () => api('/api/payments/recover'),
              refresh: () => api('/api/session'),
              isCurrentOwner: () => settingsOwner.current === owner,
            });
            if (receipt.stateUpdated && settingsOwner.current === owner) requireCrystalCheck(owner, false);
            setMessage('');
            return receipt;
          }
          catch (error) { setMessage(''); throw error; }
        }}
      /></div>}
      {tab === 'social' && <>
        {subsections.social === 'profile' && <div data-section-panel="social-profile">
          <ColonyProfilePanel key={planOwner} colonyName={game.profile?.colony_name || 'Твоя колония'} bio={game.profile?.profile_bio || ''}
            draft={{ colonyName: profileDraftSource.current?.owner === planOwner ? profileName : game.profile?.colony_name || 'Твоя колония', bio: profileDraftSource.current?.owner === planOwner ? profileBio : game.profile?.profile_bio || '' }}
            onDraftChange={draft => { setProfileName(draft.colonyName); setProfileBio(draft.bio); }}
            cosmetics={game.cosmetics ?? []} hqLevel={Number(s.hq_level)} cityScore={Number(s.city_score)} premium={!!s.premium} busy={busy}
            onSave={async draft => {
              try {
                const data = await api('/api/profile/update', draft);
                if (settingsOwner.current === planOwner && data.ok === true && typeof data.profile?.colony_name === 'string'
                  && (data.profile.profile_bio === null || typeof data.profile.profile_bio === 'string')) {
                  setProfileName(data.profile.colony_name); setProfileBio(data.profile.profile_bio ?? '');
                }
                return data;
              } catch (error) { setMessage(''); throw error; }
            }}
            onOpenCollection={() => { openSection('shop'); showSection('shop', 'collection'); }} />
        </div>}
        {subsections.social === 'alliance' && <div data-section-panel="social-alliance">
          <AlliancePanel key={planOwner} alliance={game.alliance} cooperation={game.alliance?.cooperation} resources={s} hqLevel={Number(s.hq_level)} telegramId={game.telegramUser?.id} busy={busy} enabled={game.flags?.alliances !== false} initialCode={allianceCode}
            onShare={shareAlliance} onViewCity={viewCity} onRefresh={() => { void refresh(); }} onNavigate={navigateGuide}
            onDirectorySearch={async (query, page) => { try { return (await api('/api/alliance/directory', { query, page })).directory; } catch (error) { setMessage(''); throw error; } }}
            onAction={async (path, body) => { try { return await api(path, body); } catch (error) { setMessage(''); throw error; } }} />
        </div>}
        {subsections.social === 'rating' && <div data-section-panel="social-rating">
          <AllianceCompetitionPanel key={planOwner} state={game.alliance?.competition} currentAllianceId={game.alliance?.membership ? game.alliance?.alliance?.id : null} onOpenAlliance={() => navigateGuide('alliance')} onOpenCollection={() => { openSection('shop'); showSection('shop', 'collection'); }} busy={busy} onRefresh={() => { void refresh(); }} onClaim={async periodId => { try { return await api('/api/alliance/competition/claim', { periodId }); } catch (error) { setMessage(''); throw error; } }} />
<details className="card"><summary>История Первого сигнала · без призового зачёта</summary><h2><GameIcon name="trophy" />Рейтинг I сезона</h2><div className="leaderboardColumns"><div><h3>Игроки</h3>{(game.alliance?.playerLeaderboard??[]).slice(0,10).map((p:any,i:number)=><div className="leaderRow" key={p.telegram_id}><span>{i+1}</span><b>{p.colony_name||p.first_name||p.username||p.telegram_id}</b><em>{n(p.points)} SP · <span className="interfaceIconLabel"><GameIcon name="city" size={12} title="Рейтинг города" />{n(p.city_score)}</span></em></div>)}</div><div><h3>Альянсы</h3>{(game.alliance?.allianceLeaderboard??[]).slice(0,10).map((a:any,i:number)=><div className="leaderRow" key={a.id}><span>{i+1}</span><b>{a.name}</b><em>{n(a.points)} AP · <span className="interfaceIconLabel"><GameIcon name="star" size={12} title="Престиж альянса" />{n(a.prestige)}</span></em></div>)}</div></div><p className="finePrint">Исторический рейтинг сохранён. Призы недельной лиги рассчитываются отдельно по новому вкладу в совместную добычу.</p></details>
        </div>}
        {subsections.social === 'friends' && <div data-section-panel="social-friends">
          <ReferralsPanel key={planOwner} program={game.referralProgram} busy={busy} inviteLink={botAppLink(process.env.NEXT_PUBLIC_BOT_USERNAME, playerStartParam('ref', game.telegramUser?.id))} betaRequired={game.access?.betaRequired} onShare={shareReferral} onViewCity={viewCity} onAchievements={() => openAchievements('friends')} onUpgradeHq={() => navigateGuide('upgrade_hq')} onRefresh={() => { void refresh(); }} onClaim={async () => { try { const data = await api('/api/referrals/claim'); return data.result; } catch (error) { setMessage(''); throw error; } }} />
        {viewedCity && <section className="card publicCity" ref={publicCityRef}><div className="cardTitleRow"><div><ColonyIdentity name={viewedCity.colony_name || viewedCity.first_name || viewedCity.username || 'Колония'} cosmetics={(viewedCity.cosmetics ?? []).map((item: any) => ({ ...item, equipped: true }))} /><p>Центр ур. {viewedCity.hq_level} · Рейтинг города {n(viewedCity.city_score)} · Комфорт {n(viewedCity.comfort?.score ?? calculateComfort(viewedCity.decor ?? []).score)}/100{viewedCity.premium ? ' · Premium' : ''}</p></div><button className="miniButton" onClick={()=>setViewedCity(null)}>Закрыть</button></div>
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
        </div>}
        {subsections.social === 'inbox' && <div data-section-panel="social-inbox">
          <InboxPanel key={planOwner} initialInbox={game.inbox} busy={busy}
            onLoadPage={async (query) => { try { const data = await api('/api/inbox/list', query); return data.inboxPage; } catch (error) { setMessage(''); throw error; } }}
            onRead={async (ids) => { try { const data = await api('/api/inbox/read', { ids }); return data.inbox ?? data.inboxCounts; } catch (error) { setMessage(''); throw error; } }} />
        </div>}
        {subsections.social === 'settings' && <div data-section-panel="social-settings">
        <ColonyGuideEntry onOpen={() => setHelpOpen(true)} />
        <AudioSettings />
        <NotificationSettings key={planOwner + ':notifications'} preferences={game.notifications} available={game.flags?.notifications !== false} busy={busy}
          onChange={async enabled => {
            try {
              const data = await api('/api/settings/notifications', { enabled });
              setGame((old: any) => String(old?.userId ?? old?.telegramUser?.id ?? '') === planOwner ? { ...old, notifications: data.notifications } : old);
              return data.notifications;
            } catch (error) { setMessage(''); throw error; }
          }} onRefresh={() => { void refresh(); }} />
        <FeedbackPanel key={planOwner + ':feedback'} category={feedbackCategory} message={feedbackMessage} onCategoryChange={setFeedbackCategory} onMessageChange={setFeedbackMessage} busy={busy}
          onSend={async body => {
            try {
              const data = await api('/api/feedback', { ...body, context: { tab, version: game?.version } });
              if (settingsOwner.current === planOwner && data.ok === true && typeof data.id === 'string' && data.id) {
                setFeedbackMessage(current => current === body.message ? '' : current);
              }
              return data;
            } catch (error) { setMessage(''); throw error; }
          }}
          onOpenInbox={() => showSection('social', 'inbox')} />
        </div>}
      </>}

      {tab==='social' && subsections.social === 'admin' && game.admin && <section className="card adminCard" data-section-panel="social-admin">
        <div className="cardTitleRow"><div><h2><GameIcon name="settings" />Закрытый тест · Admin</h2><p>Только агрегированные метрики и сигналы подозрительной активности. Автобанов нет.</p></div><button className="miniButton" disabled={busy} onClick={loadAdminDashboard}>Обновить</button></div>
        {!adminDashboard ? <button className="action secondary" disabled={busy} onClick={loadAdminDashboard}>Загрузить метрики</button> : <>
          <div className="socialStats"><div><b>{n(adminDashboard.users?.total)}</b><span>игроков</span></div><div><b>{n(adminDashboard.users?.active_24h)}</b><span>активны 24ч</span></div><div><b>{n(adminDashboard.users?.new_24h)}</b><span>новых 24ч</span></div></div>
          <div className="socialStats"><div><b><GameIcon name="star" size={15} /> {n(adminDashboard.monetization?.stars_7d)}</b><span>Stars 7д</span></div><div><b>{n(adminDashboard.market?.trades_24h)}</b><span>сделок 24ч</span></div><div><b><GameAmount resource="credits">{n(adminDashboard.market?.fee_sink_24h)}</GameAmount></b><span>списано комиссий</span></div></div>
          <div className="socialStats"><div><b>{n(adminDashboard.errors?.errors_24h)}</b><span>ошибок 24ч</span></div><div><b>{n(adminDashboard.errors?.client_errors_24h)}</b><span>client errors</span></div><div><b>{(adminDashboard.featureFlags??[]).filter((f:any)=>f.enabled).length}</b><span>flags включено</span></div></div>
          <div className="stack"><b>Feature flags</b>{(adminDashboard.featureFlags??[]).map((f:any)=><div className="rowCard" key={f.flag_key}><div><strong>{f.flag_key}</strong><small>{f.description} · rollout {f.rollout_percent}%</small></div><button className="miniButton" disabled={busy} onClick={()=>api('/api/admin/feature-flag',{key:f.flag_key,enabled:!f.enabled,rolloutPercent:f.rollout_percent}).then(()=>loadAdminDashboard()).catch(()=>{})}>{f.enabled?'ON':'OFF'}</button></div>)}</div>
          <div className="stack adminOps"><b>Доступ и обслуживание</b>{(adminDashboard.systemSettings??[]).map((x:any)=><div className="rowCard" key={x.setting_key}><div><strong>{x.setting_key}</strong><small>{x.value?.enabled?'включено':'выключено'}</small></div><button className="miniButton" disabled={busy} onClick={()=>api('/api/admin/system-setting',{key:x.setting_key,enabled:!x.value?.enabled,message:x.value?.message}).then(()=>loadAdminDashboard()).catch(()=>{})}>{x.value?.enabled?'ON':'OFF'}</button></div>)}<div className="rowCard"><div><strong>Beta-коды</strong><small>доступов {n(adminDashboard.beta?.access_count)} · активных кодов {n(adminDashboard.beta?.active_codes)}</small></div><button className="miniButton" disabled={busy} onClick={()=>api('/api/admin/beta-code',{maxUses:25,expiresDays:30,label:'phone-beta'}).then((d:any)=>{setAdminGeneratedCode(d.code);setMessage('Beta-код создан')}).catch(()=>{})}>+ код ×25</button></div>{adminGeneratedCode&&<div className="generatedCode"><b>{adminGeneratedCode}</b><small>Показывается только сейчас — скопируй и отправь тестерам.</small></div>}</div>
          {(adminDashboard.feedback?.length??0)>0&&<div className="stack"><b>Последняя обратная связь</b>{adminDashboard.feedback.slice(0,10).map((f:any)=><div className="rowCard" key={f.id}><div><strong>{f.category} · {f.colony_name||f.username||f.telegram_id}</strong><small>{f.message}</small></div></div>)}</div>}
          <p>D1-когорта: {n(adminDashboard.d1?.returned_next_day)}/{n(adminDashboard.d1?.cohort)} · медиана City Score {n(adminDashboard.economy?.median_city_score)}.</p>
          <div className="stack"><b>Воронка обучения</b>{(adminDashboard.tutorial??[]).map((x:any)=><div className="rowCard" key={x.tutorial_step}><div><strong>Шаг {x.tutorial_step}</strong><small>{x.users} игроков</small></div></div>)}</div>
          {(adminDashboard.suspicious?.length??0)>0&&<div className="stack"><b><GameIcon name="info" size={16} className="interfaceActionIcon" />Высокая активность за час</b>{adminDashboard.suspicious.map((x:any)=><div className="rowCard" key={x.telegram_id}><div><strong>{x.username||x.first_name||x.telegram_id}</strong><small>{x.signal}: {x.value} — только сигнал для ручной проверки</small></div></div>)}</div>}
        </>}
      </section>}

      <nav className="tabs">
        {([{ key:'city', label:'Город', icon:'city' }, { key:'build', label:'Развитие', icon:'research' }, { key:'market', label:'Рынок', icon:'market' }, { key:'missions', label:'Задания', icon:'missions' }, { key:'shop', label:'Магазин', icon:'shop' }, { key:'social', label:'Связи', icon:'social' }] as const).map((item) => <button key={item.key} className={`tab ${tab===item.key?'active':''}`} aria-current={tab===item.key?'page':undefined} aria-label={item.key === 'market' && marketLocked ? 'Рынок. Открывается исследованием' : undefined} onClick={()=>openSection(item.key)}><span className="navigationIcon" aria-hidden="true"><GameIcon name={item.icon} size={22} />{item.key === 'market' && marketLocked && <span className="navigationLock"><GameIcon name="lock" size={10} /></span>}</span><span>{item.label}</span></button>)}
      </nav>
    </main>
  );
}
