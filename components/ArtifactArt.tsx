import { artifactArtById } from '@/lib/game/artifact-art';
import { GameIcon } from '@/components/GameIcon';
import '@/app/artifacts.css';

export function ArtifactArt({ artifactId, size = 64, unknown = false, title }: {
  artifactId: string; size?: number; unknown?: boolean; title?: string;
}) {
  const art = artifactArtById(artifactId);
  if (!art) return <GameIcon name="artifact_shard" size={size} title={title} />;
  return <span className={`artifactArt${unknown ? ' isUndiscovered' : ''}`} style={{ width: size, height: size }}
    data-artifact-art={artifactId} aria-hidden={title ? undefined : true} aria-label={title} role={title ? 'img' : undefined}>
    <img src={art.src} width={art.width} height={art.height} alt="" decoding="async" />
  </span>;
}
