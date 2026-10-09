import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function loadHmacKey(rootDir) {
  const path = join(rootDir, ".guard-key");
  try {
    const key = readFileSync(path);
    if (key.length === 32) return key;
  } catch {
    // create below
  }
  const key = randomBytes(32);
  writeFileSync(path, key);
  return key;
}

export function signReceipt(body, key) {
  const payload = JSON.stringify(body);
  const signature = createHmac("sha256", key).update(payload).digest("hex");
  return { ...body, signature };
}

export function verifyReceipt(receipt, key) {
  const { signature, ...body } = receipt;
  const expected = createHmac("sha256", key).update(JSON.stringify(body)).digest("hex");
  return signature === expected;
}

export function writeReceipt(rootDir, receipt, key) {
  const dir = join(rootDir, "data", "receipts");
  mkdirSync(dir, { recursive: true });
  const signed = signReceipt(receipt, key);
  appendFileSync(join(dir, "receipts.jsonl"), `${JSON.stringify(signed)}\n`);
  return signed;
}
