import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {validateConfig,readState} from './lib.mjs';
export const defaults={operation:'create',sourceInstanceUuid:'',copyDataDisk:true,optimizeSparseFiles:true,regionName:'西北B区',gpuModel:'vGPU-32GB',gpuCount:1,maxGpuHourlyCny:1.58,maxDiskDailyCny:0,extraDataDiskGb:0,minGpuMemoryGb:0,minCpuCores:0,minMemoryGb:0,machineIds:[],pollIntervalMs:2000,requestTimeoutMs:15000,createTimeoutMs:30000,imagePreference:'Miniconda',baseImageUuid:''};
export async function initJob(directory,input){
  const c=validateConfig({...defaults,...input});
  await fs.mkdir(directory); // never replace an existing job
  await fs.writeFile(path.join(directory,'config.json'),JSON.stringify(c,null,2)+'\n',{flag:'wx'});
  await fs.writeFile(path.join(directory,'account.json'),JSON.stringify({subUser:input.subUser===true})+'\n',{flag:'wx'});
  return c;
}
async function main(){
  const [command,job,inputFile]=process.argv.slice(2); if(!job)throw new Error('用法：node job.mjs init|start|stop|status JOB [INPUT.json]');
  const directory=path.resolve(job);
  if(command==='init'){await initJob(directory,JSON.parse(await fs.readFile(inputFile,'utf8')));console.log('任务已初始化：'+directory);return;}
  if(command==='stop'){await fs.writeFile(path.join(directory,'stop.request'),'stop\n');console.log('已请求停止；实例及订单状态保留。');return;}
  const c=validateConfig(JSON.parse(await fs.readFile(path.join(directory,'config.json'),'utf8')));
  const state=await readState(directory,c.operation==='clone'?'clone-state.json':'state.json');
  if(command==='status'){console.log(JSON.stringify({config:c,state},null,2));return;}
  if(command!=='start')throw new Error('未知命令');
  let lock;try{lock=JSON.parse(await fs.readFile(path.join(directory,'run.lock'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(lock)throw new Error('已有运行锁；核对PID及命令后再处理。');
  if(state && !['rejected-stock','accepted','cloning'].includes(state.status))throw new Error(`已有${state.status}记录，请先核对，不重复下单。`);
  try{await fs.access(path.join(directory,'stop.request'));throw new Error('任务已请求停止；用户要求恢复时先核对状态并移除stop.request。');}catch(e){if(e.code!=='ENOENT')throw e;}
  await fs.access(path.join(directory,'auth.txt'));
  const mode=state?.instanceUuid?'follow':'buy';
  const script=path.join(path.dirname(fileURLToPath(import.meta.url)),'grab.mjs');
  const out=await fs.open(path.join(directory,'process.out.log'),'a');
  const err=await fs.open(path.join(directory,'process.err.log'),'a');
  try{const child=spawn(process.execPath,[script,mode,'--job',directory],{cwd:directory,detached:true,windowsHide:true,stdio:['ignore',out.fd,err.fd]});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});console.log(JSON.stringify({pid:child.pid,mode,job:directory}));child.unref();}finally{await out.close();await err.close();}
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
