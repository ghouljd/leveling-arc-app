import {db} from './storage';
import {supabase} from './supabase';
import {synchronizeStore} from './sync-engine';
let running:Promise<string>|null=null;
export function synchronize():Promise<string>{
 if(running)return running;
 running=synchronizeStore(db,supabase).finally(()=>{running=null;});return running;
}
