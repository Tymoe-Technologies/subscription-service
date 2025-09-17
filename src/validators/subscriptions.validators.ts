import { z } from 'zod';

export const SummaryQuerySchema = z.object({
  tenantId: z.string().min(1, 'tenantId required'),
});

export type SummaryQuery = z.infer<typeof SummaryQuerySchema>;
