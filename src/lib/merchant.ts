export function merchantKey(merchant: string): string {
  const key = merchant.normalize("NFKD").toLocaleLowerCase("tr").replace(/ı/g, "i").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  // Keep branch names, payment providers and reference numbers: no fuzzy merging.
  return key.length >= 2 && /\p{L}/u.test(key) ? key : "";
}
export type CategoryLearning = {
  source: "learned" | "conflict";
  examples: number;
  originalCategory: string;
  originalNeedsReview: boolean;
  learnedCategories?: string[];
  matchType?: "exact" | "similar";
};
