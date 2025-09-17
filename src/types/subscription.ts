// src/types/subscription.ts
export interface SubscriptionSummaryDTO {
  tenantId: string;
  products: string[];
  plans: Record<string, string | null>;
  status: Record<string, string>;
  policyVersion: number;
  currentPeriodEnd: Record<string, string | null>;
}
