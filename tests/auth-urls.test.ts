import test from 'node:test';
import assert from 'node:assert/strict';
import {authBaseUrl} from '../lib/auth-urls';

test('deployed authentication links use Render HTTPS when APP_URL is missing or still localhost',()=>{
 const render='https://timecard-y77q.onrender.com';
 assert.equal(authBaseUrl({NODE_ENV:'production',RENDER_EXTERNAL_URL:render}),render);
 assert.equal(authBaseUrl({NODE_ENV:'production',APP_URL:'http://localhost:3000',RENDER_EXTERNAL_URL:render}),render);
});
test('configured custom origin is retained and normalized for callbacks',()=>{
 assert.equal(authBaseUrl({NODE_ENV:'production',APP_URL:' https://time.example.com/ ',RENDER_EXTERNAL_URL:'https://timecard-y77q.onrender.com'}),'https://time.example.com');
});
test('production authentication cannot generate localhost or insecure reset links',()=>{
 for(const env of [{},{APP_URL:'http://localhost:3000'},{APP_URL:'http://time.example.com'},{APP_URL:'not-a-url'},{APP_URL:'https://user:password@time.example.com'}])assert.throws(()=>authBaseUrl({NODE_ENV:'production',...env}),/APP_URL/);
});
test('local development retains localhost callbacks',()=>{
 assert.equal(authBaseUrl({NODE_ENV:'development'}),'http://localhost:3000');
 assert.equal(authBaseUrl({NODE_ENV:'development',APP_URL:'http://localhost:3118'}),'http://localhost:3118');
});
