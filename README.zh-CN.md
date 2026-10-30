# AutoDL 自动抢卡

[English](README.md) | [简体中文](README.zh-CN.md)

本地运行的自动抢卡工具，提供 **Skill** 和 **Codex 插件**两种安装形式，共用一套脚本。等待符合条件的空闲 GPU，新租一个实例，或把已关机实例克隆为一个新实例。

## 功能

- 选择精确 GPU 型号、地区、单卡、GPU 小时预算及磁盘扩容日费预算。
- 支持新租和克隆；克隆保留原公共基础镜像，同时复制系统盘、数据盘并开启稀疏拷贝。
- 每个任务独立保存配置和订单状态；付费请求前持久化 pending，未知结果不自动重复下单。
- 宿主支持定时跟进时，在抢到、完成、失败或需要处理时通知，正常等待保持安静。
- 停止监控不关机、不释放实例，不额外清理或整理实验文件。

## 环境和支持范围

需要 **Node.js20+**、本地执行器和自己的 AutoDL 账号，无 npm 依赖。下列插件安装命令还需 Codex CLI。其他支持 SKILL.md 和本地 Node 执行的 agent 可使用 Skill；具体安装目录及通知能力以宿主为准。

当前支持：**单卡**、普通 NVIDIA/x86 公共镜像容器、30GiB 系统盘、标称免费50GiB数据盘的主机，以及0～500GiB付费扩容。平台实际文件系统容量可能与标称不同，复制后核对实际容量。CPU/内存硬性下限尚未适配；GPU/地区可用性及镜像兼容性以平台为准。脚本日志目前为中文，agent 按用户语言回复。Windows 支持完成弹窗，其他系统提供终端输出。持续聊天通知需要宿主调度器，缺少时应明确只有本机监控。

## 方式一：安装 Codex 插件

```sh
codex plugin marketplace add https://github.com/FuJincheng-01/autodl-autograb.git
codex plugin add autodl-autograb@autodl-autograb
codex plugin list --marketplace autodl-autograb --json
```

确认 `installed=true`、`enabled=true` 后新建聊天，在插件菜单选择 **AutoDL 自动抢卡**。菜单未刷新时重新打开桌面应用。已有 personal 等其他来源的同名插件时先核对，避免重复启用。

## 方式二：安装独立 Skill

把仓库克隆到长期保留的目录，将 `skills/autodl-autograb` **整个文件夹**复制到 agent 的个人 skill 目录。Codex 优先使用 `$CODEX_HOME/skills`，未设置时为 `~/.codex/skills`。保留 scripts、references、agents 等配套目录，同名 skill 先检查来源和版本。新建聊天后使用 `$autodl-autograb`。其他 agent 请使用其支持的技能目录。

macOS/Linux 默认 Codex 目录示例，目标已存在则不复制：

```sh
git clone https://github.com/FuJincheng-01/autodl-autograb.git
mkdir -p ~/.codex/skills
test ! -e ~/.codex/skills/autodl-autograb && cp -R autodl-autograb/skills/autodl-autograb ~/.codex/skills/
```

Windows PowerShell 默认目录示例：

```powershell
git clone https://github.com/FuJincheng-01/autodl-autograb.git
$skillRoot = Join-Path $env:USERPROFILE '.codex/skills'
New-Item -ItemType Directory -Path $skillRoot -Force | Out-Null
if (Test-Path (Join-Path $skillRoot 'autodl-autograb')) { throw '已有同名技能，请先核对来源和版本' }
Copy-Item -LiteralPath './autodl-autograb/skills/autodl-autograb' -Destination $skillRoot -Recurse
```

Skill 和插件选一种即可。安装不会登录 AutoDL，也不会启动付费任务。

## 一键复制给 agent 的安装提示词

点击代码块右上角复制。[中文文本](docs/INSTALL-PROMPT.zh-CN.txt) · [English prompt](docs/INSTALL-PROMPT.en.txt)

```text
请从 https://github.com/FuJincheng-01/autodl-autograb 安装 AutoDL 自动抢卡。先阅读 README.zh-CN.md；若当前环境支持 Codex 插件，添加该仓库的插件市场并安装 autodl-autograb@autodl-autograb，否则将 skills/autodl-autograb 完整安装到当前 agent 支持的个人 skill 目录。两种形式选一种，保留已有设置，同名安装先核对来源。核对插件 installed/enabled 或 skill 入口及配套脚本后汇报，并说明是否需要新建聊天。此次仅安装，不登录 AutoDL、不读取其他任务凭据、不启动监控或创建付费实例。
```

## 使用示例

“把我已关机的 SOURCE_INSTANCE_ID 克隆到同区新实例，vGPU-32GB单卡，不扩容，开启稀疏拷贝。GPU上限1.58元/小时，磁盘扩容日费上限0元，核对配置后启动，抢到和复制完成时告诉我。”这里的预算仅为示例，当前价格须查询平台。

Agent 会收集缺失参数及启动授权，为每次任务新建目录，引导在本机保存自己的登录令牌，先做只读检查再启动。每人使用自己的主账号/子账号，令牌不要发到聊天。详见[配置与执行流程](skills/autodl-autograb/references/workflow.md)、[英文流程](skills/autodl-autograb/references/workflow.en.md)和[配置示例](examples/create.json)。

`check` 仅读取库存和报价；`buy`/`job start` 会提交付费请求。预算属于客户端提交前报价检查，平台没有服务端价格锁。克隆必须目标 running 且平台数据复制明确成功后才报完成，平台成功状态不等于逐文件校验。pending 或未知订单先查控制台，不删除状态来重试。

## 开发与下载

```sh
npm test
npm run validate
```

测试只使用模拟接口和临时目录，不访问真实付费 API。CI 在 Windows 和 Ubuntu 执行离线测试。[Releases](https://github.com/FuJincheng-01/autodl-autograb/releases) 提供独立 Skill 和插件 ZIP。

本项目为非官方独立工具，使用可能变化的 AutoDL 网页接口。请使用自己的账号并遵守平台规则与限流，实际费用以平台为准；不包含验证码绕过或自动数据清理。不要提交令牌和任务订单。问题反馈规则见 [SECURITY.md](SECURITY.md)。开源协议：[MIT](LICENSE)。
