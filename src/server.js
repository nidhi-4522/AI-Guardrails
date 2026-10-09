import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compilePrompt } from "./compile.js";
import { appendLedger } from "./ledger.js";
import { loadHmacKey, writeReceipt } from "./receipt.js";
import { assessRisk, createPendingStore } from "./risk.js";
import { pickModel } from "./route.js";
import { toSharp } from "./sharp.js";
import { Vault, finalizeForUser } from "./vault.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sessions = new Map();
const pending = createPendingStore(ROOT);

export function loadEnv(text) {
  const env = {};
  for (const line of String(text).split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const cut = trimmed.indexOf("=");
    if (cut < 1) continue;
    env[trimmed.slice(0, cut).trim()] = trimmed.slice(cut + 1).trim();
  }
  return env;
}

function readDotEnv() {
  try {
    return loadEnv(readFileSync(join(ROOT, ".env"), "utf8"));
  } catch {
    return {};
  }
}

export function runtimeEnv() {
  return { ...readDotEnv(), ...process.env };
}

function sessionOf(sessionId) {
  const id = sessionId || "default";
  if (!sessions.has(id)) sessions.set(id, { carbonKg: 0 });
  return sessions.get(id);
}

export async function callOpenAI({ model, key, messages, fetchImpl }) {
  const fetchFn = fetchImpl ?? fetch;
  const response = await fetchFn("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model, messages, max_tokens: 800 }),
    signal: AbortSignal.timeout(60000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`openai ${response.status}`);
  return data.choices?.[0]?.message?.content ?? "";
}

function assistantBody(content, meta) {
  return {
    choices: [{ message: { role: "assistant", content } }],
    meta,
    model: meta.model,
    hidden: meta.hidden,
    shortened: meta.shortened,
    beforeChars: meta.beforeChars,
    afterChars: meta.afterChars,
    diverted: meta.diverted,
    needsApproval: meta.needsApproval,
    approvalId: meta.approvalId,
    riskReasons: meta.riskReasons,
  };
}

async function runCompiled({ compiled, messages, apiKey, env, fetchImpl, sessionId, approvedBy }) {
  const session = sessionOf(sessionId);
  const route = pickModel(compiled.text, env, { sessionCarbonKg: session.carbonKg });
  const key = String(apiKey || env.OPENAI_API_KEY || "").trim();
  const hmac = loadHmacKey(ROOT);
  const baseMeta = {
    workItem: compiled.workItem,
    kept: compiled.kept,
    hidden: compiled.hidden,
    shortened: compiled.shortened,
    beforeChars: compiled.beforeChars,
    afterChars: compiled.afterChars,
    tier: route.tier,
    model: route.model,
    tokens: route.tokens,
    diverted: route.diverted,
    carbonKg: route.carbonKg,
    approvedBy: approvedBy || null,
  };

  if (!key) {
    const receipt = writeReceipt(ROOT, {
      receiptId: `r_${Date.now()}`,
      ...baseMeta,
      risk: "none",
      answer: "needs_key",
    }, hmac);
    appendLedger(ROOT, { workItem: compiled.workItem, tokens: route.tokens, model: route.model, tier: route.tier, diverted: route.diverted, held: false });
    return {
      status: 200,
      body: assistantBody("", { ...baseMeta, needsKey: true, receiptId: receipt.receiptId }),
    };
  }

  const modelText = await callOpenAI({ model: route.model, key, messages, fetchImpl });
  session.carbonKg += route.carbonKg;
  const restored = finalizeForUser(modelText, compiled.vault);
  const answer = toSharp(restored);
  const receipt = writeReceipt(ROOT, {
    receiptId: `r_${Date.now()}`,
    ...baseMeta,
    risk: approvedBy ? "approved" : "none",
    answer: "ok",
  }, hmac);
  appendLedger(ROOT, {
    workItem: compiled.workItem,
    tokens: route.tokens,
    model: route.model,
    tier: route.tier,
    diverted: route.diverted,
    held: false,
    approvedBy: approvedBy || null,
  });
  return {
    status: 200,
    body: assistantBody(answer, { ...baseMeta, receiptId: receipt.receiptId }),
  };
}

export async function proxyChatCompletion({ body, apiKey, env, fetchImpl, sessionId, skipRisk = false }) {
  const vault = new Vault();
  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const last = [...incoming].reverse().find((message) => message.role === "user" && typeof message.content === "string");
  const userText = last?.content || "";
  const compiled = compilePrompt(userText, vault);
  const messages = incoming.map((message, index) => {
    if (typeof message.content !== "string") return message;
    if (index === incoming.length - 1 && message.role === "user") {
      return { role: "user", content: compiled.text };
    }
    return { role: message.role, content: vault.tokenize(message.content).text };
  });

  if (!skipRisk) {
    const risk = assessRisk(userText);
    if (risk.high) {
      const pendingRecord = pending.save({
        originalText: userText,
        history: incoming.slice(0, -1),
        apiKey: String(apiKey || env.OPENAI_API_KEY || ""),
        sessionId: sessionId || "default",
        riskReasons: risk.reasons,
        workItem: compiled.workItem,
      });
      const hmac = loadHmacKey(ROOT);
      writeReceipt(ROOT, {
        receiptId: `r_${Date.now()}`,
        workItem: compiled.workItem,
        kept: compiled.kept,
        hidden: compiled.hidden,
        shortened: compiled.shortened,
        beforeChars: compiled.beforeChars,
        afterChars: compiled.afterChars,
        tier: null,
        model: null,
        tokens: compiled.tokens,
        diverted: false,
        risk: "held",
        approvalId: pendingRecord.approvalId,
        approvedBy: null,
      }, hmac);
      appendLedger(ROOT, { workItem: compiled.workItem, tokens: 0, model: null, tier: null, diverted: false, held: true });
      const note = toSharp(`Human approval required before this high-risk ask runs. Reasons: ${risk.reasons.join(", ")}. Approval id: ${pendingRecord.approvalId}. POST /v1/approve with that id.`);
      return {
        status: 200,
        body: assistantBody(note, {
          workItem: compiled.workItem,
          kept: compiled.kept,
          hidden: compiled.hidden,
          shortened: compiled.shortened,
          beforeChars: compiled.beforeChars,
          afterChars: compiled.afterChars,
          needsApproval: true,
          approvalId: pendingRecord.approvalId,
          riskReasons: risk.reasons,
          diverted: false,
          model: null,
          tier: null,
        }),
      };
    }
  }

  return runCompiled({
    compiled,
    messages,
    apiKey,
    env,
    fetchImpl,
    sessionId,
  });
}

export async function approveRequest({ approvalId, env, fetchImpl }) {
  const record = pending.take(approvalId);
  if (!record) {
    return { status: 404, body: { error: "approval_not_found_or_expired" } };
  }
  const vault = new Vault();
  const compiled = compilePrompt(record.originalText, vault);
  const history = Array.isArray(record.history) ? record.history : [];
  const messages = [
    ...history.map((message) => (
      typeof message.content === "string"
        ? { role: message.role, content: vault.tokenize(message.content).text }
        : message
    )),
    { role: "user", content: compiled.text },
  ];
  return runCompiled({
    compiled,
    messages,
    apiKey: record.apiKey,
    env,
    fetchImpl,
    sessionId: record.sessionId,
    approvedBy: "human",
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new Error("bad_json")); }
    });
    req.on("error", reject);
  });
}

export function createApp(env = runtimeEnv(), fetchImpl) {
  return createServer(async (req, res) => {
    try {
      const url = (req.url || "/").split("?")[0];
      if (req.method === "GET" && url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, plugin: "trimble-prompt-compiler" }));
        return;
      }
      if (req.method === "POST" && url === "/v1/approve") {
        const body = await readBody(req);
        const result = await approveRequest({ approvalId: body.approvalId, env, fetchImpl });
        res.writeHead(result.status, { "content-type": "application/json" });
        res.end(JSON.stringify(result.body));
        return;
      }
      if (req.method !== "POST" || !url.startsWith("/v1/chat/completions")) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
        return;
      }
      const body = await readBody(req);
      const header = req.headers.authorization || "";
      const apiKey = header.startsWith("Bearer ") ? header.slice(7) : body.apiKey;
      const result = await proxyChatCompletion({
        body,
        apiKey,
        env,
        fetchImpl,
        sessionId: body.sessionId || req.headers["x-session-id"] || "default",
      });
      res.writeHead(result.status, { "content-type": "application/json" });
      res.end(JSON.stringify(result.body));
    } catch {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "compiler_failed_open_no_model" }));
    }
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.env.PORT || 8787);
  createApp().listen(port, "127.0.0.1", () => {
    process.stdout.write(`Trimble Prompt Compiler on http://127.0.0.1:${port}/v1\n`);
  });
}
