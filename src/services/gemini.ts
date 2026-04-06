
const GOOGLE_SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRkMUUEJ2NG7DXfpZOksVoLeiPBwz6pHYQdgGWmHgFIY1Py2iJvuNeScUmP2l1Qky8RK__0RkKs1sX3/pub?gid=0&single=true&output=csv";

export const isGeminiConfigured = true;

export async function fetchStockPrices(holdings: { ticker: string, currency: string }[]): Promise<Record<string, number>> {
  if (holdings.length === 0) return {};

  try {
    console.log("Fetching stock prices from Google Sheets URL:", GOOGLE_SHEET_CSV_URL);
    const response = await fetch(GOOGLE_SHEET_CSV_URL, {
      method: 'GET',
      headers: {
        'Accept': 'text/csv'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const csvText = await response.text();
    console.log("CSV Data received (first 100 chars):", csvText.substring(0, 100));
    
    const lines = csvText.split(/\r?\n/);
    const priceMap: Record<string, number> = {};
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      // Simple CSV split (doesn't handle quoted commas, but tickers/prices usually don't have them)
      const columns = line.split(',');
      if (columns.length >= 5) {
        const ticker = columns[0].replace(/"/g, '').trim().toUpperCase();
        // Remove quotes, commas, and any non-numeric chars except dot and minus
        const rawPrice = columns[4].replace(/"/g, '').trim();
        const price = parseFloat(rawPrice.replace(/[^0-9.-]+/g, ""));
        
        if (ticker && !isNaN(price)) {
          priceMap[ticker] = price;
        }
      }
    }

    console.log("Parsed Price Map:", priceMap);
    
    const result: Record<string, number> = {};
    holdings.forEach(h => {
      const ticker = h.ticker.toUpperCase();
      if (priceMap[ticker] !== undefined) {
        result[ticker] = priceMap[ticker];
      } else {
        console.warn(`Price for ticker ${ticker} not found in Google Sheet.`);
      }
    });

    return result;
  } catch (error) {
    console.error("Detailed Fetch Error:", error);
    throw error; // Re-throw to be caught by App.tsx handleRefresh
  }
}

export async function getExchangeRate(from: string, to: string): Promise<number> {
  try {
    const response = await fetch(`https://api.exchangerate-api.com/v4/latest/${from}`);
    if (!response.ok) throw new Error("Exchange rate API failed");
    const data = await response.json();
    return data.rates[to] || 1350;
  } catch (error) {
    console.error("Error fetching exchange rate:", error);
    return 1350;
  }
}
