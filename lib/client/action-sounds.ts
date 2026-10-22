const BUILD_ACTIONS = new Set(['/api/game/build', '/api/game/building/upgrade']);
const SUCCESS_ACTIONS = new Set([
  '/api/game/building/move', '/api/game/contracts/complete', '/api/game/daily-login/claim',
  '/api/game/decor/place', '/api/game/decor/move', '/api/game/decor/remove',
  '/api/game/event/resolve', '/api/game/expedition/start', '/api/game/expedition/resolve',
  '/api/game/foundry/start', '/api/game/quests/claim', '/api/game/research/start',
  '/api/game/tutorial/claim', '/api/game/achievements/claim', '/api/season/claim',
  '/api/referrals/claim', '/api/market/order/create', '/api/market/order/buy',
  '/api/market/order/cancel', '/api/shop/equip', '/api/shop/premium-crystals',
]);

/** Server-confirmed game actions only; sessions, reads and invoices stay silent. */
export function actionSound(path: string, background = false): 'build' | 'success' | null {
  if (background) return null;
  if (BUILD_ACTIONS.has(path)) return 'build';
  return SUCCESS_ACTIONS.has(path) ? 'success' : null;
}
