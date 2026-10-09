const CASE_RE = /\bCase\s+(\d{4,8})\b/gi;
const ORDER_RE = /\border(?:\s+is|\s+number)?\s+(\d{4,10})\b/gi;
const BARE_ORDER_RE = /\b(52\d{4,8})\b/g;

export function extractKeepIds(text) {
  const kept = [];
  const seen = new Set();
  const push = (kind, value) => {
    const id = `${kind}:${value}`;
    if (seen.has(id)) return;
    seen.add(id);
    kept.push({ kind, value });
  };
  let match;
  CASE_RE.lastIndex = 0;
  while ((match = CASE_RE.exec(text)) !== null) push("CASE", match[1]);
  ORDER_RE.lastIndex = 0;
  while ((match = ORDER_RE.exec(text)) !== null) push("ORDER", match[1]);
  BARE_ORDER_RE.lastIndex = 0;
  while ((match = BARE_ORDER_RE.exec(text)) !== null) push("ORDER", match[1]);
  return kept;
}

export function workItemOf(kept) {
  const caseId = kept.find((item) => item.kind === "CASE");
  if (caseId) return `CASE-${caseId.value}`;
  const orderId = kept.find((item) => item.kind === "ORDER");
  if (orderId) return `ORDER-${orderId.value}`;
  return "UNATTRIBUTED";
}
