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

1. **Keep the job, hide the person.** Case and order ids stay. Email, employee id, password, keys become tokens.
2. **Shorten waste.** Long repeated pastes are compacted before the model call.
3. **Auto model select.** Simple asks → `gpt-4o-mini`. Heavy coding asks → `gpt-4o`.
4. **CO₂ / token budget divert.** If a large call would blow the session carbon budget (`CARBON_BUDGET_KG`, default `0.05`), the layer sends the **small** model instead. It does not hard-stop the chat.
5. **Human auth for high-risk.** Re-push, enable entitlement, deploy to prod, destructive delete, outbound curl with a URL → hold. Approve with `POST /v1/approve`.
6. **Sharp answers.** Local pass after restore. In Agent chat, `/sharp` loads the merged caveman + ADHD skill.
7. **Receipt + ledger.** See `data/receipts/receipts.jsonl` and `data/ledger.jsonl`. No raw secrets in those files.

## Prompt A — long case paste

```
Case 184392 is stuck after the Oracle order sync. The customer is Northline Civil. The order is 521184. Assets are still missing on the account, and their project manager is on site waiting. Should we wait for the next batch, or open a defect?

From Maya Iyer, 10:14: I retried the sync. The batch finished with no error on the order, but the asset list on the account is still empty. The customer called and said the equipment is not on the account.

From Maya Iyer, 10:14: I retried the sync. The batch finished with no error on the order, but the asset list on the account is still empty. The customer called and said the equipment is not on the account.

From Luis Ortega, 10:41: I checked the case feed. No entitlement row was created. The agent already tried refresh and sign out. Please tell us the next safe step for order 521184. The customer has called twice.

From Luis Ortega, 10:41: I checked the case feed. No entitlement row was created. The agent already tried refresh and sign out. Please tell us the next safe step for order 521184. The customer has called twice.

From Maya Iyer, 11:05: Pasting the last update again so you have it. Batch finished. No error. Assets still empty. Customer still waiting on the 3 pm call.

From Maya Iyer, 11:05: Pasting the last update again so you have it. Batch finished. No error. Assets still empty. Customer still waiting on the 3 pm call.

Case 184392 is stuck after the Oracle order sync. The customer is Northline Civil. The order is 521184. Assets are still missing on the account. Reply with the next step only.
```

Expect: shortened, case/order kept, ledger `CASE-184392`.

## Prompt B — sensitive data

```
Case 184392 owner is Maya Iyer, employee EMP-1842, maya.iyer@trimble.com. She reset the staging login and pasted it in chat: password=Staging-reset-04. Which queue should this case move to after the transfer?
```

Expect: not blocked. Email, EMP id, password hidden from the model. Answer can still show them to you.

## Prompt C — high risk

```
Re-push order 521184 to production and enable the entitlement for Northline Civil.
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
