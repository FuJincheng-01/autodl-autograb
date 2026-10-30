# Configuration and execution

Use absolute paths. SCRIPTS is the scripts directory beside SKILL.md. Read examples/create.json in the repository as a template, but keep the skill self-contained: use `job.mjs` defaults and the fields below if only the skill was installed.

Required user choices: operation=create|clone, regionName, exact gpuModel, gpuCount=1, extraDataDiskGb (0–500), maxGpuHourlyCny, maxDiskDailyCny, imagePreference or baseImageUuid for fresh rental, sourceInstanceUuid for cloning, and subUser. Optional validated filters: minGpuMemoryGb and machineIds. minCpuCores/minMemoryGb must remain 0 until supported.

Create the parent of a fresh absolute job path. Save these choices as INPUT.json, without credentials. `init` adds defaults including sparse/data copy=true and polling/timeouts.

```text
node SCRIPTS/job.mjs init ABS_JOB ABS_INPUT_JSON
node SCRIPTS/grab.mjs setup --job ABS_JOB
node SCRIPTS/grab.mjs check --job ABS_JOB
node SCRIPTS/job.mjs start ABS_JOB
node SCRIPTS/job.mjs status ABS_JOB
node SCRIPTS/job.mjs stop ABS_JOB
```

setup requires a local interactive terminal with hidden input. The user supplies their own token locally; do not put it in chat or shell arguments. AUTODL_AUTHORIZATION is supported by grab; background job start requires local job/auth.txt. Never reuse another task's credentials or order state.

`check` is read-only. `start` can spend money; require the user's task authorization, GPU budget and disk budget first. Paid expansion means additional capacity; the supported advertised free disk is 50GiB. Record actual platform filesystem capacity instead of assuming advertised and physical sizes match. Cloning never shrinks the source's paid expansion. System disk support is 30GiB.

Check run.lock's PID and command including the exact ABS_JOB after start. Never run two monitors for the same job. Unknown payment results retain pending: inspect the console before retrying. Accepted/cloning with an exited monitor may resume follow, never a new purchase. Treat successful states as durable duplicate-order latches. Only explicit inventory rejection permits another order attempt.

stop writes stop.request; it does not release/shut down resources. In-flight paid requests record their outcome before exit. Resume only at the user's request after checking state; do not reset state automatically.

Use the host's scheduler, when available, for quiet follow-up every three minutes. Notify once on accepted, completion, failure or required action; record notification-state.json and remove the follow-up on delivery. If scheduling is unavailable, disclose that only the local process continues. A fresh instance must be running; a clone must be running with explicit Succeed/Success/Succeeded/Completed data-copy status. Occupancy is not a file checksum check. Do not clean, move, optimize, shut down or release any source/target experiment files or disks.

When inspecting API results, emit only UUID/status/region/GPU/disk/image/copy fields; full responses can contain SSH secrets. Package only an explicit file allowlist, excluding tokens, environment files, logs and run.lock; preserve success/pending state for that user's own task handoff, but never publish private job state in this repository.
