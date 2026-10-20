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
