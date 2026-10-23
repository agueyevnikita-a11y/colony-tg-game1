export type ContractCompletionReceipt = {
  contractId: string;
  resource: 'ore' | 'parts';
  amount: number;
  credits: number;
};

/** A successful transport alone does not confirm which contract was fulfilled. */
export function contractCompletionReceipt(value: unknown, expectedId: string): ContractCompletionReceipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const reply = value as { ok?: unknown; result?: unknown };
  if (reply.ok !== true || !reply.result || typeof reply.result !== 'object' || Array.isArray(reply.result)) return null;
  const result = reply.result as Partial<ContractCompletionReceipt>;
  if (!expectedId || result.contractId !== expectedId || !['ore', 'parts'].includes(result.resource ?? '')
    || !Number.isSafeInteger(result.amount) || Number(result.amount) <= 0
    || !Number.isSafeInteger(result.credits) || Number(result.credits) < 0) return null;
  return { contractId: expectedId, resource: result.resource as 'ore' | 'parts', amount: result.amount!, credits: result.credits! };
}
