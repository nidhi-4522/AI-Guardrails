import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detect } from "./detect.js";
import { assessRisk } from "./risk.js";

const ALLOW = { continue: true, permission: "allow" };
const KEY_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", ".guard-key");

export function loadGuardKey() {
  try {
    const key = readFileSync(KEY_PATH);
    if (key.length === 32) return key;
  } catch {
    // create below
  }
  const key = randomBytes(32);
  writeFileSync(KEY_PATH, key);
  return key;
}

export function encryptSecrets(text, key) {
  const spans = detect(text);
  if (!spans.length) return text;
  let out = "";
  let cursor = 0;
  for (const span of spans) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const data = Buffer.concat([cipher.update(span.value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    out += text.slice(cursor, span.start);
    out += `[[TMBL:${iv.toString("base64url")}.${tag.toString("base64url")}.${data.toString("base64url")}]]`;
    cursor = span.end;
  }
  return out + text.slice(cursor);
}

function textOf(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((part) => textOf(part?.text ?? part)).join("\n");
  if (value && typeof value === "object") return textOf(value.text ?? value.prompt ?? value.command ?? "");
  return "";
}

export function eventOf(argvEvent, input = {}) {
  const named = input.hook_event_name || input.event || argvEvent || "";
  if (["beforeSubmitPrompt", "beforeShellExecution", "beforeMCPExecution", "beforeReadFile"].includes(named)) {
    return named;
  }
  if (input.prompt != null || input.user_prompt != null || input.text != null) return "beforeSubmitPrompt";
  if (typeof input.command === "string") return "beforeShellExecution";
  if (input.tool_name || input.toolName) return "beforeMCPExecution";
  return "";
}

export function hookDecision(event, input = {}, key = Buffer.alloc(32, 1)) {
  try {
    const kind = eventOf(event, input);
    if (kind === "beforeSubmitPrompt") {
      const prompt = textOf(input.prompt ?? input.text ?? input.user_prompt);
      const encrypted = encryptSecrets(prompt, key);
      if (encrypted !== prompt) return { ...ALLOW, updated_input: { prompt: encrypted } };
      return { ...ALLOW };
    }
    if (kind === "beforeShellExecution" || kind === "beforeMCPExecution") {
      const command = textOf(input.command ?? input.tool_input ?? input.arguments ?? "");
      const name = String(input.tool_name || input.toolName || "");
      const risk = assessRisk(`${name}\n${command}`, command);
      if (risk.high) {
        return {
          continue: true,
          permission: "ask",
          user_message: `High-risk action needs your OK: ${risk.reasons.join(", ")}`,
          agent_message: `High-risk: ${risk.reasons.join(", ")}`,
        };
      }
      return { ...ALLOW };
    }
    return { ...ALLOW };
  } catch {
    return { ...ALLOW };
  }
}
