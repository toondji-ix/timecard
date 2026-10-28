// Provider fragments are visible only to the browser. Return bounded messages,
// never raw provider descriptions (which can contain authorization codes).
export function authRedirectError(search:string,hash=''){
 const query=new URLSearchParams(search),fragment=new URLSearchParams(hash.replace(/^#/,''));
 const appError=query.get('auth_error');if(appError)return appError.slice(0,500);
 const params=query.has('error')||query.has('error_code')?query:fragment;
 if(!params.has('error')&&!params.has('error_code'))return null;
 const code=params.get('error_code'),description=params.get('error_description')||'';
 if(code==='otp_expired')return 'This email link has expired or has already been used. Request a new email and open only the newest link.';
 if(code==='unexpected_failure'||params.get('error')==='server_error'){
  if(/unable to exchange external code/i.test(description))return 'Google sign-in could not be completed by the authentication service. Ask your administrator to check that the Google Client ID and Client Secret in Supabase belong to the same OAuth client.';
  if(/database error/i.test(description))return 'The authentication service could not save your account. Ask your administrator to check Supabase Auth logs and database triggers.';
  return 'The authentication service returned a server error (unexpected_failure). Ask your administrator to check the failed Google callback in Supabase Auth logs.';
 }
 if(params.get('error')==='access_denied')return 'Sign-in was cancelled or denied by the authentication provider. Please try again.';
 return 'The authentication provider could not complete sign-in. Please try again or contact your administrator.';
}
