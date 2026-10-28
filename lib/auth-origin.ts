type AuthRequest={headers:Headers;nextUrl:{origin:string}};

function originOf(value:string|undefined){
 if(!value)return null;
 try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.origin:null;}catch{return null;}
}

// Render terminates HTTPS before forwarding to Node, whose request URL can use
// an internal HTTP origin. Trust server configuration, not forwarded headers.
export function validAuthOrigin(req:AuthRequest,env:{APP_URL?:string;RENDER_EXTERNAL_URL?:string}={APP_URL:process.env.APP_URL,RENDER_EXTERNAL_URL:process.env.RENDER_EXTERNAL_URL}){
 if(req.headers.get('sec-fetch-site')==='cross-site')return false;
 const supplied=req.headers.get('origin');
 if(supplied===null)return true; // Non-browser clients may omit Origin.
 const origin=originOf(supplied);
 if(!origin||origin!==supplied)return false;
 return [req.nextUrl.origin,originOf(env.APP_URL),originOf(env.RENDER_EXTERNAL_URL)].includes(origin);
}
