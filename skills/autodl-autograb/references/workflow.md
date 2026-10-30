# 配置与运行

所有路径需绝对引用。`SCRIPTS` 是本插件SKILL.md同级scripts目录。初始化输入JSON只写已确认参数，不含token。每任务目录需唯一，例如当前工作目录下work/autodl-jobs/时间-随机ID，先创建父目录。新租operation=create，克隆operation=clone。

```json
{
  "operation": "create",
  "regionName": "西北B区",
  "gpuModel": "vGPU-32GB",
  "gpuCount": 1,
  "extraDataDiskGb": 0,
  "maxGpuHourlyCny": 1.58,
  "maxDiskDailyCny": 0,
  "imagePreference": "Miniconda",
  "baseImageUuid": "",
  "sourceInstanceUuid": "",
  "subUser": false,
  "minGpuMemoryGb": 32,
  "minCpuCores": 0,
  "minMemoryGb": 0,
  "machineIds": []
}
```

扩容填写0~500的GB整数并填写磁盘日费上限；均以官网报价为准。未指定的copyDataDisk=true、optimizeSparseFiles=true、pollIntervalMs=2000、requestTimeoutMs=15000、createTimeoutMs=30000由init补齐。指定镜像必须填写baseImageUuid；仅imagePreference为偏好，库存不匹配时可能选择其他兼容镜像，应先向用户讲清。自定义其他要求不直接传到API。

```text
node SCRIPTS/job.mjs init ABS_JOB ABS_INPUT_JSON
node SCRIPTS/grab.mjs setup --job ABS_JOB
node SCRIPTS/grab.mjs check --job ABS_JOB
node SCRIPTS/job.mjs start ABS_JOB
node SCRIPTS/job.mjs status ABS_JOB
node SCRIPTS/job.mjs stop ABS_JOB
```

setup需交互终端并隐藏输入，或用户自己在本地写入job/auth.txt。不要把令牌放在shell命令行。AUTODL_AUTHORIZATION也可供grab使用；job start需要本地auth.txt以避免后台缺凭据。

start在Windows隐藏启动，写process.out.log/process.err.log，grab写monitor.log。run.lock由grab独占创建。start返回PID后立即核对进程命令和run.lock；如果并发启动，只有拿到锁的进程可下单。保留订单状态不能随意删锁。进程已退出且锁PID不存在时才可运行grab unlock；PID复用需核对命令，不杀其他进程。

stop写stop.request，grab下一轮停止；在途付费请求会先记录返回。停止不改变已创建资源，网络请求最长等待配置的超时。恢复需用户要求，先只读核对pending/已受理状态，再移除stop.request并按状态启动。

主机列表只筛选50GB免费数据盘，支持单卡；某些源平台物理容量可能与快照标称值不同，记录差异、检查目标实际容量，不擅自假定完全一样。基础镜像克隆支持源付费扩容<=目标扩容，绝不自动缩减。系统盘需30GB。

首次启动后只读证据：配置、quote、state、run.lock和PID匹配结果。结果核对可import lib.mjs的createApi，只输出uuid、status、region、gpu、disk、image和copy状态；不要输出完整API响应（可能有SSH密码）。

心跳仅查本任务，监控正常不另起进程。pending或未知结果查官网；accepted/cloning且观察进程退出才follow。新租accepted/confirmed后同样查询instances确认running，保留旧成功状态防再次buy。登录失效暂停并提示更新任务auth.txt。完成后记录completionReported=true、README结果和不含凭据的交付物，然后删除heartbeat。
