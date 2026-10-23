export const ARTIFACT_ART = {
  signal_fragment: { src: '/art/artifact-signal-fragment-v1141.webp', width: 512, height: 512, iconName: 'artifact_shard' },
  alloy_core: { src: '/art/artifact-alloy-core-v1141.webp', width: 512, height: 512, iconName: 'artifact_core' },
  stellar_map: { src: '/art/artifact-stellar-map-v1141.webp', width: 512, height: 512, iconName: 'artifact_beacon' },
  quantum_lens: { src: '/art/artifact-quantum-lens-v1141.webp', width: 512, height: 512, iconName: 'artifact_lens' },
} as const;

export function artifactArtById(id: unknown) {
  if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(ARTIFACT_ART, id)) return null;
  return ARTIFACT_ART[id as keyof typeof ARTIFACT_ART];
}

export function artifactArtByIcon(name: unknown) {
  if (typeof name !== 'string') return null;
  return Object.values(ARTIFACT_ART).find((art) => art.iconName === name) ?? null;
}

export const ARTIFACT_RARITY_LABELS: Record<string, string> = {
  common: 'Обычный', uncommon: 'Необычный', rare: 'Редкий', epic: 'Эпический',
};

export type ArtifactCollectionEntry = { id: string; count: number | string };

export function artifactCollectionCounts(entries: readonly ArtifactCollectionEntry[] | undefined) {
  const counts = new Map<string, number>();
  for (const entry of entries ?? []) {
    if (!artifactArtById(entry.id)) continue;
    const count = Number(entry.count);
    if (Number.isSafeInteger(count) && count >= 0) counts.set(entry.id, count);
  }
  const ids = Object.keys(ARTIFACT_ART);
  const unique = ids.filter((id) => (counts.get(id) ?? 0) > 0).length;
  return { counts, unique, total: ids.length };
}
