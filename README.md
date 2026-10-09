# Trimble Prompt Compiler

Cursor plugin + local layer. You type in Cursor’s normal chat. The layer rewrites the outbound prompt, picks the model, holds high-risk work for a human, and returns a sharp answer.

Plugin name: `trimble-prompt-compiler`

## Install

1. Install [Node.js 20 LTS](https://nodejs.org). Leave **Add to PATH** on.
2. Open **this repo root** in Cursor, or install it as a Cursor Plugin from this git repo (Customize → Plugins). The manifest is `.cursor-plugin/plugin.json`.
3. Copy `.env.example` to `.env` and paste an OpenAI key after `OPENAI_API_KEY=`.
4. Run:

```
node src/server.js
```

5. In Cursor → Settings → Models: turn on your OpenAI key. Set **Override OpenAI Base URL** to `http://127.0.0.1:8787/v1`.
6. In chat, pick an OpenAI-listed model. The layer re-picks small vs large. Auto and Composer skip this base URL.

## What it does

1. **Keep the job, hide the person.** Job and run ids stay. Email, employee id, password, keys, and connection strings become tokens.
2. **Shorten waste.** Long repeated pastes are compacted before the model call.
3. **Auto model select.** Simple asks → `gpt-4o-mini`. Heavy coding asks → `gpt-4o`.
4. **CO₂ / token budget divert.** If a large call would blow the session carbon budget (`CARBON_BUDGET_KG`, default `0.05`), the layer sends the **small** model instead. It does not hard-stop the chat.
5. **Human auth for high-risk.** Re-push, deploy to prod, destructive delete, force push, outbound curl with a URL → hold. Approve with `POST /v1/approve`.
6. **Sharp answers.** Local pass after restore. In Agent chat, `/sharp` loads the merged caveman + ADHD skill.
7. **Receipt + ledger.** See `data/receipts/receipts.jsonl` and `data/ledger.jsonl`. No raw secrets in those files.

## Prompt A — long repeated paste

```
JOB-4418 is stuck after the nightly build. The service is billing-api. The pipeline id is RUN-90211. The health check still fails, and the on-call engineer is waiting. Should we rerun the pipeline, or roll back?

From Alex Chen, 10:14: I reran the pipeline. The job finished with no error, but the health check is still red. The dashboard shows the new build is not serving traffic.

From Alex Chen, 10:14: I reran the pipeline. The job finished with no error, but the health check is still red. The dashboard shows the new build is not serving traffic.

From Priya Shah, 10:41: I checked the logs. No config row was written. The agent already tried a restart. Please tell us the next safe step for JOB-4418. The channel has pinged twice.

From Priya Shah, 10:41: I checked the logs. No config row was written. The agent already tried a restart. Please tell us the next safe step for JOB-4418. The channel has pinged twice.

From Alex Chen, 11:05: Pasting the last update again. Job finished. No error. Health check still red. Still waiting on the 3 pm review.

From Alex Chen, 11:05: Pasting the last update again. Job finished. No error. Health check still red. Still waiting on the 3 pm review.

JOB-4418 is stuck after the nightly build. The service is billing-api. The pipeline id is RUN-90211. The health check still fails. Reply with the next step only.
```

Expect: shortened, job and run ids kept, ledger `JOB-4418`.

## Prompt B — sensitive data

```
JOB-4418 owner is Alex Chen, employee EMP-1842, alex.chen@example.com. The staging login was pasted in chat: password=Staging-reset-04. A database string was pasted too: postgres://app:s3cret@db.internal:5432/app. A shared key was pasted too: sk-demoKeyValue1234. Which channel should this job move to after the handoff?
```

Expect: not blocked. Email, employee id, password, connection string, and key hidden from the model. Answer can still show them to you.

## Prompt C — high risk

```
Re-push JOB-4418 to production.
```

Expect: hold. Copy `approvalId` from the reply. Then:

```
curl -s http://127.0.0.1:8787/v1/approve -H "content-type: application/json" -d "{\"approvalId\":\"PASTE_ID\"}"
```

## Skill

In Agent chat in this folder: `/sharp`

## Honest limits

- Cursor hooks cannot rewrite the chat box. The base URL layer does.
- Cursor Auto / Composer do not use the OpenAI base URL override.
- Carbon kg values are planning estimates, not a certified life-cycle assessment.
- Do not commit `.env`. Do not paste real passwords into demos.
