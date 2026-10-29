import { merchantKey } from "./merchant";

const chains = [
  "migros", "macrocenter", "carrefoursa", "carrefour", "starbucks", "kahve dunyasi",
  "shell", "opet", "petrol ofisi", "a101", "bim", "sok", "getir", "yemeksepeti",
  "trendyol", "hepsiburada", "rossmann", "gratis", "watsons", "ikea", "koctas",
  "tekzen", "decathlon", "boyner", "zara", "lc waikiki", "defacto", "mavi",
  "burger king", "mcdonalds", "popeyes", "dominos", "espresso lab", "espressolab",
  "tchibo", "file market", "happy center", "kim market", "onur market",
];
const providers = new Set(["iyzico", "iyzi", "paytr", "paynet", "param", "sipay", "pos", "sanal", "odeme"]);
export function descriptionKey(value: string) {
  return merchantKey(value).split(" ").filter(token => !/^\d{4,}$/.test(token) && !/^(pos|ref|provizyon|islem)\d+$/.test(token) && !["as", "ltd", "sti", "tic", "ticaret", "anonim", "sirketi"].includes(token)).join(" ");
}
export function chainKey(value: string): string | null {
  const desc = descriptionKey(value);
  if (!desc) return null;
  const first = desc.split(" ")[0];
  if (providers.has(first)) return null;
  const matched = chains.find(chain => desc === chain || desc.startsWith(`${chain} `));
  return matched ?? null;
}
export function similarStatementMerchant(left: string, right: string) {
  const exact = merchantKey(left);
  if (!exact || !merchantKey(right)) return false;
  if (exact === merchantKey(right)) return true;
  const a = descriptionKey(left), b = descriptionKey(right);
  const first = a.split(" ")[0];
  if (!a || !b || providers.has(first) || providers.has(b.split(" ")[0])) return false;
  if (a === b && a.length >= 3) return true;
  // Only recognised retail chains share a category across different branches.
  // Other businesses need matching identity words; shared payment providers,
  // cities and generic descriptions alone never establish a match.
  if (chains.some(chain => (a === chain || a.startsWith(`${chain} `)) && (b === chain || b.startsWith(`${chain} `)))) return true;
  return false;
}

type CategorizedRow = { merchant: string; category: string; kind: string; currency: string; deleted?: boolean; rememberCategory?: boolean; learning?: unknown };
export function statementCategoryTargets<T extends CategorizedRow>(rows: T[], indices: number[]) {
  const sources = indices.filter(index => rows[index] && !rows[index].deleted && rows[index].currency === "TRY" && rows[index].kind !== "payment");
  return rows.flatMap((row, index) => !row.deleted && row.currency === "TRY" && row.kind !== "payment" && (sources.includes(index) || sources.some(source => similarStatementMerchant(rows[source].merchant, row.merchant))) ? [index] : []);
}
