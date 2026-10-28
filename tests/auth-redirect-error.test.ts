import test from 'node:test';
import assert from 'node:assert/strict';
import {authRedirectError} from '../lib/auth-redirect-error';

test('Google provider server errors are recognized in query strings and URL fragments',()=>{
 for(const [search,hash] of [['?error=server_error&error_code=unexpected_failure',''],['','#error=server_error&error_code=unexpected_failure']])assert.match(authRedirectError(search,hash)!,/Supabase Auth logs/);
});
test('provider code-exchange failures give credential guidance without exposing authorization codes',()=>{
 const message=authRedirectError('','#error=server_error&error_code=unexpected_failure&error_description=Unable+to+exchange+external+code%3A+SECRET_AUTHORIZATION_CODE')!;
 assert.match(message,/Client ID and Client Secret/);assert.ok(!message.includes('SECRET_AUTHORIZATION_CODE'));
});
test('database errors are identified without displaying raw database details',()=>{
 const message=authRedirectError('?error=server_error&error_code=unexpected_failure&error_description=Database+error+saving+new+user%3A+PRIVATE_DETAILS')!;
 assert.match(message,/database triggers/);assert.ok(!message.includes('PRIVATE_DETAILS'));
});
test('expired email links, denied sign-ins and application errors remain distinct',()=>{
 assert.match(authRedirectError('','#error=access_denied&error_code=otp_expired')!,/expired/);
 assert.match(authRedirectError('?error=access_denied')!,/cancelled or denied/);
 assert.equal(authRedirectError('?auth_error=Please+sign+in'), 'Please sign in');
});
test('successful auth and unrelated page parameters do not produce errors',()=>{
 for(const query of ['','?auth=verified','?code=valid-authorization-code','?billing=return'])assert.equal(authRedirectError(query),null);
});
