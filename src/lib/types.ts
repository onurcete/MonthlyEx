export type Card = { id: string; name: string; lastFour: string };
export type Category = { id: string; name: string; parentId: string | null };
export const categoryDefinitions = [
  { id: "default-1", name: "Yeme & İçme", children: ["Restoran", "Kafe", "Bar / Meyhane", "Yemek Siparişi"] },
  { id: "default-0", name: "Market & Günlük İhtiyaçlar", children: ["Süpermarket / Bakkal", "Manav / Kasap", "Temizlik & Bakım Ürünleri", "Tütün"] },
  { id: "default-3", name: "Alışveriş", children: ["Giyim & Ayakkabı", "Elektronik", "Kişisel Eşyalar", "Ev Ürünleri"] },
  { id: "default-4", name: "Faturalar", children: ["Elektrik", "Su", "Doğalgaz", "İnternet", "Telefon"] },
  { id: "default-5", name: "Abonelikler", children: ["Film & Müzik", "Yazılım & Uygulama", "Diğer Abonelikler"] },
  { id: "default-2", name: "Ulaşım", children: ["Toplu Taşıma", "Taksi", "Yakıt", "Otopark & Geçiş", "Araç Bakımı & Sigortası"] },
  { id: "default-6", name: "Sağlık & Kişisel Bakım", children: ["Doktor & Hastane", "İlaç", "Diş", "Kuaför & Bakım"] },
  { id: "default-8", name: "Eğlence & Hobiler", children: ["Sinema & Etkinlik", "Oyun", "Hobi Malzemeleri", "Spor & Fitness"] },
  { id: "default-7", name: "Seyahat", children: ["Uçak / Şehirlerarası Bilet", "Konaklama", "Tur & Gezi", "Vize & Seyahat Sigortası"] },
  { id: "default-9", name: "Diğer", children: [] },
] as const;
export const defaultCategories: Category[] = categoryDefinitions.flatMap(item => [
  { id: item.id, name: item.name, parentId: null } as Category,
  ...item.children.map((name, index) => ({ id: `${item.id}-sub-${index}`, name, parentId: item.id })),
]);
export const legacyCategoryIds: Record<string, string> = { "Market": "default-0", "Restoran / Kafe": "default-1", "Ulaşım": "default-2", "Alışveriş": "default-3", "Faturalar": "default-4", "Abonelikler": "default-5", "Sağlık": "default-6", "Seyahat": "default-7", "Eğitim": "default-9", "Diğer": "default-9" };
export type Expense = { id: string; cardId: string; date: string; merchant: string; amount: number; category: string; kind: "expense" | "refund"; statementId?: string | null; reportingMonth?: string | null };
export type Statement = { id: string; name: string; createdAt: string; status: string; error?: string | null; month?: string | null; netSpending?: number | null; statementBalance?: number | null };
export type AppData = { cards: Card[]; expenses: Expense[]; statements: Statement[]; categories: Category[]; aiConfigured?: boolean };
