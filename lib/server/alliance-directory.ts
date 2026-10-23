import {
  ALLIANCE_DIRECTORY_MAX_PAGE, ALLIANCE_DIRECTORY_PAGE_SIZE, allianceDirectorySearchPattern,
  parseAllianceDirectoryRequest, type AllianceDirectoryState,
} from '@/lib/game/alliance-directory';
import { allianceCooperationSchemaReady } from '@/lib/server/alliance-cooperation';

/** Public alliance aggregates only: never return identities or individual balances. */
export async function getAllianceDirectory(tx: any, input: unknown = {}): Promise<AllianceDirectoryState> {
  const { query, page } = parseAllianceDirectoryRequest(input);
  const pattern = allianceDirectorySearchPattern(query);
  const cooperationReady = await allianceCooperationSchemaReady(tx);
  // Aggregate membership, activity and the live operation independently so their
  // joins cannot multiply either member counts or paid contribution counts.
  const activity = cooperationReady ? tx`
    SELECT o.alliance_id,count(c.id)::int AS modules7d,count(DISTINCT c.user_id)::int AS contributors7d
    FROM alliance_cooperation_operations o
    JOIN alliance_cooperation_contributions c ON c.operation_id=o.id
    WHERE c.created_at>=now()-interval '7 days' AND c.created_at<=now()
    GROUP BY o.alliance_id
  ` : tx`SELECT NULL::uuid AS alliance_id,0::int AS modules7d,0::int AS contributors7d WHERE false`;
  const operations = cooperationReady ? tx`
    SELECT o.alliance_id,o.ends_at,
      count(DISTINCT c.user_id) FILTER(WHERE c.created_at<=now())::int AS participants,
      COALESCE(array_agg(DISTINCT c.role ORDER BY c.role)
        FILTER(WHERE c.role IS NOT NULL AND c.created_at<=now()),ARRAY[]::text[]) AS roles
    FROM alliance_cooperation_operations o
    LEFT JOIN alliance_cooperation_contributions c ON c.operation_id=o.id
    WHERE o.status='active' AND o.started_at<=now() AND o.ends_at>now()
    GROUP BY o.alliance_id,o.ends_at
  ` : tx`SELECT NULL::uuid AS alliance_id,NULL::timestamptz AS ends_at,0::int AS participants,ARRAY[]::text[] AS roles WHERE false`;
  const rows = await tx`
    WITH members AS (
      SELECT alliance_id,count(*)::int AS members FROM alliance_members GROUP BY alliance_id
    ), activity AS (${activity}), operation AS (${operations})
    SELECT a.id,a.name,a.code,a.member_limit,COALESCE(m.members,0)::int AS members,
      COALESCE(p.modules7d,0)::int AS modules7d,COALESCE(p.contributors7d,0)::int AS contributors7d,
      o.ends_at AS operation_ends_at,o.participants AS operation_participants,o.roles AS operation_roles
    FROM alliances a
    LEFT JOIN members m ON m.alliance_id=a.id
    LEFT JOIN activity p ON p.alliance_id=a.id
    LEFT JOIN operation o ON o.alliance_id=a.id
    WHERE COALESCE(m.members,0)<a.member_limit
      AND (a.name ILIKE ${pattern} ESCAPE ${'\\'} OR a.code ILIKE ${pattern} ESCAPE ${'\\'})
    ORDER BY COALESCE(p.modules7d,0) DESC,COALESCE(p.contributors7d,0) DESC,
      COALESCE(m.members,0) DESC,a.created_at ASC,a.id ASC
    LIMIT ${ALLIANCE_DIRECTORY_PAGE_SIZE + 1} OFFSET ${page * ALLIANCE_DIRECTORY_PAGE_SIZE}
  `;
  return { query, page, hasMore: page < ALLIANCE_DIRECTORY_MAX_PAGE && rows.length > ALLIANCE_DIRECTORY_PAGE_SIZE,
    items: rows.slice(0, ALLIANCE_DIRECTORY_PAGE_SIZE).map((row: any) => ({
      id: row.id, name: row.name, code: row.code, members: Number(row.members), memberLimit: Number(row.member_limit),
      modules7d: Number(row.modules7d), contributors7d: Number(row.contributors7d),
      operation: row.operation_ends_at ? { endsAt: new Date(row.operation_ends_at).toISOString(),
        participants: Number(row.operation_participants), roles: row.operation_roles } : null,
    })) };
}
