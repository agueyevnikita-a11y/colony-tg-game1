import { NextResponse } from 'next/server';
import { sql } from '@/lib/server/db';
export const runtime='nodejs';
export async function GET(){
  try{
    const settings=await sql<any[]>`SELECT setting_key,value FROM system_settings WHERE setting_key IN ('maintenance','beta_required')`;
    const map=Object.fromEntries(settings.map((x:any)=>[x.setting_key,x.value]));
    return NextResponse.json({ok:true,service:'colony',version:'1.0.1-beta.1',database:'ok',maintenance:Boolean(map.maintenance?.enabled),betaRequired:Boolean(map.beta_required?.enabled),time:new Date().toISOString()});
  }catch{return NextResponse.json({ok:false,service:'colony',version:'1.0.1-beta.1',database:'error'},{status:503});}
}
