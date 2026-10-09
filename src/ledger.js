import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export function appendLedger(rootDir, row) {
  const dir = join(rootDir, "data");
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "ledger.jsonl"), `${JSON.stringify({ ...row, at: new Date().toISOString() })}\n`);
}
