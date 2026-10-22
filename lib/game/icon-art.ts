export const ICON_ATLASES = {
  resources: { src: '/art/resource-icons-v112.webp', png: '/art/resource-icons-v112.png', width: 1536, height: 1024 },
  navigation: { src: '/art/navigation-icons-v112.webp', png: '/art/navigation-icons-v112.png', width: 1536, height: 1024 },
  activities: { src: '/art/activity-icons-v112.webp', png: '/art/activity-icons-v112.png', width: 1254, height: 1254 },
} as const;

type AtlasKey = keyof typeof ICON_ATLASES;
type Viewport = readonly [number, number, number, number];
type IconSpec = { atlas: AtlasKey; viewport: Viewport };

/** Measured isolated viewports, not uniform cells: antennas and folded corners vary. */
export const LUNAR_ICONS = {
  ore: { atlas: 'resources', viewport: [68, 120, 426, 369] },
  energy: { atlas: 'resources', viewport: [609, 48, 317, 434] },
  parts: { atlas: 'resources', viewport: [1060, 75, 416, 415] },
  credits: { atlas: 'resources', viewport: [68, 558, 428, 379] },
  crystals: { atlas: 'resources', viewport: [606, 523, 353, 442] },
  science: { atlas: 'resources', viewport: [1133, 522, 277, 445] },
  city: { atlas: 'navigation', viewport: [42, 95, 506, 423] },
  research: { atlas: 'navigation', viewport: [589, 64, 379, 442] },
  market: { atlas: 'navigation', viewport: [1049, 102, 434, 399] },
  missions: { atlas: 'navigation', viewport: [55, 552, 448, 422] },
  shop: { atlas: 'navigation', viewport: [592, 533, 352, 437] },
  social: { atlas: 'navigation', viewport: [1031, 559, 472, 378] },
  map: { atlas: 'activities', viewport: [28, 213, 264, 205] },
  foundry: { atlas: 'activities', viewport: [367, 200, 248, 226] },
  contracts: { atlas: 'activities', viewport: [660, 205, 259, 222] },
  events: { atlas: 'activities', viewport: [996, 188, 222, 246] },
  decor: { atlas: 'activities', viewport: [25, 559, 287, 230] },
  rocket: { atlas: 'activities', viewport: [380, 537, 220, 259] },
  trophy: { atlas: 'activities', viewport: [690, 555, 201, 240] },
  mail: { atlas: 'activities', viewport: [973, 562, 261, 239] },
  network: { atlas: 'activities', viewport: [28, 924, 287, 221] },
  comfort: { atlas: 'activities', viewport: [349, 893, 268, 258] },
  build: { atlas: 'activities', viewport: [672, 921, 250, 226] },
  help: { atlas: 'activities', viewport: [960, 942, 268, 209] },
} as const satisfies Record<string, IconSpec>;

export function lunarIconByName(name: unknown) {
  if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(LUNAR_ICONS, name)) return null;
  const spec = LUNAR_ICONS[name as keyof typeof LUNAR_ICONS];
  return { ...ICON_ATLASES[spec.atlas], viewport: spec.viewport };
}
