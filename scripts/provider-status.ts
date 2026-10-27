import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());
const {paystack}=await import('../lib/billing');
const has=(name:string)=>!!process.env[name];
console.log('AWS liveness configuration:',has('AWS_REGION')&&has('AWS_LIVENESS_ROLE_ARN')?'present; live camera test required':'incomplete');
console.log('Email configuration:',has('EMAIL_API_KEY')&&has('EMAIL_FROM')?'present':'not configured; development outbox active');
console.log('Enterprise SSO configuration:',has('OIDC_ISSUER')&&has('OIDC_CLIENT_ID')&&has('OIDC_CLIENT_SECRET')&&has('OIDC_WORKSPACE_ID')?'present':'not configured');
try{await paystack('plan?perPage=1');console.log('Paystack: test key authenticated. No payment was initiated.');}catch(e){console.log('Paystack:',(e as Error).message);process.exitCode=1;}
