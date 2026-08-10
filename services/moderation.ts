export type ModerationDecision = {
  flagged: boolean;
  categories: string[];
  source: "openai" | "local";
  scores?: Record<string, number>;
};

const highRiskPatterns = [
  /\b(kill|hurt)\s+(you|yourself)\b/i,
  /\b(send|show)\s+(nudes?|explicit)\b/i,
  /\b(?:n[i1]gg(?:er|a)|f[a@]gg[o0]t)\b/i,
  /\b(?:doxx?|swat)\b/i,
];

export async function moderateText(input: string): Promise<ModerationDecision> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    try {
      const response = await fetch("https://api.openai.com/v1/moderations", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: "omni-moderation-latest", input }),
      });
      if (response.ok) {
        const payload = await response.json() as {
          results?: { flagged: boolean; categories: Record<string, boolean>; category_scores: Record<string, number> }[];
        };
        const result = payload.results?.[0];
        if (result) {
          return {
            flagged: result.flagged,
            categories: Object.entries(result.categories).filter(([, flagged]) => flagged).map(([category]) => category),
            source: "openai",
            scores: result.category_scores,
          };
        }
      }
    } catch {
      // A deterministic local guard remains active if the provider is unavailable.
    }
  }

  const flagged = highRiskPatterns.some((pattern) => pattern.test(input));
  return { flagged, categories: flagged ? ["local_high_risk"] : [], source: "local" };
}
