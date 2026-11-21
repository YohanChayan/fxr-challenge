import type { Market } from '../../lib/schemas/user';

/** Display labels for the market picker and the "Saved: …" status. */
export const MARKET_LABELS: Record<Market, string> = {
  forex: 'Forex',
  crypto: 'Crypto',
  stocks: 'Stocks',
  indices: 'Indices',
  futures: 'Futures',
};
