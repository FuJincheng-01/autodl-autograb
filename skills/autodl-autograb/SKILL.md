---
name: autodl-autograb
description: Wait for AutoDL GPU availability and rent one instance or sparsely clone a stopped instance. Collect GPU, region, expansion and budget choices; monitor or stop this skill's own local jobs.
---

Briefly announce use and reply in the user's language. Installation or mentioning this skill does not authorize payment. Start only when the user requests rental/cloning with clear configuration and budgets; existing explicit authorization remains valid.

## Configure

Collect only missing choices: create or clone; source UUID for clone; exact GPU model (single GPU); region; paid expansion GB (0–500); maximum GPU CNY/hour and disk expansion CNY/day; image preference or explicit public base-image UUID for create; main account or sub-account. Ask in the user's language, using native questions if the host supports them, otherwise concise text. Never pretend a UI was shown. Suggested vGPU-32GB budget 1.58 is an example, never a current quote or the default for other GPUs.

Optional filters: minimum GPU memory and machine_ids. CPU/RAM hard minimums are not implemented: explain the limitation before starting rather than ignoring a requirement. Support currently covers ordinary NVIDIA/x86 public images, 30GiB system disks and hosts advertising 50GiB free data disks. Physical filesystem capacity can differ: report actual target capacity. Clone in the same region, retain its image, copy system and data with sparse copying enabled, and never shrink source paid expansion.

Summarize chosen mode/source, GPU/region, storage, image, both budgets and sparse copying. Ask only for missing information or authorization; do not repeat questions already answered.

## Execute

Node.js20+, no npm dependencies, local executor required. Scripts are in `scripts/` beside this file. Read [English workflow](references/workflow.en.md) or [中文流程](references/workflow.md) for commands and job handling. Use native host tools where available; scheduling and question UI names differ across agents.

Create a unique job directory outside the installed skill/plugin source. `job.mjs init` initializes configuration; `grab.mjs setup --job ABS_JOB` obtains a token through hidden local input; check before start. Credentials belong to this user's selected account and job only: never ask for tokens in chat, print them, put them in shell arguments, or reuse other tasks' credentials. Use explicit supplied credentials/environment if already authorized.

Quote and validate both budgets before enabling paid monitoring. An unknown disk quote requires resolution before payment. `job.mjs start` starts buy or resumes follow as appropriate. Verify run.lock PID and command point to this script and ABS_JOB; do not start a second monitor. Unknown/timeout payment results keep pending and must be checked in the platform console, never replayed or cleared automatically. Only explicit stock rejection permits retry.

## Monitor and deliver

Stop means stop this job's monitor; do not shut down, release, clean or modify source/target experiment files. Resume only on the user's request after checking durable state.

When requested, use an available host scheduler for quiet follow-up every three minutes, recording this job's absolute path and notification flags. Notify only once on acceptance, completion, failure, expired login or needed action; no routine waiting updates. If no scheduler is available, disclose that only the local monitor continues. Preserve successful/pending state and remove follow-up after delivery; do not archive the chat.

Fresh rental must be running before reporting ready. Clone completion requires running plus explicit successful data-copy status, not just an instance record. Verify source ID, same region/GPU, image, system capacity, expansion and actual filesystem usage. Report disk differences read-only; do not optimize or change data. Platform copy success is not a per-file checksum check.

Package task handoffs with an explicit allowlist, excluding tokens, environment files, logs and run.lock while retaining durable order state against duplicates. Never publish a user's private job state in the open-source repository.
