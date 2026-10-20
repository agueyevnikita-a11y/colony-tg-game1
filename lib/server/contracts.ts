import { sql } from './db';
import { recordProgressEvent } from './progression';

export async function completeNpcContract(userId: string, contractId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(contractId)) throw new Error('Контракт не найден');
  return sql.begin(async (tx) => {
    const state = (await tx<any[]>`SELECT * FROM game_states WHERE user_id=${userId} FOR UPDATE`)[0];
    if (!state) throw new Error('Игровой профиль не найден');
    const contract = (await tx<any[]>`
      SELECT *,expires_at>now() AS available FROM npc_contracts
      WHERE id=${contractId} AND user_id=${userId} FOR UPDATE
    `)[0];
    if (!contract) throw new Error('Контракт не найден');
    const resource = contract.resource;
    if (resource !== 'ore' && resource !== 'parts') throw new Error('Условия контракта недоступны');
    const amount = Number(contract.amount), credits = Number(contract.credit_reward);
    const result = { contractId: contract.id as string, resource, amount, credits };
    if (contract.completed_at) return result;
    if (!contract.available) throw new Error('Контракт истёк. Обнови список заказов.');
    if (Number(state[resource]) < amount) throw new Error(`Не хватает ${amount - Number(state[resource])} ${resource === 'ore' ? 'руды' : 'деталей'}`);
    if (resource === 'ore') {
      await tx`UPDATE game_states SET ore=ore-${amount},credits=credits+${credits},updated_at=now() WHERE user_id=${userId}`;
    } else {
      await tx`UPDATE game_states SET parts=parts-${amount},credits=credits+${credits},updated_at=now() WHERE user_id=${userId}`;
    }
    await tx`UPDATE npc_contracts SET completed_at=now() WHERE id=${contract.id}`;
    await recordProgressEvent(tx, userId, 'contract_completed', 1, { resource, amount, credits });
    return result;
  });
}
