type Environment=Record<string,string|undefined>;
export const missingSupabaseMessage='Supabase authentication is not configured on this server. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in Render Environment, then redeploy.';

// Read the server environment at request time. Direct NEXT_PUBLIC_* references
// are frozen by Next.js at build time and can miss deployment-time settings.
export function supabaseConfig(env:Environment=process.env){
 const first=(names:string[])=>names.map(name=>env[name]?.trim()).find(Boolean);
 const url=first(['SUPABASE_URL','NEXT_PUBLIC_SUPABASE_URL']);
 const key=first(['SUPABASE_PUBLISHABLE_KEY','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','SUPABASE_ANON_KEY','NEXT_PUBLIC_SUPABASE_ANON_KEY']);
 if(!url&&!key)return null;
 if(!url||!key)throw Error(missingSupabaseMessage);
 let parsed:URL;try{parsed=new URL(url);}catch{throw Error('The Supabase project URL is invalid. Check the authentication environment settings.');}
 if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password)throw Error('The Supabase project URL is invalid.');
 return {url:parsed.href.replace(/\/$/,''),key};
}

export function useSupabaseAuth(env:Environment=process.env){
 if(supabaseConfig(env))return true;
 if(env.NODE_ENV==='production')throw Error(missingSupabaseMessage);
 return false; // Legacy local auth is restricted to development/tests.
}
