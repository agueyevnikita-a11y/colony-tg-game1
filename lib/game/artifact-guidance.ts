import { artifactCollectionCounts, type ArtifactCollectionEntry } from './artifact-art';
import { ARTIFACTS, EXPEDITIONS, artifactDropChance } from './expeditions';

export type ArtifactRouteAccess = { key: string; unlocked?: boolean };

/** Collection goals only consider claimed finds. Route advice never authorizes a launch. */
export function artifactCollectionGuidance({ artifacts, selectedArtifactId, routeCatalog, accessUnlocked, featureEnabled }: {
  artifacts?: readonly ArtifactCollectionEntry[];
  selectedArtifactId?: string | null;
  routeCatalog?: readonly ArtifactRouteAccess[];
  accessUnlocked?: boolean;
  featureEnabled?: boolean;
}) {
  const known = Array.isArray(artifacts);
  const safeEntries = known ? artifacts.filter(entry => entry && typeof entry === 'object' && typeof entry.id === 'string'
    && (typeof entry.count === 'number' || typeof entry.count === 'string' && entry.count.trim() !== '')) : [];
  const collection = artifactCollectionCounts(safeEntries);
  const missing = known ? ARTIFACTS.filter(artifact => (collection.counts.get(artifact.id) ?? 0) === 0) : [];
  const selected = missing.find(artifact => artifact.id === selectedArtifactId) ?? missing[0] ?? null;
  const routes = selected ? EXPEDITIONS.flatMap(route => {
    const chance = artifactDropChance(route.key, selected.id);
    if (chance <= 0) return [];
    const matches = Array.isArray(routeCatalog) ? routeCatalog.filter(entry => entry && entry.key === route.key) : [];
    const available = accessUnlocked !== false && featureEnabled !== false && matches.length === 1 && matches[0].unlocked === true;
    return [{ key: route.key, name: route.name, durationSec: route.durationSec, cost: route.cost, chance, available }];
  }).sort((left, right) => left.durationSec - right.durationSec) : [];
  return {
    ...collection,
    state: !known ? 'unknown' as const : missing.length ? 'missing' as const : 'complete' as const,
    missing, selected,
    route: routes.find(route => route.available) ?? routes[0] ?? null,
  };
}
