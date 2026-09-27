import { NextResponse } from 'next/server';
import { sql } from '@/lib/server/db';
import { APP_VERSION } from '@/lib/version';
export const runtime='nodejs';
export async function GET(){
  try{
    const settings=await sql<any[]>`SELECT setting_key,value FROM system_settings WHERE setting_key IN ('maintenance','beta_required')`;
    const map=Object.fromEntries(settings.map((x:any)=>[x.setting_key,x.value]));
    return NextResponse.json({ok:true,service:'colony',version:APP_VERSION,database:'ok',maintenance:Boolean(map.maintenance?.enabled),betaRequired:Boolean(map.beta_required?.enabled),time:new Date().toISOString()},{headers:{'Cache-Control':'no-store'}});
  }catch{return NextResponse.json({ok:false,service:'colony',version:APP_VERSION,database:'error'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
