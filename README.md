# AutoDL AutoGrab

[English](README.md) | [简体中文](README.zh-CN.md)

A local agent skill and Codex plugin that waits for available AutoDL GPUs and rents **one** instance, or creates **one** sparse clone of an existing instance. Both installation formats share the same implementation.

## Features

- Configure exact GPU model, region, single-GPU allocation, GPU hourly cap and disk daily cap.
- Rent a fresh instance or clone a stopped instance, preserving its public base image and copying system and data disks with sparse copying enabled.
- Keep each job's configuration, credentials and durable order state separate. Write `pending` before payment; ambiguous results never trigger an automatic second order.
- Optional agent follow-up: notify on acceptance, completion or required action. Quiet during normal waiting/copying.
- Stop monitoring without shutting down or releasing instances or modifying experiment files.

## Requirements and current scope

Node.js **20+**, no npm dependencies, a local executor and your own AutoDL account. Codex CLI is required for the plugin commands below. Other agents can use the standalone skill if they support SKILL.md and local Node execution; host-specific installation and scheduling support varies.

Current support: **one GPU**, ordinary NVIDIA/x86 public-image containers, a 30GiB system disk and hosts advertising a 50GiB free data disk, with 0–500GiB paid expansion. Physical filesystem capacity can differ from advertised capacity: verify the actual target after copying. Hard CPU/RAM minimums are not implemented. Model/region availability and compatibility depend on AutoDL. CLI log messages are currently Chinese; agent replies should follow the user's language. Windows supports completion popups; other platforms use terminal output. Background follow-up needs a host scheduler; without one the agent must disclose that only the local monitor is running.

## Install as a Codex plugin

```sh
codex plugin marketplace add https://github.com/FuJincheng-01/autodl-autograb.git
codex plugin add autodl-autograb@autodl-autograb
codex plugin list --marketplace autodl-autograb --json
```

Verify `installed=true` and `enabled=true`, then open a new chat and select **AutoDL 自动抢卡** in the plugin menu. Refresh/reopen the desktop app if needed. Existing `@personal` or other-source installations are separate; check before enabling duplicates.

## Install as a standalone skill

Clone this repository into a permanent local directory, then install **the entire** `skills/autodl-autograb` folder into your agent's personal skills directory. For Codex, use `$CODEX_HOME/skills` if set, otherwise `~/.codex/skills`. Keep `scripts/`, `references/` and `agents/` together with `SKILL.md`. Preserve any existing same-name skill until its source/version is checked. Open a new chat and invoke `$autodl-autograb`.

For example, on macOS/Linux with the default Codex directory (stop if the destination already exists):

```sh
git clone https://github.com/FuJincheng-01/autodl-autograb.git
mkdir -p ~/.codex/skills
test ! -e ~/.codex/skills/autodl-autograb && cp -R autodl-autograb/skills/autodl-autograb ~/.codex/skills/
```

On Windows PowerShell with the default directory:

```powershell
git clone https://github.com/FuJincheng-01/autodl-autograb.git
$skillRoot = Join-Path $env:USERPROFILE '.codex/skills'
New-Item -ItemType Directory -Path $skillRoot -Force | Out-Null
if (Test-Path (Join-Path $skillRoot 'autodl-autograb')) { throw 'Existing skill: check before updating' }
Copy-Item -LiteralPath './autodl-autograb/skills/autodl-autograb' -Destination $skillRoot -Recurse
```

Choose the plugin **or** the skill. Installing either format does not log in or start a paid task.

## Copy this prompt into your agent

Use the copy button on this block. [English text](docs/INSTALL-PROMPT.en.txt) · [中文提示词](docs/INSTALL-PROMPT.zh-CN.txt)

```text
Install AutoDL AutoGrab from https://github.com/FuJincheng-01/autodl-autograb. Read README.md first. If this host supports Codex plugins, register the repository marketplace and install autodl-autograb@autodl-autograb; otherwise install the entire skills/autodl-autograb folder into this agent's supported personal skills directory. Choose one format, preserve existing settings, and check the source before updating any same-name installation. Verify plugin installed/enabled status or the skill entry point and scripts, then report the result and whether a new chat is needed. Installation only: do not log in to AutoDL, read other jobs' credentials, start monitoring, or create paid instances.
```

## Use

Example: “Clone my stopped AutoDL instance SOURCE_INSTANCE_ID in the same region, using one vGPU-32GB, no paid disk expansion, sparse copying enabled. GPU budget: CNY 1.58/hour; disk expansion budget: CNY 0/day. Start after checking the configuration and tell me when accepted and when copying is complete.” This is an example budget, not a current price quote.

The agent collects missing configuration and authorization, creates a fresh job directory, guides you through local credential setup, runs a read-only check, then starts only the requested job. Each user supplies their **own** main-account or sub-account login token locally; never paste it into chat. [Execution workflow](skills/autodl-autograb/references/workflow.md) · [English workflow](skills/autodl-autograb/references/workflow.en.md) · [Example configuration](examples/create.json).

`check` reads availability and quotes; `buy`/`job start` can incur charges. GPU and disk caps are client-side quote checks, not server-side price locks. A clone is complete only when the target is running and the platform explicitly reports data-copy success; this is not a per-file checksum verification. Never clear a pending order just to retry.

## Development

```sh
npm test
npm run validate
```

Tests use mocked endpoints and temporary jobs, never live purchase requests. CI runs them on Windows and Ubuntu. A standalone skill archive and plugin archive are available under [Releases](https://github.com/FuJincheng-01/autodl-autograb/releases).

This is an independent, unofficial project using AutoDL's website APIs, which may change. Use your own account, respect platform rules and rate limits, and check actual charges in AutoDL. No CAPTCHA bypass or automatic data cleanup is included. Keep credentials and job state out of Git. See [credential and issue-reporting guidance](SECURITY.md). MIT licensed; see [LICENSE](LICENSE).
