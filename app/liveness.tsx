'use client';
import { FaceLivenessDetectorCore } from '@aws-amplify/ui-react-liveness';
import '@aws-amplify/ui-react/styles.css';
export default function Liveness({session,api,complete,onError}:{session:Record<string,any>;api:(path:string,body?:unknown)=>Promise<any>;complete:()=>Promise<void>;onError:(message:string)=>void}){
 return <FaceLivenessDetectorCore sessionId={session.sessionId} region={session.region} onAnalysisComplete={complete} onUserCancel={()=>onError('Camera check cancelled. You can try again whenever you’re ready.')} onError={()=>onError('The camera check could not finish. Allow camera access in browser settings, then try again. After three attempts, request manual approval.')} config={{credentialProvider:async()=>{const r=await api('face/credentials',{proof:session.proof});return {...r.credentials,expiration:new Date(r.credentials.expiration)};}}}/>;
}
