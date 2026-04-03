export interface StockHolding {
  id: string;
  ticker: string;
  shares: number;
  avgPrice: number;
  currency: 'USD' | 'KRW';
  currentPrice?: number;
  lastUpdated?: string;
}

export interface PortfolioSummary {
  totalValue: number;
  totalCost: number;
  totalGainLoss: number;
  totalGainLossPercentage: number;
}
