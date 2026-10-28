import test from 'node:test';
import assert from 'node:assert/strict';
import {validAuthOrigin} from '../lib/auth-origin';

const publicOrigin='https://timecard-y77q.onrender.com';
const request=(headers:Record<string,string>={},origin='http://localhost:10000')=>({headers:new Headers(headers),nextUrl:{origin}});

test('authentication accepts the configured HTTPS origin behind an HTTP proxy',()=>{
 assert.equal(validAuthOrigin(request({origin:publicOrigin}),{APP_URL:publicOrigin+'/'}),true);
 assert.equal(validAuthOrigin(request({origin:publicOrigin}),{APP_URL:'http://localhost:3000',RENDER_EXTERNAL_URL:publicOrigin}),true);
 assert.equal(validAuthOrigin(request({origin:'https://login.example.com'}),{APP_URL:'https://login.example.com',RENDER_EXTERNAL_URL:publicOrigin}),true);
});
test('direct local authentication and non-browser clients still work',()=>{
 assert.equal(validAuthOrigin(request({origin:'http://localhost:10000'}),{}),true);
 assert.equal(validAuthOrigin(request(),{}),true);
});
test('authentication rejects foreign origins even when proxy headers claim otherwise',()=>{
 assert.equal(validAuthOrigin(request({origin:'https://attacker.example','x-forwarded-host':'attacker.example','x-forwarded-proto':'https'}),{APP_URL:publicOrigin}),false);
 assert.equal(validAuthOrigin(request({origin:'https://timecard-y77q.onrender.com.attacker.example'}),{RENDER_EXTERNAL_URL:publicOrigin}),false);
 assert.equal(validAuthOrigin(request({origin:'http://timecard-y77q.onrender.com'}),{APP_URL:publicOrigin}),false);
});
test('authentication rejects opaque and malformed browser origins',()=>{
 for(const origin of ['null','','not a url',publicOrigin+'/path',publicOrigin+'?query=1','https://user:pass@timecard-y77q.onrender.com',publicOrigin+', https://attacker.example']){
  assert.equal(validAuthOrigin(request({origin}),{APP_URL:publicOrigin}),false,origin);
 }
});
test('cross-site browser authentication is blocked with or without an Origin header',()=>{
 assert.equal(validAuthOrigin(request({origin:publicOrigin,'sec-fetch-site':'cross-site'}),{APP_URL:publicOrigin}),false);
 assert.equal(validAuthOrigin(request({'sec-fetch-site':'cross-site'}),{APP_URL:publicOrigin}),false);
});
