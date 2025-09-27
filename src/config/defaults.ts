export const DEFAULT_REGION = 'CA';
export const DEFAULT_CURRENCY = 'CAD';

export const SUPPORTED_REGIONS = {
  CA: 'Canada',
  US: 'United States',
  EU: 'European Union',
  GB: 'United Kingdom',
  AU: 'Australia',
} as const;

export const REGION_CURRENCIES = {
  CA: 'CAD',
  US: 'USD',
  EU: 'EUR',
  GB: 'GBP',
  AU: 'AUD',
} as const;

export const REGION_TIMEZONES = {
  CA: 'America/Toronto',
  US: 'America/New_York',
  EU: 'Europe/London',
  GB: 'Europe/London',
  AU: 'Australia/Sydney',
} as const;

export const REGION_STRIPE_ACCOUNTS = {
  CA: process.env.STRIPE_ACCOUNT_CA || process.env.STRIPE_SECRET_KEY,
  US: process.env.STRIPE_ACCOUNT_US || process.env.STRIPE_SECRET_KEY,
  EU: process.env.STRIPE_ACCOUNT_EU || process.env.STRIPE_SECRET_KEY,
  GB: process.env.STRIPE_ACCOUNT_GB || process.env.STRIPE_SECRET_KEY,
  AU: process.env.STRIPE_ACCOUNT_AU || process.env.STRIPE_SECRET_KEY,
} as const;

export type Region = keyof typeof SUPPORTED_REGIONS;
export type Currency = typeof REGION_CURRENCIES[Region];

export function getRegionCurrency(region: Region): Currency {
  return REGION_CURRENCIES[region];
}

export function getRegionTimezone(region: Region): string {
  return REGION_TIMEZONES[region];
}

export function getRegionStripeAccount(region: Region): string | undefined {
  return REGION_STRIPE_ACCOUNTS[region];
}

export function isValidRegion(region: string): region is Region {
  return region in SUPPORTED_REGIONS;
}

export function isValidCurrency(currency: string): currency is Currency {
  return (Object.values(REGION_CURRENCIES) as string[]).includes(currency);
}