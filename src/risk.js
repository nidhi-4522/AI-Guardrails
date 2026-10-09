import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const PATTERNS = [
  { reason: "republish", re: /\b(re-?push|republish)\b/i },
  { reason: "entitlement", re: /\b(enable|disable)\s+entitlement\b/i },
  { reason: "provision", re: /\b(de)?provision\b/i },
  { reason: "destructive_sql", re: /\b(drop\s+table|delete\s+from|truncate)\b/i },
  { reason: "destructive_fs", re: /\brm\s+-rf\b|Remove-Item\s+-Recurse/i },
  { reason: "egress", re: /\b(curl|wget|nc|ncat|Invoke-WebRequest|Invoke-RestMethod|iwr)\b[\s\S]{0,200}https?:\/\//i },
  { reason: "deploy_prod", re: /\bdeploy\s+to\s+prod(?:uction)?\b|\bpromote\s+to\s+production\b/i },
  { reason: "force_push", re: /\bforce\s+push\b|git\s+push\s+--force\b/i },
];

const TTL_MS = 15 * 60 * 1000;

export function assessRisk(text = "", tool = "") {
  const hay = `${text}\n${tool}`;
  const reasons = [];
  for (const rule of PATTERNS) {
    if (rule.re.test(hay)) reasons.push(rule.reason);
  }
  return { high: reasons.length > 0, reasons };
}

export function createPendingStore(rootDir) {
  const dir = join(rootDir, "data", "pending");
  mkdirSync(dir, { recursive: true });
  return {
    save(record) {
      const id = record.approvalId || randomBytes(8).toString("hex");
      const payload = { ...record, approvalId: id, createdAt: Date.now() };
      writeFileSync(join(dir, `${id}.json`), JSON.stringify(payload));
      return payload;
    },
    take(approvalId) {
      const path = join(dir, `${approvalId}.json`);
      let raw;
      try {
        raw = readFileSync(path, "utf8");
      } catch {
        return null;
      }
      unlinkSync(path);
      const payload = JSON.parse(raw);
      if (Date.now() - payload.createdAt > TTL_MS) return null;
      return payload;
    },
  };
}
