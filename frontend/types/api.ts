// Shared response envelopes. Observed shapes only — each matches a real backend
// response verified against the running API.
import { z } from "zod";

/** Offset pagination, as returned by GET /api/incidents. Not cursor-based. */
export const paginationSchema = z.object({
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
  hasMore: z.boolean(),
});

export type Pagination = z.infer<typeof paginationSchema>;

/** { data, pagination } — the list envelope. */
export function paginatedSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    pagination: paginationSchema,
  });
}

export type Paginated<T> = {
  data: T[];
  pagination: Pagination;
};

/**
 * Every backend error body observed so far is `{ error: string }`, sometimes with
 * `details` (zod fieldErrors) or `missing` (env names from the cron route).
 * All optional, so a bare { error } still parses.
 */
export const apiErrorBodySchema = z.object({
  error: z.string(),
  details: z.record(z.string(), z.array(z.string())).optional(),
  missing: z.array(z.string()).optional(),
});

export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;
