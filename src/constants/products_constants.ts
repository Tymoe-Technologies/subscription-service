// src/constants/products_constants.ts
export const PRODUCTS = {
  PLOML: 'ploml',
  MOPAI: 'mopai',
} as const;

export type ProductKey = (typeof PRODUCTS)[keyof typeof PRODUCTS];

export const SUBSCRIPTION_STATUS = [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'incompleted',
] as const;
