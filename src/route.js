const HEAVY = /\b(implement|refactor|write (the )?code|architecture|migrate)\b/i;

/** Planning estimate only. Not a certified life-cycle assessment. */
export const KG_PER_1K = {
  small: 0.0002,
  large: 0.002,
};

export const DEFAULT_BUDGET_KG = 0.05;

export function pickModel(compiledText, env = {}, opts = {}) {
  const tokens = Math.ceil(String(compiledText).length / 4);
  const heavy = HEAVY.test(compiledText) || tokens >= 500;
  let tier = heavy ? "large" : "small";
  let diverted = false;
  const sessionCarbonKg = opts.sessionCarbonKg ?? 0;
  const budgetKg = opts.budgetKg ?? Number(env.CARBON_BUDGET_KG || DEFAULT_BUDGET_KG);
  const projected = sessionCarbonKg + (tokens / 1000) * KG_PER_1K[tier];
  if (tier === "large" && projected > budgetKg) {
    tier = "small";
    diverted = true;
  }
  const model = tier === "small"
    ? (env.MODEL_SMALL || "gpt-4o-mini")
    : (env.MODEL_LARGE || "gpt-4o");
  const carbonKg = (tokens / 1000) * KG_PER_1K[tier];
  return { tier, model, tokens, diverted, carbonKg, budgetKg, sessionCarbonKg };
}
