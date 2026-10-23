import { registerHooks } from 'node:module';
import { extname } from 'node:path';

// Match the Node 22 test helpers: pure TS modules use extensionless imports.
registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith('.') && !extname(specifier) && context.parentURL?.endsWith('.ts') ? `${specifier}.ts` : specifier, context);
} });

const { BUILDINGS, HQ_UPGRADES, cityGridSize } = await import('../lib/game/config.ts');
const { passiveRate, storageCaps, upgradeCost, buildTimeSec, upgradeTimeSec } = await import('../lib/game/economy.ts');
const { quoteFoundry, foundryQueueCapacity } = await import('../lib/game/foundry.ts');
const { RESEARCH_TREE, sciencePerHour, productionMultipliers } = await import('../lib/game/research.ts');
const { SEASON_EVENT_POINTS, SEASON_REWARDS } = await import('../lib/game/season.ts');
const { ACHIEVEMENTS, DAILY_QUESTS, WEEKLY_QUESTS } = await import('../lib/game/progression.ts');
const { DAILY_LOGIN_REWARDS } = await import('../lib/game/daily-login.ts');
const { SUPPLY_PROJECTS } = await import('../lib/game/supply-projects.ts');
const { EXPEDITIONS, artifactDropChance } = await import('../lib/game/expeditions.ts');

const round = value => Math.round(value * 1e6) / 1e6;
const ratio = (amount, rate) => rate > 0 ? round(amount / rate) : null;
const sum = (rows, key) => rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
const mean = values => values.reduce((total, value) => total + value, 0) / values.length;
const costs = rows => Object.fromEntries(['ore', 'energy', 'parts', 'credits'].map(key => [key, sum(rows, key)]));
const currency = rows => ({ credits: sum(rows, 'credits'), crystals: sum(rows, 'crystals') });
const none = new Set();
const research = key => {
  const config = RESEARCH_TREE.find(item => item.key === key);
  if (!config) throw new Error(`Missing research config: ${key}`);
  return config;
};

const starterRates = { ore: passiveRate('mine', 1).perHour, energy: passiveRate('solar', 1).perHour, credits: 0, science: 0 };
const batch = quoteFoundry({ level: 1, mode: 'standard', link: 'ore', cycles: foundryQueueCapacity(1) });
const oneCycle = quoteFoundry({ level: 1, mode: 'standard', link: 'ore', cycles: 1 });
const batchHours = batch.seconds / 3600;
const refill = { ore: ratio(batch.ore, starterRates.ore), energy: ratio(batch.energy, starterRates.energy) };
const newVsUpgrade = ['mine', 'research_lab'].map(type => {
  const rate = level => type === 'research_lab' ? sciencePerHour([level], none) : passiveRate(type, level).perHour;
  const initial = rate(1), improved = rate(2);
  return {
    type,
    newLevel1: { cost: BUILDINGS[type].baseBuildCost, seconds: buildTimeSec(type), addedRatePerHour: initial, additionalCells: 1, oreOnlyPaybackHours: type === 'mine' ? ratio(BUILDINGS[type].baseBuildCost.ore, initial) : null },
    upgradeLevel1To2: { cost: upgradeCost(type, 1), seconds: upgradeTimeSec(type, 2), resultingRatePerHour: improved, addedRatePerHour: round(improved - initial), additionalCells: 0, oreOnlyPaybackHours: type === 'mine' ? ratio(upgradeCost(type, 1).ore, improved - initial) : null },
  };
});
const extraction = research('extraction_ai');
const extractionBonus = productionMultipliers(new Set(['extraction_ai'])).ore - 1;
const thermal = research('thermal_recovery');
const thermalCycle = quoteFoundry({ level: 1, mode: 'standard', link: 'ore', cycles: 1, partsMultiplier: productionMultipliers(new Set(['thermal_recovery'])).foundryParts });
const extraParts = thermalCycle.cycleParts - oneCycle.cycleParts;
const thermalCycles = extraParts > 0 ? Math.ceil((thermal.cost.parts ?? 0) / extraParts) : null;
const daily = currency(DAILY_QUESTS), weekly = currency(WEEKLY_QUESTS), login = currency(DAILY_LOGIN_REWARDS);

// These formulas are not exported by the server. Keep the literal formulas and
// uniform integer ranges visible in the report so drift can be reviewed.
const npcHq = 3;
const npcOreAmounts = Array.from({ length: 100 }, (_, roll) => 220 + npcHq * 80 + roll);
const npcPartsAmounts = Array.from({ length: 20 }, (_, roll) => 35 + npcHq * 15 + roll);
const npcOreRewards = npcOreAmounts.map(amount => Math.round(amount * (2.7 + npcHq * 0.12)));
const npcPartsRewards = npcPartsAmounts.map(amount => Math.round(amount * (18 + npcHq * 1.5)));
const builder = ACHIEVEMENTS.find(item => item.key === 'builder_10000');
const builderLayout = [
  { type: 'hq', level: 6, count: 1 }, { type: 'mine', level: 8, count: 20 },
  { type: 'solar', level: 8, count: 20 }, { type: 'habitat', level: 8, count: 15 },
  { type: 'warehouse', level: 8, count: 4 }, { type: 'foundry', level: 8, count: 2 },
  { type: 'trade_hub', level: 8, count: 2 },
];
const builderCaps = storageCaps(builderLayout.filter(row => row.type === 'warehouse').flatMap(row => Array(row.count).fill(row.level)));
const builderEvents = builderLayout.reduce((total, row) => total + row.count * (row.level - (row.type === 'hq' ? 1 : 0)), 0) - 3;
const builderFinalCostsFit = builderLayout.every(row => {
  const cost = row.type === 'hq' ? HQ_UPGRADES[row.level]?.cost : upgradeCost(row.type, row.level - 1);
  return cost && row.level <= BUILDINGS[row.type].maxLevel && ['ore', 'energy', 'parts'].every(key => (cost[key] ?? 0) <= builderCaps[key]);
});
const supply = SUPPLY_PROJECTS.map(project => ({
  key: project.id, version: project.version,
  requirements: costs(project.stages.map(stage => stage.requirements)),
  rewards: { ...currency(project.stages.map(stage => stage.reward)), science: sum(project.stages.map(stage => stage.reward), 'science'), cosmeticIds: project.stages.flatMap(stage => stage.reward.cosmeticIds) },
}));

const report = {
  metadata: {
    formatVersion: 1, readonly: true, deterministic: true,
    inputs: [
      'lib/game/config.ts', 'lib/game/economy.ts', 'lib/game/foundry.ts', 'lib/game/research.ts',
      'lib/game/season.ts', 'lib/game/progression.ts', 'lib/game/daily-login.ts', 'lib/game/supply-projects.ts', 'lib/game/expeditions.ts',
    ],
    mirroredServerInputs: ['lib/server/game.ts: ensurePlayer starter buildings and ensureNpcContracts formulas'],
    assumptions: [
      'Pure configuration calculations: no environment, credentials, network, database, runtime, saved city or filesystem writes.',
      'Starter production means one active level-one mine and one active level-one solar; the initial HQ and warehouse produce no credits or science. No Premium or research bonuses unless stated.',
      'Foundry example: level one, standard alloy, standard speed, ore adjacency, six empty queue slots. Refill assumes ongoing producers, no storage clipping or competing spending; it is not a player completion-time simulation.',
      'New versus upgrade rates are marginal gains after completion. Upgrade downtime and mixed resource prices are not included in resource-only comparisons.',
      'Research science accumulation uses one active laboratory at that research required lab level, with basic_theory already completed. Research costs, prerequisites and duration remain separate from accumulation estimates.',
      'Seven-day grants assume every daily and weekly quest completed and seven consecutive login rewards claimed; relevant gates, actual spending and return visits still apply.',
      'Builder construction is a static feasibility witness: three initially provided non-HQ levels and HQ level one emit no construction event. Renewable inputs can fund costs over time; no minimum-time route is claimed.',
      'NPC expectations enumerate all uniform integer random rolls and apply Math.round to each reward. At most two ore contracts and one parts contract are issued per rolling six hours; no P2P price is assumed.',
      'Expedition averages are base rewards per launch, before optional events or research multipliers. Artifact probabilities are independent random rolls, not guarantees.',
    ],
  },
  starter: {
    ratesPerHour: starterRates, capsWithOneLevel1Warehouse: storageCaps([1]),
    oreLinkedStandardQueue: {
      cycles: foundryQueueCapacity(1), ...batch,
      refillFromDebitHours: refill,
      refillStillNeededAfterBatchHours: { ore: round(Math.max(0, refill.ore - batchHours)), energy: round(Math.max(0, refill.energy - batchHours)) },
      sustainedPartsPerHourWithStarterInputs: round(Math.min(starterRates.ore / oneCycle.ore, starterRates.energy / oneCycle.energy, 3600 / oneCycle.cycleSeconds) * oneCycle.cycleParts),
    },
  },
  newVsUpgrade,
  research: {
    extraction: {
      key: extraction.key, labLevel: extraction.labLevel, science: extraction.science, cost: extraction.cost, seconds: extraction.timeSec, prerequisites: extraction.prereqs,
      scienceAccumulationHoursAtRequiredLab: ratio(extraction.science, sciencePerHour([extraction.labLevel], new Set(['basic_theory']))),
      extraOrePerHour: { oneLevel1Mine: round(starterRates.ore * extractionBonus), sevenLevel1Mines: round(starterRates.ore * 7 * extractionBonus) },
      roiLimit: 'No total payback is claimed: extra ore cannot be priced against science, credits and parts without an explicit conversion model. Fractional passive ore is retained by server carry.',
    },
    thermal: {
      key: thermal.key, labLevel: thermal.labLevel, science: thermal.science, cost: thermal.cost, seconds: thermal.timeSec, prerequisites: thermal.prereqs,
      scienceAccumulationHoursAtRequiredLab: ratio(thermal.science, sciencePerHour([thermal.labLevel], new Set(['basic_theory']))),
      level1PartsPerCycle: { before: oneCycle.cycleParts, after: thermalCycle.cycleParts, extra: extraParts },
      partsOnlyPayback: {
        cycles: thermalCycles,
        oreConsumed: thermalCycles === null ? null : thermalCycles * oneCycle.ore,
        energyConsumed: thermalCycles === null ? null : thermalCycles * oneCycle.energy,
        machineHours: thermalCycles === null ? null : ratio(thermalCycles * oneCycle.cycleSeconds, 3600),
        starterMineRefillHours: thermalCycles === null ? null : ratio(thermalCycles * oneCycle.ore, starterRates.ore),
        scope: 'Only replaces the research parts cost through extra output from cycles that are actually paid and run; does not recover credits, science, energy, ore or research duration.',
      },
    },
  },
  season: {
    marketWeights: Object.fromEntries(['market_order_created', 'market_trade_bought', 'market_trade_sold'].map(key => [key, SEASON_EVENT_POINTS[key] ?? 0])),
    thresholds: SEASON_REWARDS.map(reward => reward.points), totalRewards: currency(SEASON_REWARDS),
    cosmetics: SEASON_REWARDS.filter(reward => reward.cosmeticId).map(reward => ({ id: reward.cosmeticId, days: reward.cosmeticDays ?? null })),
  },
  builder: {
    key: builder?.key, target: builder?.target, reward: builder?.reward,
    witness: { layout: builderLayout, cells: sum(builderLayout, 'count'), mapCells: cityGridSize(6) ** 2, constructionEvents: builderEvents, caps: builderCaps, finalUpgradeCostsFit: builderFinalCostsFit, reachesTarget: builder ? builderEvents >= builder.target : false },
  },
  sevenDayGrants: { dailyQuestsPerDay: daily, weeklyQuests: weekly, loginCycle: login, total: { credits: daily.credits * 7 + weekly.credits + login.credits, crystals: daily.crystals * 7 + weekly.crystals + login.crystals } },
  npcHq3: {
    source: 'Mirrored from ensureNpcContracts in lib/server/game.ts; not dynamically imported or queried.',
    formulas: {
      oreAmount: '220 + hqLevel * 80 + floor(random * 100)', oreReward: 'round(amount * (2.7 + hqLevel * 0.12))',
      partsAmount: '35 + hqLevel * 15 + floor(random * 20)', partsReward: 'round(amount * (18 + hqLevel * 1.5))',
    },
    hqLevel: npcHq, batchHours: 6, contractsPerBatch: { ore: 2, parts: 1 },
    ore: { amountRange: [npcOreAmounts[0], npcOreAmounts.at(-1)], expectedAmountEach: mean(npcOreAmounts), expectedCreditsEach: round(mean(npcOreRewards)) },
    parts: { amountRange: [npcPartsAmounts[0], npcPartsAmounts.at(-1)], expectedAmount: mean(npcPartsAmounts), expectedCredits: round(mean(npcPartsRewards)) },
    expectedBatchCredits: round(2 * mean(npcOreRewards) + mean(npcPartsRewards)),
  },
  supplyProjects: { projects: supply, totalRequirements: costs(supply.map(project => project.requirements)), totalRewards: { ...currency(supply.map(project => project.rewards)), science: sum(supply.map(project => project.rewards), 'science') }, finite: true },
  expeditions: EXPEDITIONS.map(route => ({
    key: route.key, seconds: route.durationSec, cost: route.cost, unlockHq: route.unlockHq, requiredResearch: route.requiredResearch ?? null,
    expectedBasePerLaunch: {
      ore: mean(route.reward.ore ?? [0, 0]), credits: mean(route.reward.credits ?? [0, 0]), science: mean(route.reward.science ?? [0, 0]),
      crystals: round((route.reward.crystalsChance ?? 0) * mean(route.reward.crystals ?? [0, 0])),
    },
    anyArtifactChance: route.artifactChance, quantumLensChance: round(artifactDropChance(route.key, 'quantum_lens')),
  })),
};

console.log(JSON.stringify(report, null, 2));
