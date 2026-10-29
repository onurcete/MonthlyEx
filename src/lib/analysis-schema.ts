import { z } from "zod";
import { defaultCategories, type Category } from "./types";

export const analysisRowSchema = z.object({
  date: z.iso.date(),
  merchant: z.string().trim().min(1).max(500),
  amount: z.number().int().positive().max(10000000000),
  currency: z.enum(["TRY", "USD", "EUR", "OTHER"]),
  category: z.string().min(1).max(200),
  kind: z.enum(["expense", "refund", "payment", "fee", "interest"]),
  installment: z.string().max(100).nullable(),
  page: z.number().int().positive(),
  needsReview: z.boolean(),
  // Optional for analyses saved before source amounts were collected.
  sourceAmount: z.string().min(1).max(80).optional(),
});
export const analysisSchema = z.object({
  bank: z.string().max(100).nullable(),
  lastFour: z.string().regex(/^\d{4}$/).nullable(),
  statementDate: z.iso.date().nullable(),
  dueDate: z.iso.date().nullable(),
  statementBalance: z.number().int().nullable(),
  summary: z.string().max(3000),
  warnings: z.array(z.string().max(1000)).max(100),
  rows: z.array(analysisRowSchema).max(2000),
});
export function createExtractionSchema(categories: Category[] = defaultCategories) {
  return analysisSchema.extend({
    rows: z.array(analysisRowSchema.extend({ sourceAmount: z.string().min(1).max(80), category: z.enum(categories.map(item => item.id) as [string, ...string[]]) })).max(2000),
  });
}
export type Analysis = z.infer<typeof analysisSchema>;
export type AnalysisRow = z.infer<typeof analysisRowSchema>;
