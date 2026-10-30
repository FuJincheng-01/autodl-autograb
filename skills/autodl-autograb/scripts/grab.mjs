#!/usr/bin/env node
import { readFile, appendFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { spawn } from 'node:child_process';
import path from 'node:path';
import {
  StopError, RetryError, createApi, validateConfig, run, acquireLock,
  unlock, readState, writeJsonAtomic,
} from './lib.mjs';

const jobArg = process.argv.indexOf('--job');
if (jobArg < 0 || !process.argv[jobArg+1]) throw new Error('请提供 --job 独立任务目录。');
const directory = path.resolve(process.argv[jobArg+1]);
const command = process.argv[2] ?? 'buy';
const controller = new AbortController();
let stateFilename = 'state.json';
let stopping = false;
function requestStop() {
  if (stopping) return;
  stopping = true;
  console.log('\n正在停止。若下单请求已提交，将先记录返回结果。');
  controller.abort();
}
process.on('SIGINT', requestStop);
process.on('SIGTERM', requestStop);

async function log(message) {
  const line = `[${new Date().toLocaleString('zh-CN', { timeZone: 'America/New_York', hour12: false })} America/New_York] ${message}`;
  console.log(line);
  await appendFile(path.join(directory, 'monitor.log'), line + '\n', { mode: 0o600 });
}

async function askToken() {
  if (!process.stdin.isTTY) throw new StopError('缺少 auth.txt。请先交互运行 node grab.mjs setup，或设置 AUTODL_AUTHORIZATION。');
  console.log('在 AutoDL 官网登录后，从开发者工具 Network 请求头复制 Authorization。');
  console.log('也可在官网控制台执行 copy(localStorage.getItem("token"))。令牌只保存在当前目录的 auth.txt。');
  let muted = false;
  const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  let token;
  try {
    const answer = rl.question('粘贴网页登录令牌并回车（输入隐藏）：');
    muted = true;
    token = (await answer).trim();
  } finally { rl.close(); process.stdout.write('\n'); }
  if (!token || ['null', 'undefined'].includes(token)) throw new StopError('令牌为空，请先登录 AutoDL 官网。');
  await writeFile(path.join(directory, 'auth.txt'), token + '\n', { mode: 0o600 });
  return token;
}

async function getToken() {
  if (process.env.AUTODL_AUTHORIZATION?.trim()) return process.env.AUTODL_AUTHORIZATION.trim();
  try {
    const token = (await readFile(path.join(directory, 'auth.txt'), 'utf8')).replace(/^\uFEFF/, '').trim();
    if (token && !['null', 'undefined'].includes(token)) return token;
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return askToken();
}

function desktopNotice(state) {
  if (process.platform !== 'win32') return;
  // Keep server strings out of shell source; pass the UUID as a data argument.
  const text = `实例：${state.instanceUuid}\n数据盘：免费50GB+付费${state.extraDataDiskGb}GB=${50 + state.extraDataDiskGb}GB\n请到 AutoDL 控制台查看。`;
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(path.dirname(fileURLToPath(import.meta.url)), 'notice.ps1'), '-Message', text], { detached: true, windowsHide: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

async function confirmInstance(api, state) {
  // Accepted is already latched. This loop only observes; it never creates again.
  for (let i = 0; i < 30 && !controller.signal.aborted; i++) {
    try {
      const body = await api.exists(state.instanceUuid);
      if (body.data === true) {
        const confirmed = { ...state, status: 'confirmed', confirmedAt: new Date().toISOString() };
        await writeJsonAtomic(path.join(directory, stateFilename), confirmed);
        await log(`已确认实例创建完成：${state.instanceUuid}。GPU ¥${state.quote.gpuHourlyCny}/小时；数据盘扩容${state.extraDataDiskGb}GB。`);
        return confirmed;
      }
    } catch (e) {
      await log(`实例租用已受理，创建完成状态暂待控制台核对：${e.message}`);
      return state;
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  await log('租用已受理，创建完成状态请在控制台确认。自动租用保持锁定。');
  return state;
}

async function monitorClone(api, state) {
  // A visible instance record alone does not prove that its data disk was copied.
  const deadline = Date.now() + 2 * 60 * 60 * 1000;
  let last = '';
  let current = state;
  while (!controller.signal.aborted && Date.now() < deadline) {
    try {
      const result = await api.instances(state.instanceUuid);
      const row = result.data?.list?.find(r => r.uuid === state.instanceUuid);
      if (row) {
        const copyStatus = row.additional_info?.copy_data_disk_after_clone_status ?? '';
        const diskTotal = row.usage_info?.data_disk_total_size;
        const diskUsed = row.usage_info?.data_disk_used_size;
        const progress = { instanceStatus: row.status, cloneStatus: row.clone_status ?? '', dataCopyStatus: copyStatus, rootFsUsedRate: row.root_fs_used_rate ?? null, dataFsUsedRate: typeof diskTotal === 'number' && diskTotal > 0 && typeof diskUsed === 'number' ? diskUsed / diskTotal : null, dataDiskTotalBytes: diskTotal ?? null, dataDiskUsedBytes: diskUsed ?? null };
        const signature = JSON.stringify([progress.instanceStatus, progress.cloneStatus, progress.dataCopyStatus]);
        if (signature !== last) {
          await log(`克隆进度：实例=${progress.instanceStatus}，系统克隆=${progress.cloneStatus || '待更新'}，数据盘拷贝=${copyStatus || '待更新'}。`);
          last = signature;
        }
        current = { ...current, status: 'cloning', progress, lastCheckedAt: new Date().toISOString() };
        const failed = /failed|error|abort/i.test(String(row.status)) || /failed|error|abort/i.test(String(row.clone_status)) || /failed|error|abort/i.test(copyStatus);
        const complete = row.status === 'running' && /^(Succeed|Success|Succeeded|Completed)$/i.test(copyStatus);
        if (failed) current.status = 'clone-failed';
        if (complete) { current.status = 'clone-complete'; current.completedAt = new Date().toISOString(); }
        await writeJsonAtomic(path.join(directory, stateFilename), current);
        if (failed) { await log('克隆或数据拷贝出现异常，目标实例已保留；请检查控制台，脚本不会再租一台。'); return current; }
        if (complete) {
          await log(`\u0007克隆完成：${state.instanceUuid}，系统盘和数据盘均已复制，实例运行中。`);
          desktopNotice(current);
          return current;
        }
      }
    } catch (e) {
      await log(`只读查询克隆进度暂遇问题：${e.message}；保留现有实例，稍后继续查询。`);
      if (e instanceof StopError) throw e;
    }
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  await log('克隆进度观察已停止，现有实例及重复下单锁保持。可在控制台查看，或运行 node grab.mjs follow 继续观察。');
  return current;
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 20) throw new StopError('请使用 Node.js 20 或更新版本。');
  const c = validateConfig(JSON.parse((await readFile(path.join(directory, 'config.json'), 'utf8')).replace(/^\uFEFF/, '')));
  stateFilename = c.operation === 'clone' ? 'clone-state.json' : 'state.json';
  if (command === 'status') {
    console.log(JSON.stringify(await readState(directory, stateFilename), null, 2));
    return;
  }
  if (command === 'unlock') { console.log(await unlock(directory)); return; }
  if (command === 'reset') {
    if (process.argv[3] !== '--checked') throw new StopError('先在 AutoDL 控制台核对所有实例，再运行 node grab.mjs reset --checked。该命令会允许再次租用。');
    const release = await acquireLock(directory);
    try {
      const state = await readState(directory, stateFilename);
      if (!state) { console.log('当前没有租用记录。'); return; }
      await mkdir(path.join(directory, 'history'), { recursive: true });
      const archive = path.join(directory, 'history', `${stateFilename}-${Date.now()}.json`);
      await rename(path.join(directory, stateFilename), archive);
      console.log('旧状态已归档。下次 buy 将允许再创建一个实例。');
    } finally { await release(); }
    return;
  }
  if (command === 'setup') { await askToken(); console.log('登录令牌已保存。下一步运行 node grab.mjs check。'); return; }
  if (!['buy', 'check', 'watch', 'follow'].includes(command)) {
    console.log('用法：node grab.mjs [setup|check|watch|buy|follow|status|unlock|reset --checked]');
    return;
  }
  const release = await acquireLock(directory);
  try {
    const prior = await readState(directory, stateFilename);
    if (command !== 'follow' && prior && prior.status !== 'rejected-stock') throw new StopError(`已有 ${prior.status} 记录，实例 ${prior.instanceUuid ?? '待核对'}。请运行 status 查看；脚本已锁定重复租用。`);
    let account = {};
    try { account = JSON.parse(await readFile(path.join(directory, 'account.json'), 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw new StopError('account.json 格式有误。'); }
    const api = createApi(await getToken(), c, { subUser: account.subUser === true });
    if (command === 'follow') {
      if (!prior?.instanceUuid || prior.operation !== 'clone') throw new StopError('当前没有已受理的克隆记录。');
      await monitorClone(api, prior);
      return;
    }
    // Serialize asynchronous log writes while preserving a synchronous core callback.
    let logQueue = Promise.resolve();
    const logger = message => { logQueue = logQueue.then(() => log(message)); };
    let result;
    try {
      result = await run({
        c, api, loadState: () => readState(directory, stateFilename),
        saveState: state => writeJsonAtomic(path.join(directory, stateFilename), state),
        log: logger, mode: command === 'buy' ? 'buy' : command,
        signal: controller.signal,
      });
    } finally { await logQueue; }
    if (result?.status === 'accepted') {
      if (result.operation === 'clone') await monitorClone(api, result);
      else { desktopNotice(result); await confirmInstance(api, result); }
    }
  } finally { await release(); }
}

const stopTimer=setInterval(async()=>{try{await readFile(path.join(directory,'stop.request'));requestStop();}catch{}},1000);
stopTimer.unref();
main().catch(async e => {
  const message = e instanceof StopError || e instanceof RetryError ? e.message : `运行出错：${e.code ?? e.name}，请检查配置和本地文件。`;
  await log(message).catch(() => console.error(message));
  process.exitCode = controller.signal.aborted ? 0 : 1;
});
