const RULES = [
  { type: "PRIVATE_KEY", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { type: "CONN", re: /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?):\/\/[^\s'"]+/gi },
  { type: "API_KEY", re: /\b(?:sk-ant-[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})/g },
  { type: "PASSWORD", re: /(?:password|passwd|pwd)\s*[:=]\s*([^\s,;]+)/gi, group: 1 },
  { type: "EMP_ID", re: /\bEMP-\d{3,8}\b/g },
  { type: "EMAIL", re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
];

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
