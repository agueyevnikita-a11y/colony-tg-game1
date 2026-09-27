import { LaunchToolError, runTelegramSetup } from './launch-tools.mjs';

export async function setupCli({ webhookOnly = false } = {}) {
  const args = process.argv.slice(2);
  const command = webhookOnly ? 'telegram:webhook' : 'telegram:setup';
  if (args.some((arg) => !['--apply', '--dry-run'].includes(arg)) || (args.includes('--apply') && args.includes('--dry-run'))) {
    console.error(`Usage: npm run ${command} -- [--dry-run | --apply]`);
    process.exitCode = 1;
    return;
  }
  try {
    const result = await runTelegramSetup({ apply: args.includes('--apply'), webhookOnly });
    console.log(JSON.stringify(result.plan, null, 2));
    for (const warning of result.warnings) console.log(`NOTE ${warning}`);
    console.log(result.applied ? 'Telegram configuration applied and verified.' : `Dry run: no network calls or changes. To apply: npm run ${command} -- --apply`);
  } catch (error) {
    console.error(error instanceof LaunchToolError ? error.message : 'Telegram setup failed. Check local configuration and retry.');
    if (args.includes('--apply')) console.error('If setup stopped after a Telegram mutation, configuration may be partially applied. Fix the reported problem and rerun --apply.');
    process.exitCode = 1;
  }
}
