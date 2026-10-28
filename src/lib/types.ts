export const categories = ["Market", "Restoran / Kafe", "Ulaşım", "Alışveriş", "Faturalar", "Abonelikler", "Sağlık", "Seyahat", "Eğitim", "Diğer"] as const;
export type Card = { id: string; name: string; lastFour: string };
export type Expense = { id: string; cardId: string; date: string; merchant: string; amount: number; category: string; kind: "expense" | "refund" };
export type Statement = { id: string; name: string; createdAt: string; status: string };
export type AppData = { cards: Card[]; expenses: Expense[]; statements: Statement[] };
