export type InboxFilter = 'all' | 'unread';

export type InboxItem = {
  id: string;
  kind: string;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

export type InboxPageQuery = {
  filter?: InboxFilter;
  limit?: number;
  cursor?: string | null;
};

export type InboxPage = {
  items: InboxItem[];
  /** All active messages, including messages outside this page. */
  total: number;
  unread: number;
  matchingTotal: number;
  filter: InboxFilter;
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
};

/** Reject incomplete replies before they can replace the page a player is reading. */
export function isInboxPage(value: unknown): value is InboxPage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const page = value as Partial<InboxPage>;
  const count = (number: unknown) => typeof number === 'number' && Number.isSafeInteger(number) && number >= 0;
  return Array.isArray(page.items) && page.items.length <= 5 && page.items.every(item => item && typeof item === 'object'
    && typeof item.id === 'string' && item.id.length > 0 && typeof item.kind === 'string'
    && typeof item.title === 'string' && typeof item.body === 'string'
    && item.metadata !== null && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
    && typeof item.created_at === 'string' && Number.isFinite(Date.parse(item.created_at))
    && (item.read_at === null || typeof item.read_at === 'string' && Number.isFinite(Date.parse(item.read_at))))
    && count(page.total) && count(page.unread) && count(page.matchingTotal)
    && page.limit === 5 && (page.filter === 'all' || page.filter === 'unread')
    && typeof page.hasMore === 'boolean' && (page.nextCursor === null || typeof page.nextCursor === 'string');
}

export function inboxMessageAppearance(kind: unknown) {
  if (kind === 'purchase') return { icon: 'shop', label: 'Покупка' };
  if (kind === 'reward') return { icon: 'gift', label: 'Награда' };
  if (kind === 'milestone') return { icon: 'trophy', label: 'Развитие' };
  if (kind === 'colony_event') return { icon: 'events', label: 'Событие' };
  return { icon: 'mail', label: 'Сообщение' };
}
