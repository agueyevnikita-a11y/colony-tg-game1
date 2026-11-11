import type postgres from 'postgres';

export type AccountErasureBlocker = { code: string; count: number };
export type AccountErasureInspection = {
  userId: string;
  exists: boolean;
  counts: Record<string, number>;
  blockers: AccountErasureBlocker[];
  categories: string[];
};
export type AccountErasureResult = {
  counts: Record<string, number>;
  categories: string[];
};

export declare class AccountErasureBlockedError extends Error {
  readonly blockers: AccountErasureBlocker[];
  readonly inspection: AccountErasureInspection;
  constructor(inspection: AccountErasureInspection);
}

export declare function inspectAccountErasure(
  tx: postgres.Sql | postgres.TransactionSql,
  userId: string,
  adminTelegramIds?: number[],
): Promise<AccountErasureInspection>;

export declare function eraseAccountData(
  tx: postgres.TransactionSql,
  userId: string,
  adminTelegramIds?: number[],
): Promise<AccountErasureResult>;
