import { randomBytes } from "node:crypto";

const RULES = [
  { type: "PRIVATE_KEY", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { type: "CONN", re: /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?):\/\/[^\s'"]+/gi },
  { type: "API_KEY", re: /\b(?:sk-ant-[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})/g },
  { type: "PASSWORD", re: /(?:password|passwd|pwd)\s*[:=]\s*([^\s,;]+)/gi, group: 1 },
  { type: "EMP_ID", re: /\bEMP-\d{3,8}\b/g },
  { type: "EMAIL", re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
];

const TOKEN = /\[\[TMBL_([A-Z_]+)_([a-f0-9]{8})\]\]/g;
const SECRET_FILE = /(^|\/)\.env$|\.pem$|id_rsa$|credentials\.json$|(^|\/)secrets\//i;
const EGRESS = /\b(curl|wget|nc|ncat|Invoke-WebRequest|Invoke-RestMethod|iwr)\b/i;
const URL = /https?:\/\//i;
const FILLER_WORD = /^(please|just|really|actually|basically|literally|um+|uh+|like|very|so)$/i;
const HEAVY = /\b(implement|refactor|write (the )?code|architecture|migrate)\b/i;
const MAX_CHARS = 1200;

export function detect(text) {
  if (!text) return [];
  const found = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let match;
    while ((match = rule.re.exec(text)) !== null) {
      const value = rule.group ? match[rule.group] : match[0];
      if (!value) continue;
      const start = match.index + match[0].indexOf(value);
      found.push({ type: rule.type, start, end: start + value.length, value });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept = [];
  let cursor = -1;
  for (const span of found) {
    if (span.start < cursor) continue;
    kept.push(span);
    cursor = span.end;
  }
  return kept;
}

export class Vault {
  constructor() {
    this.byValue = new Map();
    this.byToken = new Map();
  }

  tokenFor(type, value) {
    const key = `${type}\0${value}`;
    const existing = this.byValue.get(key);
    if (existing) return existing;
    const token = `[[TMBL_${type}_${randomBytes(4).toString("hex")}]]`;
    this.byValue.set(key, token);
    this.byToken.set(token, value);
    return token;
  }

  tokenize(text) {
    const spans = detect(text);
    if (!spans.length) return { text, types: [] };
    let out = "";
    let cursor = 0;
    const types = [];
    for (const span of spans) {
      out += text.slice(cursor, span.start);
      out += this.tokenFor(span.type, span.value);
      types.push(span.type);
      cursor = span.end;
    }
    return { text: out + text.slice(cursor), types: [...new Set(types)] };
  }

  detokenize(text) {
    return String(text).replace(TOKEN, (token) => this.byToken.get(token) ?? token);
  }

  redactNewSecrets(modelText) {
    const spans = detect(modelText).filter((span) => !this.byToken.has(span.value));
    if (!spans.length) return modelText;
    let out = "";
    let cursor = 0;
    for (const span of spans) {
      out += modelText.slice(cursor, span.start);
      out += "[redacted]";
      cursor = span.end;
    }
    return out + modelText.slice(cursor);
  }
}

export function finalizeForUser(modelText, vault) {
  return vault.detokenize(vault.redactNewSecrets(modelText));
}

function uniqueLines(text) {
  const seen = new Set();
  const lines = [];
  for (const line of String(text).split(/\n+/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^(please|thanks|thank you|ok|okay|um+|uh+)\.?$/i.test(trimmed)) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(trimmed);
  }
  return lines;
}

function shouldRewrite(text, rawLines, lines) {
  if (text.length > MAX_CHARS) return true;
  if (rawLines.length >= 4 && lines.length <= rawLines.length / 2) return true;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 80) return false;
  const filler = words.filter((word) => FILLER_WORD.test(word)).length;
  return filler / words.length > 0.12;
}

/** Shorten a long or repetitive prompt. Secrets must already be tokens. */
export function rewritePrompt(text) {
  const original = String(text ?? "");
  const rawLines = original.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const lines = uniqueLines(original);
  if (!shouldRewrite(original, rawLines, lines)) {
    return { text: original, shortened: false, beforeChars: original.length, afterChars: original.length };
  }
  let packed = lines.join("\n");
  if (packed.length > MAX_CHARS) {
    const question = [...lines].reverse().find((line) => line.includes("?")) || lines[lines.length - 1] || "";
    const context = [];
    let size = question.length + 32;
    for (const line of lines) {
      if (line === question) continue;
      if (size + line.length > MAX_CHARS) break;
      context.push(line);
      size += line.length + 1;
    }
    packed = context.length
      ? `Question:\n${question}\n\nContext:\n${context.join("\n")}`
      : question.slice(0, MAX_CHARS);
  }
  packed = packed.replace(/\[\[TMBL_[A-Z0-9_]*$/, "");
  return { text: packed, shortened: packed !== original, beforeChars: original.length, afterChars: packed.length };
}

function secretPath(filePath) {
  return SECRET_FILE.test(String(filePath ?? "").replaceAll("\\", "/"));
}

function egressCommand(command) {
  return EGRESS.test(command) && URL.test(command);
}

export function hookDecision(event, input = {}) {
  try {
    if (event === "beforeSubmitPrompt") {
      const prompt = input.prompt || input.text || input.user_prompt || "";
      const types = [...new Set(detect(prompt).map((span) => span.type))];
      if (types.length) {
        return {
          continue: false,
          permission: "deny",
          user_message: "This message includes sensitive data. It was not sent. Start a new chat and send it again without the sensitive part. Do not continue in this chat.",
        };
      }
      return { continue: true, permission: "allow" };
    }
    if (event === "beforeReadFile") {
      const filePath = input.file_path || input.path || input.filePath || "";
      if (secretPath(filePath)) {
        return { permission: "deny", user_message: "That file can hold secrets. The guard blocked the read." };
      }
      return { permission: "allow" };
    }
    if (event === "beforeShellExecution") {
      const command = input.command || "";
      if (egressCommand(command)) {
        return {
          permission: "deny",
          user_message: "That command would send data off this laptop. The guard blocked it.",
          agent_message: "Egress blocked by the guard.",
        };
      }
      return { permission: "allow" };
    }
    return { continue: false, permission: "deny", user_message: "Guard failed closed." };
  } catch {
    return { continue: false, permission: "deny", user_message: "Guard failed closed." };
  }
}

export function preparePrompt(text, vault) {
  const hidden = vault.tokenize(String(text ?? ""));
  const rewritten = rewritePrompt(hidden.text);
  const tokens = Math.ceil(rewritten.text.length / 4);
  const heavy = HEAVY.test(rewritten.text) || tokens >= 500;
  return {
    text: rewritten.text,
    types: hidden.types,
    shortened: rewritten.shortened,
    beforeChars: rewritten.beforeChars,
    afterChars: rewritten.afterChars,
    tier: heavy ? "large" : "small",
    tokens,
  };
}
