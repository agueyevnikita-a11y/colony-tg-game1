export type LaunchConfigIssue = { key: string; message: string };
export function validateLaunchConfig(
  env: Record<string, string | undefined>,
  options?: { production?: boolean },
): { ok: boolean; issues: LaunchConfigIssue[] };
