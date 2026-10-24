type Ownership = {
  cosmetic_id?: string;
  id?: string;
  name?: string;
  category?: string;
  expires_at?: string | Date | null;
  acquired_at?: string | Date;
  equipped?: boolean;
};
type Cosmetic = { id: string; name?: string; category?: string };

export type CosmeticInventoryItem = {
  id: string;
  name: string;
  category: string;
  expiresAt: string | null;
  equipped: boolean;
  appliedExpiresAt: string | null | undefined;
  needsLongerApplication: boolean;
};

function timestamp(value: string | Date | undefined) {
  const time = value instanceof Date ? value.getTime() : Date.parse(value ?? '');
  return Number.isFinite(time) ? time : 0;
}

/** Ownership duration and the currently applied copy are separate facts. */
export function cosmeticInventory(rows: readonly Ownership[], catalog: readonly Cosmetic[] = [], now = Date.now()): CosmeticInventoryItem[] {
  if (!Number.isFinite(now)) return [];
  const descriptions = new Map(catalog.map(item => [item.id, item]));
  type Copy = { row: Ownership; expiresAt: string | null; until: number; acquired: number };
  const groups = new Map<string, Copy[]>();
  for (const row of rows) {
    const id = row.cosmetic_id ?? row.id;
    if (typeof id !== 'string' || !id.trim()) continue;
    const expiresAt = row.expires_at == null ? null : row.expires_at instanceof Date ? (Number.isFinite(row.expires_at.getTime()) ? row.expires_at.toISOString() : '') : row.expires_at;
    const until = expiresAt === null ? Infinity : Date.parse(expiresAt);
    if (!(until > now)) continue;
    const copy = { row, expiresAt, until, acquired: timestamp(row.acquired_at) };
    groups.set(id, [...(groups.get(id) ?? []), copy]);
  }
  const prefer = (left: Copy, right: Copy) => left.until === right.until ? right.acquired - left.acquired : left.until > right.until ? -1 : 1;
  return [...groups].map(([id, copies]) => {
    copies.sort(prefer);
    const best = copies[0];
    const applied = copies.find(copy => copy.row.equipped);
    const description = descriptions.get(id);
    return {
      id,
      name: best.row.name || description?.name || 'Предмет коллекции',
      category: best.row.category || description?.category || 'other',
      expiresAt: best.expiresAt,
      equipped: !!applied,
      appliedExpiresAt: applied?.expiresAt,
      needsLongerApplication: !!applied && best.until > applied.until,
    };
  }).sort((left, right) => left.category.localeCompare(right.category) || left.name.localeCompare(right.name, 'ru') || left.id.localeCompare(right.id));
}
