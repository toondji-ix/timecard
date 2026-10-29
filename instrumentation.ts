export async function register(){
 if(process.env.NEXT_RUNTIME==='nodejs'){
  if(process.env.NEXT_PHASE==='phase-production-build'||process.env.TIMECARD_MAINTENANCE==='off')return;
  const {startMaintenance}=await import('./lib/scheduler');await startMaintenance();
 }
}
