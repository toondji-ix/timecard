type Environment=Record<string,string|undefined>;
export function authBaseUrl(env:Environment=process.env){
 const parse=(value:string|undefined)=>{
  if(!value?.trim())return null;
  try{const url=new URL(value.trim());if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error();return url;}catch{throw Error('Set APP_URL to the public HTTPS address of your app.');}
 };
 let url=parse(env.APP_URL),render=parse(env.RENDER_EXTERNAL_URL);
 const local=(value:URL)=>['localhost','127.0.0.1','[::1]'].includes(value.hostname);
 if(!url||(env.NODE_ENV==='production'&&local(url)&&render))url=render;
 if(!url){if(env.NODE_ENV==='production')throw Error('Set APP_URL to the public HTTPS address of your app before requesting authentication emails.');url=new URL('http://localhost:3000');}
 if(env.NODE_ENV==='production'&&(url.protocol!=='https:'||local(url)))throw Error('Set APP_URL to the public HTTPS address of your app.');
 return url.origin;
}
