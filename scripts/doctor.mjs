import './env.mjs';
import { runDoctor } from './launch-tools.mjs';

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--local')) {
  console.error('Usage: npm run doctor -- [--local]');
  process.exitCode = 1;
} else {
  const result = await runDoctor({ local: args.includes('--local') });
  for (const check of result.checks) console.log(`${check.ok ? 'OK' : 'FAIL'} ${check.name}${check.message ? `: ${check.message}` : ''}`);
  for (const warning of result.warnings) console.log(`NOTE ${warning}`);
  console.log(result.ok ? 'COLONY doctor: checks passed.' : 'COLONY doctor: launch checks failed.');
  if (!result.ok) process.exitCode = 1;
}
