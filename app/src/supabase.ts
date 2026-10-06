import { createClient } from '@supabase/supabase-js';
const config=import.meta.env;
export const supabase=createClient(config.VITE_SUPABASE_URL,config.VITE_SUPABASE_PUBLISHABLE_KEY);
