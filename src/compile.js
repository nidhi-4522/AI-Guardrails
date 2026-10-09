import { extractKeepIds, workItemOf } from "./classify.js";
import { Vault } from "./vault.js";

const FILLER_WORD = /^(please|just|really|actually|basically|literally|um+|uh+|like|very|so)$/i;
const MAX_CHARS = 1200;

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

export function compilePrompt(text, vault = new Vault()) {
  const original = String(text ?? "");
  const kept = extractKeepIds(original);
  const hidden = vault.tokenize(original);
  const rewritten = rewritePrompt(hidden.text);
  return {
    text: rewritten.text,
    kept,
    hidden: hidden.types,
    shortened: rewritten.shortened,
    beforeChars: rewritten.beforeChars,
    afterChars: rewritten.afterChars,
    workItem: workItemOf(kept),
    tokens: Math.ceil(rewritten.text.length / 4),
    vault,
  };
}
