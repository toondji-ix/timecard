import type { NextConfig } from 'next';
const config:NextConfig={distDir:process.env.NEXT_DIST_DIR||'.next',serverExternalPackages:['better-sqlite3','@aws-sdk/client-rekognition','@aws-sdk/client-sts','exceljs'],webpack(config){config.cache=false;return config;},async headers(){return [{source:'/:path*',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},{key:'X-Frame-Options',value:'DENY'},{key:'Permissions-Policy',value:'camera=(self), geolocation=(self), microphone=()'}]}];}};
export default config;
