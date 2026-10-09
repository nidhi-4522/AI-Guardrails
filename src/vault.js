import { randomBytes } from "node:crypto";
import { detect } from "./detect.js";

const TOKEN = /\[\[TMBL_([A-Z_]+)_([a-f0-9]{8})\]\]/g;

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
