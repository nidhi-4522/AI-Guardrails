import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Vault, finalizeForUser, preparePrompt } from "./guard.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KG = { small: 0.0002, large: 0.002 };
const BUDGET = 0.05;

const MODELS = {
  openai: { small: "gpt-4o-mini", large: "gpt-4o" },
  anthropic: { small: "claude-3-5-haiku-latest", large: "claude-sonnet-4-5" },
  gemini: { small: "gemini-2.0-flash", large: "gemini-2.5-flash" },
};

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

function providerOf(env) {
  if (env.OPENAI_API_KEY) return "openai";
  if (env.ANTHROPIC_API_KEY) return "anthropic";
  if (env.GEMINI_API_KEY) return "gemini";
  return null;
}

function providerFromKey(key) {
  if (key.startsWith("sk-ant-")) return "anthropic";
  if (key.startsWith("AIza")) return "gemini";
  return "openai";
}

function modelFor(env, provider, tier) {
  if (tier === "small" && env.MODEL_SMALL) return env.MODEL_SMALL;
  if (tier === "large" && env.MODEL_LARGE) return env.MODEL_LARGE;
  return MODELS[provider][tier];
}

export async function callModel({ provider, model, key, messages, fetchImpl }) {
  const fetchFn = fetchImpl ?? fetch;
  if (provider === "openai") {
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
  if (provider === "anthropic") {
    const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n");
    const chat = messages.filter((message) => message.role !== "system").map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content,
    }));
    const response = await fetchFn("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model, max_tokens: 800, system: system || undefined, messages: chat }),
      signal: AbortSignal.timeout(60000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`anthropic ${response.status}`);
    return (data.content ?? []).map((part) => part.text ?? "").join("");
  }
  const contents = messages.filter((message) => message.role !== "system").map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));
  const response = await fetchFn(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents }),
      signal: AbortSignal.timeout(60000),
    },
  );
  const data = await response.json();
  if (!response.ok) throw new Error(`gemini ${response.status}`);
  return (data.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("");
}

function sessionFor(store, sessionId) {
  const id = sessionId || "default";
  if (!store.has(id)) store.set(id, { vault: new Vault(), messages: [], carbon: 0 });
  return store.get(id);
}

function guardBody(prepared, extra = {}) {
  return {
    hidden: prepared.types,
    shortened: prepared.shortened,
    beforeChars: prepared.beforeChars,
    afterChars: prepared.afterChars,
    tier: prepared.tier,
    ...extra,
  };
}

export async function answerQuestion({ message, sessionId, store, env, fetchImpl, apiKey }) {
  const session = sessionFor(store, sessionId);
  const prepared = preparePrompt(message, session.vault);
  const typedKey = String(apiKey ?? "").trim();
  const provider = typedKey ? providerFromKey(typedKey) : providerOf(env);
  if (!provider) {
    return { status: 200, body: guardBody(prepared, { answer: "", needsKey: true }) };
  }
  const added = (prepared.tokens / 1000) * KG[prepared.tier];
  if (session.carbon + added > BUDGET) {
    return { status: 403, body: guardBody(prepared, { error: "This session used its energy budget. Close the window and start again." }) };
  }
  session.messages.push({ role: "user", content: prepared.text });
  session.messages = session.messages.slice(-8);
  const model = modelFor(env, provider, prepared.tier);
  const key = typedKey || env[`${provider === "openai" ? "OPENAI" : provider === "anthropic" ? "ANTHROPIC" : "GEMINI"}_API_KEY`];
  let modelText;
  try {
    modelText = await callModel({ provider, model, key, messages: session.messages, fetchImpl });
  } catch (error) {
    session.messages.pop();
    const status = String(error.message || "");
    const rejected = / 401| 403/.test(status) ? "The model company rejected the key. Check the key and start again." : "The model did not answer. Check the key and your network, then try again.";
    return { status: 502, body: { error: rejected } };
  }
  session.carbon += added;
  const answer = finalizeForUser(modelText, session.vault);
  session.messages.push({ role: "assistant", content: modelText });
  return { status: 200, body: guardBody(prepared, { answer, model }) };
}

export async function proxyChatCompletion({ body, apiKey, env, fetchImpl }) {
  const key = String(apiKey || env.OPENAI_API_KEY || "").trim();
  const vault = new Vault();
  const incoming = Array.isArray(body.messages) ? body.messages : [];
  let meta = { hidden: [], shortened: false, beforeChars: 0, afterChars: 0 };
  const messages = incoming.map((message, index) => {
    if (typeof message.content !== "string") return message;
    const lastUser = index === incoming.length - 1;
    if (lastUser) {
      const prepared = preparePrompt(message.content, vault);
      meta = prepared;
      return { role: message.role, content: prepared.text };
    }
    return { role: message.role, content: vault.tokenize(message.content).text };
  });
  if (!key) {
    return { status: 200, body: { choices: [{ message: { role: "assistant", content: "" } }], needsKey: true, ...meta } };
  }
  const modelText = await callModel({
    provider: "openai",
    model: body.model || "gpt-4o-mini",
    key,
    messages,
    fetchImpl,
  });
  return {
    status: 200,
    body: {
      choices: [{ message: { role: "assistant", content: finalizeForUser(modelText, vault) } }],
      model: body.model || "gpt-4o-mini",
      hidden: meta.types || meta.hidden,
      shortened: meta.shortened,
      beforeChars: meta.beforeChars,
      afterChars: meta.afterChars,
    },
  };
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
      const url = req.url || "/";
      if (req.method === "GET" && url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
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
      const result = await proxyChatCompletion({ body, apiKey, env, fetchImpl });
      res.writeHead(result.status, { "content-type": "application/json" });
      res.end(JSON.stringify(result.body));
    } catch {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "The guard stopped this request." }));
    }
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.env.PORT || 8787);
  createApp().listen(port, "127.0.0.1", () => {
    process.stdout.write(`Layer on http://127.0.0.1:${port}/v1\n`);
  });
}
