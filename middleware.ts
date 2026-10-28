import {NextRequest,NextResponse} from 'next/server';
import {authBaseUrl} from './lib/auth-urls';

// Supabase can fall back to Site URL and return ?code= at the root. Complete
// that PKCE exchange before rendering the landing page or loading its assets.
export function middleware(req:NextRequest){
 const params=req.nextUrl.searchParams,code=params.get('code');
 if(!code||params.has('error')||params.has('error_code')||params.has('auth_error'))return NextResponse.next();
 const target=new URL('/api/auth/callback',authBaseUrl());
 target.searchParams.set('code',code);
 target.searchParams.set('flow',params.get('flow')==='recovery'?'recovery':'signin');
 const invite=params.get('invite');if(invite&&/^[\w-]{1,100}$/.test(invite))target.searchParams.set('invite',invite);
 const response=NextResponse.redirect(target);
 response.headers.set('Cache-Control','no-store');response.headers.set('Referrer-Policy','no-referrer');
 return response;
}
export const config={matcher:['/']};
