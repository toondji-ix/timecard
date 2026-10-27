import { RekognitionClient,CreateFaceLivenessSessionCommand,GetFaceLivenessSessionResultsCommand,CreateCollectionCommand,IndexFacesCommand,SearchFacesByImageCommand,DeleteFacesCommand } from '@aws-sdk/client-rekognition';
import { STSClient,AssumeRoleCommand } from '@aws-sdk/client-sts';
import { createHash } from 'node:crypto';
export interface FaceVerificationService {
 createSession():Promise<string>;
 enroll(session:string,org:string,uid:string):Promise<string>;
 verify(session:string,org:string,template:string,threshold:number):Promise<number>;
 delete(org:string,template:string):Promise<void>;
}
export const faceConfigured=()=>!!(process.env.AWS_REGION&&process.env.AWS_LIVENESS_ROLE_ARN);
const client=()=>{if(!faceConfigured())throw Error('Face verification needs AWS configuration. Ask your manager to finish setup.');return new RekognitionClient({region:process.env.AWS_REGION});};
const collection=(org:string)=>'timecard-'+createHash('sha256').update(org).digest('hex').slice(0,32);
async function reference(session:string){const r=await client().send(new GetFaceLivenessSessionResultsCommand({SessionId:session}));if(r.Status!=='SUCCEEDED'||(r.Confidence??0)<Number(process.env.LIVENESS_THRESHOLD||95)||!r.ReferenceImage?.Bytes)throw Error('Liveness could not be confirmed. Please try a brighter spot and try again.');return r.ReferenceImage.Bytes;}
export const faceService:FaceVerificationService={
 async createSession(){const r=await client().send(new CreateFaceLivenessSessionCommand({Settings:{AuditImagesLimit:0}}));if(!r.SessionId)throw Error('Camera verification could not start.');return r.SessionId;},
 async enroll(session,org,uid){const bytes=await reference(session),c=client(),CollectionId=collection(org);try{await c.send(new CreateCollectionCommand({CollectionId}));}catch(e){if((e as Error).name!=='ResourceAlreadyExistsException')throw e;}const r=await c.send(new IndexFacesCommand({CollectionId,Image:{Bytes:bytes},ExternalImageId:uid,MaxFaces:1,QualityFilter:'AUTO',DetectionAttributes:['DEFAULT']}));const face=r.FaceRecords?.[0]?.Face?.FaceId;if(!face)throw Error('We could not get a clear face template. Please try again.');return face;},
 async verify(session,org,template,threshold){const bytes=await reference(session);const r=await client().send(new SearchFacesByImageCommand({CollectionId:collection(org),Image:{Bytes:bytes},FaceMatchThreshold:threshold*100,MaxFaces:100}));const match=r.FaceMatches?.find(f=>f.Face?.FaceId===template);if(!match?.Similarity)throw Error('We could not quite recognise you. Try again, or ask your manager to approve.');return match.Similarity/100;},
 async delete(org,template){await client().send(new DeleteFacesCommand({CollectionId:collection(org),FaceIds:[template]}));}
};
export async function livenessCredentials(){if(!faceConfigured())throw Error('Face verification is not configured.');const r=await new STSClient({region:process.env.AWS_REGION}).send(new AssumeRoleCommand({RoleArn:process.env.AWS_LIVENESS_ROLE_ARN,RoleSessionName:'timecard-liveness',DurationSeconds:900,Policy:JSON.stringify({Version:'2012-10-17',Statement:[{Effect:'Allow',Action:'rekognition:StartFaceLivenessSession',Resource:'*'}]})}));const c=r.Credentials;if(!c?.AccessKeyId||!c.SecretAccessKey||!c.SessionToken)throw Error('Camera authorization failed.');return {accessKeyId:c.AccessKeyId,secretAccessKey:c.SecretAccessKey,sessionToken:c.SessionToken,expiration:c.Expiration};}
