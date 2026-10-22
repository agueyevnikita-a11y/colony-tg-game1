import '@/app/city-motion.css';

type Props = { type: string; active?: boolean; kind?: 'building' | 'decor' };
const buildingActivities: Record<string, string> = {
  hq: 'command', mine: 'drill', solar: 'reactor', deep_mine: 'deep-drill', solar_array: 'solar',
  warehouse: 'cargo', foundry: 'furnace', habitat: 'habitat', trade_hub: 'trade', research_lab: 'research',
  logistics: 'cargo', expedition_center: 'expedition', alliance_hub: 'command', observatory: 'observatory',
};
const decorActivities: Record<string, string> = {
  tree: 'bio', park: 'bio', flowerbed: 'hydroponics', lamp: 'beacon', fountain: 'water', plaza: 'signal', statue: 'crystal', bench: 'rest',
};

/** A quiet map overlay. Preferences and visibility are controlled once by the app. */
export function CityActivity({ type, active = true, kind = 'building' }: Props) {
  const catalog = kind === 'decor' ? decorActivities : buildingActivities;
  const activity = Object.hasOwn(catalog, type) ? catalog[type] : null;
  if (!active || !activity) return null;
  return <span className={`cityActivity cityActivity-${activity}`} data-city-activity={activity} data-activity-kind={kind} aria-hidden="true">
    <i className="cityActivityCore" /><i className="cityActivitySweep" /><i className="cityActivityParticle" />
  </span>;
}
