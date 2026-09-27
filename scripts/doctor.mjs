import './env.mjs';
import postgres from 'postgres';
const required=['BOT_TOKEN','DATABASE_URL','APP_URL','TELEGRAM_WEBHOOK_SECRET','CRON_SECRET','ADMIN_TELEGRAM_IDS','NEXT_PUBLIC_BOT_USERNAME'];
let failed=false;
for(const key of required){const ok=Boolean(process.env[key]);console.log(`${ok?'✓':'✗'} ${key}`);if(!ok)failed=true;}
if(process.env.DATABASE_URL){
  const sql=postgres(process.env.DATABASE_URL,{max:1,connect_timeout:5});
  try{await sql`SELECT 1`;console.log('✓ PostgreSQL connection');}catch(e){console.error('✗ PostgreSQL connection:',e.message);failed=true;}finally{await sql.end();}
}
if(process.env.BOT_TOKEN){
  try{const r=await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/getMe`);const d=await r.json();if(!d.ok)throw new Error(d.description);console.log(`✓ Telegram bot @${d.result.username}`);}catch(e){console.error('✗ Telegram Bot API:',e.message);failed=true;}
}
if(failed)process.exitCode=1; else console.log('COLONY doctor: all required checks passed.');
