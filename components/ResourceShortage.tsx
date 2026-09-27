type Props = {
  cost?: Record<string, number> | null;
  resources: Record<string, unknown>;
};

const labels: Record<string, string> = {
  ore: 'руды', energy: 'энергии', parts: 'деталей',
  credits: 'кредитов', science: 'науки', crystals: 'кристаллов',
};

export function ResourceShortage({ cost, resources }: Props) {
  const missing = Object.entries(cost ?? {}).flatMap(([resource, required]) => {
    const deficit = Math.ceil(Number(required) - Number(resources[resource] ?? 0));
    return deficit > 0 ? [`${deficit.toLocaleString('ru-RU')} ${labels[resource] ?? resource}`] : [];
  });
  if (!missing.length) return null;
  return <div className="resourceShortage">Не хватает: {missing.join(', ')}.</div>;
}
