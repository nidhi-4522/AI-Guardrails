const JOB_RE = /\bJOB-(\d{3,8})\b/gi;
const RUN_RE = /\bRUN-(\d{3,8})\b/gi;

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
  JOB_RE.lastIndex = 0;
  while ((match = JOB_RE.exec(text)) !== null) push("JOB", match[1]);
  RUN_RE.lastIndex = 0;
  while ((match = RUN_RE.exec(text)) !== null) push("RUN", match[1]);
  return kept;
}

export function workItemOf(kept) {
  const jobId = kept.find((item) => item.kind === "JOB");
  if (jobId) return `JOB-${jobId.value}`;
  const runId = kept.find((item) => item.kind === "RUN");
  if (runId) return `RUN-${runId.value}`;
  return "UNATTRIBUTED";
}
