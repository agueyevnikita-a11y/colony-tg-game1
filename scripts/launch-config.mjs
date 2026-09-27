// Shared by deployment tools and readiness checks. Never put env values in issues.
const placeholder = /replace[_-]?me|replace[_-]?with|change[_-]?me|placeholder|your[_-]|example/i;
const weakPasswords = new Set(['postgres', 'colony', 'password', 'password123', 'secret', 'admin']);

function strongSecret(value) {
  return value.length >= 32 && !placeholder.test(value) && new Set(value).size >= 8;
}

function publicHostname(hostname) {
  const host = hostname.toLowerCase();
  return host.includes('.') && host !== 'localhost' && !host.endsWith('.localhost')
    && !/\.(?:example|invalid|test|local)$/.test(host) && host !== 'example.com'
    && host !== 'example.org' && host !== 'example.net'
    && !/^(?:127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host);
}

export function validateLaunchConfig(env, { production = true } = {}) {
  const issues = [];
  const issue = (key, message) => issues.push({ key, message });
  const value = (key) => typeof env[key] === 'string' ? env[key] : '';
  const required = ['BOT_TOKEN', 'BOT_USERNAME', 'NEXT_PUBLIC_BOT_USERNAME', 'DATABASE_URL', 'APP_URL', 'TELEGRAM_WEBHOOK_SECRET', 'CRON_SECRET', 'ADMIN_TELEGRAM_IDS'];
  for (const key of required) {
    if (!value(key)) issue(key, 'Required; configure this environment variable.');
    else if (value(key) !== value(key).trim()) issue(key, 'Remove surrounding whitespace.');
  }
  const token = value('BOT_TOKEN');
  if (token && (!/^\d{5,16}:[A-Za-z0-9_-]{30,}$/.test(token) || placeholder.test(token))) {
    issue('BOT_TOKEN', 'Use a real bot token from BotFather.');
  }
  for (const key of ['BOT_USERNAME', 'NEXT_PUBLIC_BOT_USERNAME']) {
    const name = value(key);
    if (name && (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(name) || !/bot$/i.test(name) || placeholder.test(name))) {
      issue(key, 'Use the bot username without @ (5–32 characters, ending in bot).');
    }
  }
  if (value('BOT_USERNAME').toLowerCase() !== value('NEXT_PUBLIC_BOT_USERNAME').toLowerCase()) {
    issue('NEXT_PUBLIC_BOT_USERNAME', 'Must match BOT_USERNAME; rebuild after changing this public value.');
  }
  const appUrl = value('APP_URL');
  if (appUrl) {
    try {
      const url = new URL(appUrl);
      if ((production ? url.protocol !== 'https:' : !['https:', 'http:'].includes(url.protocol))
        || url.username || url.password || url.pathname !== '/' || url.search || url.hash
        || (production && (!publicHostname(url.hostname) || !['', '80', '88', '8443'].includes(url.port)))) {
        issue('APP_URL', 'Use a public HTTPS origin without credentials, path, query or fragment (webhook ports: 443, 80, 88, 8443).');
      }
    } catch { issue('APP_URL', 'Use a valid HTTPS origin.'); }
  }
  const dbUrl = value('DATABASE_URL');
  if (dbUrl) {
    try {
      const url = new URL(dbUrl);
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || url.pathname.length < 2 || url.hash) {
        issue('DATABASE_URL', 'Use a PostgreSQL connection URL with a hostname, user and database name.');
      } else if (production && (!url.password || placeholder.test(decodeURIComponent(url.password)) || weakPasswords.has(decodeURIComponent(url.password).toLowerCase()))) {
        issue('DATABASE_URL', 'Set a non-default database password; percent-encode URL special characters.');
      }
    } catch { issue('DATABASE_URL', 'Use a valid PostgreSQL connection URL.'); }
  }
  const webhookSecret = value('TELEGRAM_WEBHOOK_SECRET');
  if (webhookSecret && (!strongSecret(webhookSecret) || !/^[A-Za-z0-9_-]{32,256}$/.test(webhookSecret))) {
    issue('TELEGRAM_WEBHOOK_SECRET', 'Generate a random 32–256 character secret using A–Z, a–z, 0–9, _ and -.');
  }
  const cronSecret = value('CRON_SECRET');
  if (cronSecret && (!strongSecret(cronSecret) || !/^[\x21-\x7e]+$/.test(cronSecret))) {
    issue('CRON_SECRET', 'Generate a random secret of at least 32 printable ASCII characters without spaces.');
  }
  if (webhookSecret && webhookSecret === cronSecret) issue('CRON_SECRET', 'Use a secret different from TELEGRAM_WEBHOOK_SECRET.');
  if (production && value('ALLOW_DEV_AUTH') !== 'false') issue('ALLOW_DEV_AUTH', 'Set explicitly to false for production.');
  const admins = value('ADMIN_TELEGRAM_IDS');
  if (admins && admins.split(',').some((id) => !/^[1-9]\d*$/.test(id.trim()) || !Number.isSafeInteger(Number(id.trim())))) {
    issue('ADMIN_TELEGRAM_IDS', 'Use a comma-separated list of positive integer Telegram user IDs.');
  }
  const support = value('SUPPORT_URL');
  if (support) {
    try {
      const url = new URL(support);
      if (url.protocol !== 'https:' || url.username || url.password || !publicHostname(url.hostname) || support !== support.trim()) {
        issue('SUPPORT_URL', 'Use a public HTTPS support URL without credentials.');
      }
    } catch { issue('SUPPORT_URL', 'Use a valid HTTPS support URL or leave it empty.'); }
  }
  return { ok: issues.length === 0, issues };
}
