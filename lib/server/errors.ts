import { sql, type JsonValue } from '@/lib/server/db';

export async function logErrorEvent(input: { userId?: string | null; source: string; error: unknown; context?: Record<string, JsonValue> }) {
  try {
    const err = input.error instanceof Error ? input.error : new Error(String(input.error));
    await sql`
      INSERT INTO error_events(user_id,source,message,stack,context)
      VALUES(${input.userId ?? null},${input.source},${err.message.slice(0,1000)},${err.stack?.slice(0,8000) ?? null},${sql.json(input.context ?? {})})
    `;
  } catch {
    // Error telemetry must never break gameplay.
  }
}
