import {authBaseUrl} from './auth-urls';
type Environment=Record<string,string|undefined>;

export function invitationUrl(token:string,env:Environment=process.env){
 const url=new URL('/',authBaseUrl(env));url.searchParams.set('invite',token);return url.href;
}
