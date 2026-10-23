export const ALLIANCE_DIRECTORY_PAGE_SIZE = 5;
export const ALLIANCE_DIRECTORY_MAX_QUERY_LENGTH = 64;
export const ALLIANCE_DIRECTORY_MAX_PAGE = 99;

export type AllianceDirectoryRequest = { query: string; page: number };
export type AllianceDirectoryItem = {
  id: string;
  name: string;
  code: string;
  members: number;
  memberLimit: number;
  modules7d: number;
  contributors7d: number;
  operation: null | { endsAt: string; participants: number; roles: string[] };
};
export type AllianceDirectoryState = AllianceDirectoryRequest & {
  items: AllianceDirectoryItem[];
  hasMore: boolean;
};

export function parseAllianceDirectoryRequest(input: unknown): AllianceDirectoryRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Укажи параметры поиска альянса');
  const body = input as Record<string, unknown>;
  const query = body.query === undefined ? '' : body.query;
  const page = body.page === undefined ? 0 : body.page;
  if (typeof query !== 'string' || query.length > ALLIANCE_DIRECTORY_MAX_QUERY_LENGTH) {
    throw new Error(`Поиск — не более ${ALLIANCE_DIRECTORY_MAX_QUERY_LENGTH} символов`);
  }
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 0 || page > ALLIANCE_DIRECTORY_MAX_PAGE) {
    throw new Error('Некорректная страница каталога альянсов');
  }
  return { query: query.trim(), page };
}

/** A player's query is a literal substring, never a PostgreSQL LIKE expression. */
export function allianceDirectorySearchPattern(query: string) {
  return `%${query.replace(/[\\%_]/g, '\\$&')}%`;
}
