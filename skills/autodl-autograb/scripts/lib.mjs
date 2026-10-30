import { open, readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export const GIB = 1024 ** 3;
export const SITE = 'https://www.autodl.com';
export const REGION_URL = 'https://fe-config-backend.autodl.com/api/v1/autodl/region/tag';
export const ENDPOINTS = Object.freeze({
  machines: '/api/v1/user/machine/list',
  images: '/api/v1/image/all',
  quote: '/api/v1/order/price/preview',
  create: '/api/v1/order/instance/create/payg',
  exists: '/api/v1/instance/exist',
  clone: '/api/v1/order/instance/clone/payg',
  sourceDetail: '/api/v1/instance/detail',
  sourceSnapshot: '/api/v1/instance/snapshot',
  instances: '/api/v1/instance',
});

export class StopError extends Error {}
export class RetryError extends Error {
  constructor(message, delayMs = 0) { super(message); this.delayMs = delayMs; }
}

const cleanName = v => String(v ?? '').replace(/\s/g, '').toLowerCase();
const validNumber = v => typeof v === 'number' && Number.isFinite(v);
function requireTrue(value, message) { if (!value) throw new StopError(message); }

export function validateConfig(c) {
  requireTrue(c.operation === undefined || ['create', 'clone'].includes(c.operation), 'operation 应为 create 或 clone。');
  if (c.operation === 'clone') {
    requireTrue(typeof c.sourceInstanceUuid === 'string' && /^[a-z0-9]{10}-[a-z0-9]{8}$/.test(c.sourceInstanceUuid), '请配置有效的源实例 ID。');
    requireTrue(c.copyDataDisk === true, '克隆任务必须同时复制数据盘。');
    requireTrue(c.optimizeSparseFiles === true, '克隆任务必须启用稀疏文件优化，避免零区域占用目标磁盘。');
  }
  requireTrue(typeof c.regionName === 'string' && c.regionName.trim().length > 0, '请选择地区。');
  requireTrue(typeof c.gpuModel === 'string' && c.gpuModel.trim().length > 0 && c.gpuCount === 1, '请提供官网GPU型号，当前支持单卡。');
  requireTrue(Number.isInteger(c.extraDataDiskGb) && c.extraDataDiskGb >= 0 && c.extraDataDiskGb <= 500, '扩容需为0到500GB整数。');
  requireTrue(validNumber(c.maxGpuHourlyCny) && c.maxGpuHourlyCny > 0, '请提供GPU每小时最高接受价格。');
  requireTrue(validNumber(c.maxDiskDailyCny) && c.maxDiskDailyCny >= 0 && (c.extraDataDiskGb > 0 || c.maxDiskDailyCny === 0), '请提供扩容每日费用上限；不扩容填0。');
  for (const k of ['minGpuMemoryGb','minCpuCores','minMemoryGb']) requireTrue(validNumber(c[k]) && c[k] >= 0, `${k}需为非负数。`);
  requireTrue(c.minCpuCores === 0 && c.minMemoryGb === 0, 'CPU/内存单卡分配字段尚待适配；本版本请勿设置这两项硬性下限。');
  requireTrue(Array.isArray(c.machineIds) && c.machineIds.every(x=>typeof x === 'string' && /^[a-z0-9]+$/.test(x)), '指定主机需使用官网machine_id数组。');
  requireTrue(Number.isInteger(c.pollIntervalMs) && c.pollIntervalMs >= 1000, '库存检查间隔至少 1000ms。');
  for (const k of ['requestTimeoutMs', 'createTimeoutMs']) {
    requireTrue(Number.isInteger(c[k]) && c[k] >= 1000 && c[k] <= 120000, `${k} 应在 1000 到 120000ms 之间。`);
  }
  requireTrue(typeof c.baseImageUuid === 'string' && typeof c.imagePreference === 'string', '镜像配置格式有误。');
  return c;
}

export function resolveRegions(body, c) {
  requireTrue(['OK', 'Success'].includes(body?.code) && Array.isArray(body.data), '官网地区目录格式发生变化。');
  const matches = body.data.filter(r => cleanName(r.region_name) === cleanName(c.regionName) && r.region_class === 'normal');
  requireTrue(matches.length === 1, '官网地区目录未唯一匹配所选地区。');
  const signs = matches[0].region_sign;
  requireTrue(Array.isArray(signs) && signs.length > 0 && signs.every(s => typeof s === 'string' && /^[a-zA-Z0-9_-]+$/.test(s)), '地区编号格式发生变化。');
  return [...new Set(signs)];
}

export function machineQuery(c, regions, page = 1) {
  return {
    charge_type: 'payg', region_sign: '', region_sign_list: regions,
    gpu_type_name: [c.gpuModel], gpu_idle_num: 1, default_order: true,
    machine_tag_name: [], mount_net_disk: false, cpu_arch: [], chip_corp: [],
    page_index: page, page_size: 100,
  };
}

// Validate the response as well as the request filters: never substitute a region/model.
export function candidates(data, c, regions) {
  requireTrue(Array.isArray(data?.list), '库存响应缺少 data.list。');
  const good = [];
  for (const m of data.list) {
    if (!regions.includes(m.region_sign) || cleanName(m.gpu_name) !== cleanName(c.gpuModel)) continue;
    if (m.region_name && cleanName(m.region_name) !== cleanName(c.regionName)) continue;
    if (!validNumber(m.gpu_memory) || m.gpu_memory < c.minGpuMemoryGb * GIB) continue;
    if (c.machineIds.length && !c.machineIds.includes(m.machine_id)) continue;
    // CPU/memory allocation fields differ by platform version. Missing fields fail closed when constrained.
    if (c.minCpuCores > 0 && (!validNumber(m.cpu_num) || m.cpu_num < c.minCpuCores)) continue;
    if (c.minMemoryGb > 0 && (!validNumber(m.memory) || m.memory < c.minMemoryGb * GIB)) continue;
    if (!validNumber(m.gpu_idle_num) || m.gpu_idle_num < 1 || !Number.isInteger(m.on_line) || [3, 4, 5, 6].includes(m.on_line)) continue;
    if (!validNumber(m.max_instance_num) || !validNumber(m.binding_instance_num) || m.max_instance_num <= m.binding_instance_num) continue;
    if (!validNumber(m.max_instance_disk_size) || m.max_instance_disk_size !== 50 * GIB) continue;
    if (!validNumber(m.max_data_disk_expand_size) || m.max_data_disk_expand_size < c.extraDataDiskGb * GIB) continue;
    if (m.rent_mode) {
      const match = /^(Base|Unit)(\d+)$/.exec(m.rent_mode);
      if (!match) continue;
      const unit = Number(match[2]);
      if (unit < 1 || (unit > 1 && m.gpu_idle_num >= unit)) continue;
    }
    if (typeof m.machine_id !== 'string' || !m.machine_id) continue;
    good.push(m);
  }
  return good;
}

export function flattenImages(data) {
  requireTrue(Array.isArray(data), '基础镜像目录格式发生变化。');
  const result = [];
  function walk(nodes, labels = []) {
    for (const n of nodes) {
      const label = n.label_name;
      if (Array.isArray(n.children)) walk(n.children, [...labels, typeof label === 'string' ? label : '']);
      else if (label && typeof label === 'object' && typeof label.uuid === 'string') result.push({ ...label, labels });
    }
  }
  walk(data);
  requireTrue(result.length > 0, '基础镜像目录中没有可识别的 UUID。');
  return result;
}

export function cudaVersion(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return NaN;
  const text = String(value).trim().replace(/^cuda\s*/i, '');
  const match = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(text);
  if (match) return Number(match[1]) * 100 + Number(match[2] ?? 0);
  if (/^\d{3}$/.test(text)) return Number(text.slice(0, 2)) * 100 + Number(text[2]);
  return NaN;
}

export function selectImage(images, machine, c) {
  if (typeof machine.cpu_arch !== 'string' || !machine.cpu_arch || typeof machine.chip_corp !== 'string' || !machine.chip_corp) return null;
  const maxCuda = cudaVersion(machine.highest_cuda_version);
  const options = images.filter(i => {
    if (c.baseImageUuid && i.uuid !== c.baseImageUuid) return false;
    if (machine.cpu_arch && i.cpu_arch !== machine.cpu_arch) return false;
    if (machine.chip_corp && i.chip_corp !== machine.chip_corp) return false;
    if (i.is_desktop) return false;
    const cuda = cudaVersion(i.v);
    // Current vGPU-32GB uses Ada cards; the official guard requires CUDA >=11.3.
    return Number.isFinite(cuda) && Number.isFinite(maxCuda) && cuda >= (cleanName(c.gpuModel)==='vgpu-32gb' ? 1103 : 0) && cuda <= maxCuda;
  });
  const preferred = options.filter(i => i.labels.join(' ').toLowerCase().includes(c.imagePreference.toLowerCase()));
  return (preferred.length ? preferred : options).sort((a, b) => cudaVersion(a.v) - cudaVersion(b.v))[0] ?? null;
}

export function pricePayload(machineId, c) {
  return {
    charge_type: 'payg', coupon_id_list: [], duration: 1,
    expand_data_disk: c.extraDataDiskGb * GIB, machine_id: machineId, num: 1,
  };
}

export function readQuote(data) {
  requireTrue(Array.isArray(data?.discount_list), '价格预览缺少 discount_list。');
  const rows = data.discount_list.filter(x => x.product_type === 'instance' && x.type === 'member_discount');
  requireTrue(rows.length === 1, '价格预览中 GPU 报价格式发生变化。');
  const r = rows[0];
  requireTrue(validNumber(r.origin_price) && validNumber(r.total_reduction) && r.origin_price >= r.total_reduction && r.total_reduction >= 0, 'GPU 报价数值格式有误。');
  const diskDaily = data.data_disk_info?.data_disk_deal_daily_price;
  return {
    gpuHourlyCny: (r.origin_price - r.total_reduction) / 1000,
    diskDailyCny: validNumber(diskDaily) && diskDaily >= 0 ? diskDaily / 1000 : null,
  };
}

export function createPayload(machineId, image, c, name) {
  return {
    instance_info: {
      machine_id: machineId, charge_type: 'payg', req_gpu_amount: 1,
      base_image_uuid: image.uuid, private_image_uuid: '', reproduction_uuid: '',
      cg_application_uuid: '',
      cg_application_info: { image_name: '', current_version_id: 0, current_version: '', image_id: 0 },
      instance_name: name, expand_data_disk: c.extraDataDiskGb * GIB, reproduction_id: 0,
    },
    price_info: pricePayload(machineId, c),
  };
}

export function normalizeCloneSource(detail, snapshot, c, regions) {
  requireTrue(detail?.instance_uuid === c.sourceInstanceUuid, '源实例 ID 与配置不一致。');
  requireTrue(detail.status === 'shutdown', '源实例必须保持已关机，暂停克隆。');
  const sourceMachine = snapshot?.machine_info_snapshot;
  requireTrue(detail.req_gpu_amount === 1 && detail.machine_id === c.sourceInstanceUuid.split('-')[0] && detail.machine?.machine_id === detail.machine_id, '源实例 GPU 数量或主机编号与指定源不一致。');
  requireTrue(sourceMachine && regions.includes(sourceMachine.region_sign) && cleanName(sourceMachine.region_name) === cleanName(c.regionName), '源实例地区与西北B区不一致。');
  requireTrue(detail.machine.region_sign === sourceMachine.region_sign && cleanName(detail.machine.region_name) === cleanName(c.regionName), '源实例详情与快照中的地区不一致。');
  requireTrue(detail.max_writable_size_in_byte === 30 * GIB && snapshot.max_writable_size_in_byte === 30 * GIB, '源实例系统盘不是 30GB，请核对。');
  requireTrue(sourceMachine.max_instance_disk_size === 50 * GIB && validNumber(snapshot.expand_data_disk_size) && snapshot.expand_data_disk_size === detail.data_disk_expand_size && snapshot.expand_data_disk_size <= c.extraDataDiskGb * GIB, '目标扩容需至少保留源实例已有的付费扩容容量。');
  const image = snapshot.image;
  requireTrue(image?.image_type === 'public' && typeof image.base_image_uuid === 'string' && image.base_image_uuid.length > 0, '源实例基础镜像字段发生变化。');
  requireTrue(image.chip_corp === 'nvidia' && image.cpu_arch === 'x86' && snapshot.chip_corp === image.chip_corp && snapshot.cpu_arch === image.cpu_arch, '源实例镜像架构信息有误。');
  requireTrue(Number.isFinite(cudaVersion(image.cuda_version)), '源实例 CUDA 版本格式有误。');
  return {
    uuid: detail.instance_uuid, name: detail.instance_name,
    region: sourceMachine.region_sign, baseImageUuid: image.base_image_uuid,
    cuda: String(image.cuda_version), cpuArch: image.cpu_arch, chipCorp: image.chip_corp,
    framework: `${image.framework_name ?? ''} ${image.framework_version ?? ''}`.trim(),
    python: image.python_version ?? '', extraDataDiskGb: c.extraDataDiskGb,
  };
}

export function cloneCompatible(source, machine) {
  return machine.cpu_arch === source.cpuArch && machine.chip_corp === source.chipCorp
    && Number.isFinite(cudaVersion(machine.highest_cuda_version))
    && cudaVersion(machine.highest_cuda_version) >= cudaVersion(source.cuda);
}

export function clonePayload(machineId, source, c, name) {
  return {
    instance_uuid: source.uuid,
    instance_info: {
      machine_id: machineId, charge_type: 'payg', req_gpu_amount: 1,
      base_image_uuid: source.baseImageUuid, instance_name: name,
      private_image_uuid: '', reproduction_uuid: '', cg_application_uuid: '',
      cg_application_info: {}, expand_data_disk: c.extraDataDiskGb * GIB,
      copy_data_disk_after_clone: true, keep_src_user_service_address_after_clone: false,
      reproduction_id: 0, ft_sparse: c.optimizeSparseFiles === true,
    },
    price_info: pricePayload(machineId, c),
  };
}

export function isStockRejection(body) {
  // Verified in the official create-page bundle; no inferred message matching.
  return body?.code === 'MachineGpuNumUpdateFailed';
}

export function successData(body) {
  if (body?.code !== 'Success') return null;
  return typeof body.data === 'string' && body.data ? body.data : null;
}

export function createApi(token, c, { fetchImpl = fetch, subUser = false } = {}) {
  requireTrue(typeof token === 'string' && token.trim().length > 0, '请先保存网页登录令牌到 auth.txt，或设置 AUTODL_AUTHORIZATION。');
  const secret = token.trim();
  const redact = value => String(value).split(secret).join('[TOKEN]').replace(/[\r\n]/g, ' ').slice(0, 300);
  async function call(endpoint, payload, { creation = false, publicRequest = false } = {}) {
    const needsSubPrefix = subUser && /^\/api\/v1\/(?:instance(?:\/|\?|$)|order\/|user\/machine\/|machine\/|image\/)/.test(endpoint);
    const actualEndpoint = needsSubPrefix ? endpoint.replace('/api/v1/', '/api/v1/sub_user/') : endpoint;
    const target = publicRequest ? REGION_URL : SITE + actualEndpoint;
    let response;
    try {
      response = await fetchImpl(target, {
        method: payload === undefined ? 'GET' : 'POST',
        headers: publicRequest ? { Accept: 'application/json' } : {
          Authorization: secret, 'Content-Type': 'application/json', Accept: 'application/json',
          Origin: SITE, Referer: SITE + '/market/list',
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: AbortSignal.timeout(creation ? c.createTimeoutMs : c.requestTimeoutMs),
        redirect: 'error',
      });
    } catch {
      if (creation) throw new StopError('下单连接中断或超时，结果待核对；已保留 pending 状态，请到控制台检查实例。');
      throw new RetryError('读取官网接口时网络中断。');
    }
    if ([401, 403].includes(response.status)) throw new StopError('网页登录已失效或账号需要完成验证，请重新登录 AutoDL。');
    if (!response.ok) {
      if (creation) throw new StopError(`下单 HTTP ${response.status}，结果待核对；pending 状态已保留。`);
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = response.headers.get('retry-after');
        const seconds = Number(retryAfter);
        const delayMs = retryAfter && Number.isFinite(seconds) ? seconds * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now()) || 0;
        throw new RetryError(`读取接口 HTTP ${response.status}，退避后重试。`, delayMs);
      }
      throw new StopError(`读取接口 HTTP ${response.status}，请检查登录状态和官网页面。`);
    }
    let body;
    try { body = await response.json(); } catch {
      throw new StopError(creation ? '下单返回非 JSON，结果待核对；pending 状态已保留。' : '官网接口返回非 JSON，请检查页面状态。');
    }
    requireTrue(body && typeof body.code === 'string', '官网接口响应缺少 code；若为下单，pending 状态已保留。');
    if (/AuthorizeFailed|Unauthorized|TokenExpired|TOLogin/i.test(body.code)) throw new StopError('网页登录令牌已失效，请重新登录并更新 auth.txt。');
    if (creation) return { ...body, code: redact(body.code) };
    if (!['Success', ...(publicRequest ? ['OK'] : [])].includes(body.code)) {
      throw new StopError(`官网返回 ${redact(body.code)}：${redact(body.msg ?? '')}`);
    }
    return body;
  }
  return {
    regions: () => call('', undefined, { publicRequest: true }),
    images: () => call(ENDPOINTS.images, { cpu_arch: [], chip_corp: [] }),
    machines: query => call(ENDPOINTS.machines, query),
    quote: payload => call(ENDPOINTS.quote, payload),
    create: payload => call(ENDPOINTS.create, payload, { creation: true }),
    clone: payload => call(ENDPOINTS.clone, payload, { creation: true }),
    sourceDetail: uuid => call(`${ENDPOINTS.sourceDetail}?instance_uuid=${encodeURIComponent(uuid)}`),
    sourceSnapshot: uuid => call(`${ENDPOINTS.sourceSnapshot}?instance_uuid=${encodeURIComponent(uuid)}`),
    instances: uuid => call(ENDPOINTS.instances, { page_index: 1, page_size: 100, status: [], charge_type: [], name: uuid }),
    exists: uuid => call(`${ENDPOINTS.exists}?instance_uuid=${encodeURIComponent(uuid)}`),
  };
}

export async function writeJsonAtomic(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, file);
}

export async function readState(directory, filename = 'state.json') {
  try { return JSON.parse(await readFile(path.join(directory, filename), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw new StopError('state.json 读取失败，请保留文件并检查。'); }
}

export async function acquireLock(directory) {
  const file = path.join(directory, 'run.lock');
  let handle;
  try { handle = await open(file, 'wx', 0o600); }
  catch (e) { if (e.code === 'EEXIST') throw new StopError('已有运行锁。先检查其他窗口；异常退出后可运行 node grab.mjs unlock。'); throw e; }
  await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
  await handle.close();
  return async () => { await unlink(file); };
}

export async function unlock(directory) {
  const file = path.join(directory, 'run.lock');
  let lock;
  try { lock = JSON.parse(await readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return '当前没有运行锁。'; throw new StopError('运行锁格式异常，请人工检查 run.lock。'); }
  requireTrue(Number.isInteger(lock.pid) && lock.pid > 0, '运行锁 PID 格式异常。');
  try { process.kill(lock.pid, 0); throw new StopError(`PID ${lock.pid} 仍在运行，请先停止该进程。`); }
  catch (e) { if (e.code !== 'ESRCH') throw e; }
  await unlink(file);
  return '已解除退出进程的运行锁；state.json 仍然保留。';
}

const delay = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new StopError('已停止。'));
  const onAbort = () => { clearTimeout(timer); reject(new StopError('已停止。')); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  signal?.addEventListener('abort', onAbort, { once: true });
});

export async function run({ c, api, loadState, saveState, log = console.log, mode = 'buy', signal, sleep = delay, maxPolls = Infinity }) {
  validateConfig(c);
  const prior = await loadState();
  requireTrue(!prior || prior.status === 'rejected-stock', `已存在 ${prior?.status} 状态，自动下单已锁定。请在 AutoDL 控制台核对后处理 state.json。`);
  async function readInitially(action) {
    let failures = 0;
    for (;;) {
      if (signal?.aborted) throw new StopError('已停止。');
      try { return await action(); }
      catch (e) {
        if (!(e instanceof RetryError)) throw e;
        const ms = Math.max(e.delayMs, Math.min(60000, c.pollIntervalMs * 2 ** Math.min(++failures, 5)));
        log(`${e.message} 初始化将在 ${Math.ceil(ms / 1000)} 秒后重试。`);
        await sleep(ms, signal);
      }
    }
  }
  const regions = resolveRegions(await readInitially(() => api.regions()), c);
  const cloning = c.operation === 'clone';
  const getSource = async () => {
    const [detail, snapshot] = await Promise.all([api.sourceDetail(c.sourceInstanceUuid), api.sourceSnapshot(c.sourceInstanceUuid)]);
    return normalizeCloneSource(detail.data, snapshot.data, c, regions);
  };
  const source = cloning ? await readInitially(getSource) : null;
  const images = cloning ? [] : flattenImages((await readInitially(() => api.images())).data);
  log(`目标：${c.regionName} [${regions.join(', ')}]，${c.gpuModel} ×1，GPU ≤ ¥${c.maxGpuHourlyCny}/小时。`);
  log(cloning ? `克隆源 ${source.uuid} / ${source.name}；同时复制系统盘和数据盘；保留 ${source.framework} / ${source.python} / CUDA ${source.cuda}。` : `系统盘30GB；数据盘50GB+付费扩容${c.extraDataDiskGb}GB=${50+c.extraDataDiskGb}GB。CPU/内存随主机，选择兼容镜像。`);
  if (cloning) log(`目标系统盘30GB，数据盘50GB+付费${c.extraDataDiskGb}GB=${50 + c.extraDataDiskGb}GB；开启稀疏拷贝；使用目标实例的新网络地址。`);
  log(mode === 'buy' ? '自动租用已启用；成功一次即退出。Ctrl+C 停止。' : '只读检查：本次不提交租用。');
  let failures = 0;
  for (let poll = 1; poll <= maxPolls; poll++) {
    if (signal?.aborted) throw new StopError('已停止。');
    const started = Date.now();
    let retryDelay = 0;
    try {
      const found = [];
      let scanned = 0;
      for (let page = 1; page <= 20; page++) {
        const result = await api.machines(machineQuery(c, regions, page));
        found.push(...candidates(result.data, c, regions));
        scanned += result.data.list.length;
        if (found.length || result.data.list.length === 0 || !validNumber(result.data.result_total) || scanned >= result.data.result_total) break;
      }
      if (found.length === 0) log(`第 ${poll} 次：暂无匹配的空闲卡。`);
      for (const machine of found) {
        const image = cloning ? null : selectImage(images, machine, c);
        if (cloning ? !cloneCompatible(source, machine) : !image) { log(`跳过 ${machine.machine_id}：主机架构或 CUDA 与所需镜像不兼容。`); continue; }
        const quote = readQuote((await api.quote(pricePayload(machine.machine_id, c))).data);
        if (quote.gpuHourlyCny > c.maxGpuHourlyCny + 1e-9) {
          log(`跳过 ${machine.machine_id}：GPU 报价 ¥${quote.gpuHourlyCny}/小时，超过上限。`); continue;
        }
        log(`发现 ${machine.region_sign}/${machine.machine_id}：GPU ¥${quote.gpuHourlyCny}/小时；${cloning ? `克隆源镜像 / CUDA ${source.cuda}` : `镜像 ${image.labels.join(' / ')} / CUDA ${image.v}`}。`);
        requireTrue(quote.diskDailyCny !== null, '平台未给出磁盘报价，暂停下单。');
        if (quote.diskDailyCny > c.maxDiskDailyCny + 1e-9) { log(`跳过 ${machine.machine_id}：磁盘日费超过上限。`); continue; }
        if (c.extraDataDiskGb === 0) {
          requireTrue(quote.diskDailyCny === null || quote.diskDailyCny === 0, '未配置扩容，但平台返回了扩容费用，暂停下单。');
          log('数据盘不额外扩容，下单扩容参数为0。');
        } else log(quote.diskDailyCny === null ? `${c.extraDataDiskGb}GB 扩容已计入下单请求；费用以控制台为准。` : `${c.extraDataDiskGb}GB 数据盘扩容另计 ¥${quote.diskDailyCny}/日（关机后的磁盘计费以平台规则为准）。`);
        if (mode !== 'buy') return { status: 'checked', machineId: machine.machine_id, imageUuid: cloning ? source.baseImageUuid : image.uuid, sourceInstanceUuid: source?.uuid, quote };
        if (signal?.aborted) throw new StopError('已停止。');
        if (cloning) {
          const fresh = await getSource();
          requireTrue(JSON.stringify(fresh) === JSON.stringify(source), '源实例配置发生变化，暂停克隆，请重新核对。');
        }
        const attempt = randomUUID();
        const name = `${cloning ? 'autodl-clone' : 'autodl-new'}-${attempt.slice(0, 8)}`;
        const pending = { status: 'pending', operation: cloning ? 'clone' : 'create', sourceInstanceUuid: source?.uuid, copyDataDisk: cloning, optimizeSparseFiles: cloning && c.optimizeSparseFiles === true, attempt, name, machineId: machine.machine_id, region: machine.region_sign, imageUuid: cloning ? source.baseImageUuid : image.uuid, extraDataDiskGb: c.extraDataDiskGb, quote, createdAt: new Date().toISOString() };
        await saveState(pending); // Durable latch BEFORE sending the billable POST.
        const body = cloning ? await api.clone(clonePayload(machine.machine_id, source, c, name)) : await api.create(createPayload(machine.machine_id, image, c, name));
        const uuid = successData(body);
        if (uuid) {
          const accepted = { ...pending, status: 'accepted', instanceUuid: uuid, acceptedAt: new Date().toISOString() };
          await saveState(accepted);
          log(`\u0007租用请求成功，实例：${uuid}。请在控制台等待创建/开机，脚本已停止继续租用。`);
          return accepted;
        }
        if (isStockRejection(body)) {
          await saveState({ ...pending, status: 'rejected-stock', responseCode: body.code });
          log('服务器明确返回库存不足，继续监控。');
          break;
        }
        throw new StopError(`下单返回的状态需要核对；已保留 pending，先到控制台检查实例。`);
      }
      failures = 0;
      if (mode === 'check') return { status: 'checked', candidates: found.length };
    } catch (e) {
      // No read retry can ever replay an ambiguous create request.
      const current = await loadState();
      if (e instanceof RetryError && (!current || current.status === 'rejected-stock')) {
        failures++;
        retryDelay = Math.max(e.delayMs, Math.min(60000, c.pollIntervalMs * 2 ** Math.min(failures, 5)) + Math.floor(Math.random() * 500));
        log(`${e.message} 等待 ${Math.ceil(retryDelay / 1000)} 秒。`);
      } else throw e;
    }
    if (poll < maxPolls) await sleep(Math.max(retryDelay, c.pollIntervalMs - (Date.now() - started)), signal);
  }
  return { status: 'finished' };
}
