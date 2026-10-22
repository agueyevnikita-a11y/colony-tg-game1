import { BUILDINGS } from './config';
import { DECOR_CATALOG } from './decor';

export type AppearanceKind = 'building' | 'decor';
export type AppearanceObject = { key: string; kind: AppearanceKind; type: string; name: string };

// Derive coverage from the playable catalogs, including future object types.
export const APPEARANCE_OBJECTS: readonly AppearanceObject[] = [
  ...Object.entries(BUILDINGS).map(([type, item]) => ({ key: `building:${type}`, kind: 'building' as const, type, name: item.name })),
  ...Object.entries(DECOR_CATALOG).map(([type, item]) => ({ key: `decor:${type}`, kind: 'decor' as const, type, name: item.name })),
];

export const APPEARANCE_PAGE_SIZE = 6;
const CITY_STYLES = new Set(['theme_neon', 'theme_first_signal']);

export function isCityStyle(value: unknown): value is string {
  return typeof value === 'string' && CITY_STYLES.has(value);
}

export function cityStyleClass(value: unknown) {
  return isCityStyle(value) ? value : '';
}

export function appearancePage(kind: AppearanceKind, requestedPage: number) {
  const objects = APPEARANCE_OBJECTS.filter(item => item.kind === kind);
  const pages = Math.max(1, Math.ceil(objects.length / APPEARANCE_PAGE_SIZE));
  const page = Number.isFinite(requestedPage) ? Math.max(0, Math.min(pages - 1, Math.floor(requestedPage))) : 0;
  return { items: objects.slice(page * APPEARANCE_PAGE_SIZE, (page + 1) * APPEARANCE_PAGE_SIZE), page, pages, total: objects.length };
}
