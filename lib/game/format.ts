/** Round a displayed wait up, then split its total minutes so units never overflow. */
export function durationText(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 сек.';
  if (seconds < 60) return `${Math.ceil(seconds)} сек.`;

  const totalMinutes = Math.ceil(seconds / 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor(totalMinutes % 1440 / 60);
  const minutes = totalMinutes % 60;
  return [days ? `${days} д.` : '', hours ? `${hours} ч.` : '', minutes ? `${minutes} мин.` : '']
    .filter(Boolean).join(' ');
}
