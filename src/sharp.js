const FILLER = /\b(please|just|really|actually|basically|literally|certainly|simply|um+|uh+)\b/gi;
const KEEP_ID = /\b(JOB-\d+|RUN-\d+|EMP-\d+|\[\[TMBL_[^\]]+\]\])/g;

/** Local sharp pass: answer-first, terse, keep job ids. No second model call. */
export function toSharp(text) {
  let out = String(text ?? "").trim();
  if (!out) return out;
  const ids = out.match(KEEP_ID) || [];
  out = out.replace(FILLER, " ");
  out = out.replace(/\s+/g, " ").trim();
  const sentences = out.split(/(?<=[.!?])\s+/).filter(Boolean);
  const kept = sentences.slice(0, 5).map((sentence) => {
    let line = sentence.trim();
    if (/^(sure|certainly|of course|happy to|i'd be happy)/i.test(line)) {
      line = line.replace(/^(sure|certainly|of course|happy to help|i'd be happy to help)[,!.]?\s*/i, "");
    }
    return line;
  }).filter(Boolean);
  let result = kept.join(" ");
  for (const id of ids) {
    if (!result.includes(id.replace(/\s+/g, " ")) && !result.includes(id)) {
      result = `${id}. ${result}`;
    }
  }
  return result.trim();
}
