import {createClient} from '@supabase/supabase-js';
function publicClient(){return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false}})}
export async function searchClubs(query:string){if(query.trim().length<2)return [];const {data,error}=await publicClient().rpc('search_clubs',{query:query.trim(),result_limit:12});if(error)throw error;return data??[]}
export async function getClub(slug:string){const {data,error}=await publicClient().from('clubs').select('id,slug,official_name,display_name,city,postal_code,department_code,region_code,claim_status').eq('slug',slug).eq('status','active').maybeSingle();if(error)throw error;return data}
