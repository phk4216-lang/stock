
const GOOGLE_SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRkMUUEJ2NG7DXfpZOksVoLeiPBwz6pHYQdgGWmHgFIY1Py2iJvuNeScUmP2l1Qky8RK__0RkKs1sX3/pub?gid=0&single=true&output=csv";

export const isGeminiConfigured = true; // Always true now as we use Google Sheets

export async function fetchStockPrices(holdings: { ticker: string, currency: string }[]): Promise<Record<string, number>> {
  if (holdings.length === 0) return {};

  try {
    console.log("Fetching stock prices from Google Sheets...");
    const response = await fetch(GOOGLE_SHEET_CSV_URL);
    const csvText = await response.text();
    
    // Parse CSV manually (simple version)
    const lines = csvText.split('\n');
    const priceMap: Record<string, number> = {};
    
    // Skip header if exists (checking if first line contains "종목코드" or similar)
    const startLine = 0; 
    
    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      // Handle potential commas inside quotes if necessary, but usually tickers don't have them
      const columns = line.split(',');
      if (columns.length >= 5) {
        const ticker = columns[0].trim().toUpperCase();
        const price = parseFloat(columns[4].replace(/[^0-9.-]+/g, "")); // Column E is index 4
        
        if (ticker && !isNaN(price)) {
          priceMap[ticker] = price;
        }
      }
    }

    console.log("Prices parsed from Google Sheets:", priceMap);
    
    const result: Record<string, number> = {};
    holdings.forEach(h => {
      const ticker = h.ticker.toUpperCase();
      if (priceMap[ticker] !== undefined) {
        result[ticker] = priceMap[ticker];
      }
    });

    return result;
  } catch (error) {
    console.error("Error fetching stock prices from Google Sheets:", error);
    return {};
  }
}

export async function getExchangeRate(from: string, to: string): Promise<number> {
  try {
    // Using a public exchange rate API as a fallback for Gemini
    const response = await fetch(`https://api.exchangerate-api.com/v4/latest/${from}`);
    const data = await response.json();
    return data.rates[to] || 1350; // Default to 1350 if fetch fails
  } catch (error) {
    console.error("Error fetching exchange rate:", error);
    return 1350; // Fallback
  }
}
