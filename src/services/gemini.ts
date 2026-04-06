
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
    const fullRowMap: {ticker: string, name: string, price: number}[] = [];
    
    console.log(`Parsing ${lines.length} lines from CSV based on screenshot structure...`);

    // Robust CSV line parser to handle quoted commas
    const parseCSVLine = (text: string) => {
      const result = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result;
    };
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || i === 0) continue; // Skip empty lines and header row
      
      const columns = parseCSVLine(line);
      
      if (columns.length >= 5) {
        const ticker = columns[0].toUpperCase(); // Column A
        const name = columns[1] ? columns[1].toUpperCase() : ""; // Column B
        const rawPrice = columns[4]; // Column E
        
        // Extract only numbers, dots, and minus signs
        const price = parseFloat(rawPrice.replace(/[^0-9.-]+/g, ""));
        
        if (!isNaN(price)) {
          fullRowMap.push({ ticker, name, price });
        }
      }
    }

    console.log("Sample parsed data:", fullRowMap.slice(0, 3));
    
    const result: Record<string, number> = {};
    holdings.forEach(h => {
      const searchKey = h.ticker.toUpperCase().replace(/\s+/g, ''); // Normalize: "KODEX 200" -> "KODEX200"
      
      // Find the best match in the sheet
      const foundRow = fullRowMap.find(row => {
        const rowTicker = row.ticker.replace(/\s+/g, '');
        const rowName = row.name.replace(/\s+/g, '');
        
        return rowTicker === searchKey || 
               rowName === searchKey ||
               rowTicker.includes(searchKey) ||
               searchKey.includes(rowTicker) ||
               rowName.includes(searchKey) ||
               searchKey.includes(rowName);
      });
      
      if (foundRow) {
        console.log(`Match found: "${h.ticker}" -> Sheet: [${foundRow.ticker} / ${foundRow.name}] Price: ${foundRow.price}`);
        result[h.ticker.toUpperCase()] = foundRow.price;
      } else {
        console.warn(`Could not find price for "${h.ticker}" in the sheet.`);
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
