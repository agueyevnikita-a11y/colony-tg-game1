import type { Transaction } from './db';

/** Check each request so recipes become available immediately after migration. */
export async function recipeSchemaReady(tx: Transaction): Promise<boolean> {
  const rows = await tx<{ ready: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema=current_schema()
        AND table_name='foundry_jobs'
        AND column_name='recipe_key'
    ) AS ready
  `;
  return rows[0]?.ready === true;
}
