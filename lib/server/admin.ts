export function assertAdminTelegramId(telegramId:number) {
  const admins = new Set((process.env.ADMIN_TELEGRAM_IDS ?? '').split(',').map((x)=>Number(x.trim())).filter(Number.isFinite));
  if(!admins.has(Number(telegramId))) throw new Error('Недостаточно прав');
}
