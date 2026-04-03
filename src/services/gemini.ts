import { GoogleGenAI } from "@google/genai";

const getApiKey = () => {
  try {
    // Try process.env (Node/AI Studio)
    if (typeof process !== 'undefined' && process.env && process.env.GEMINI_API_KEY) {
      return process.env.GEMINI_API_KEY;
    }
    // Try import.meta.env (Vite/Vercel)
    const meta = import.meta as any;
    if (typeof meta !== 'undefined' && meta.env && meta.env.VITE_GEMINI_API_KEY) {
      return meta.env.VITE_GEMINI_API_KEY;
    }
  } catch (e) {
    console.warn("Could not access environment variables:", e);
  }
  return "";
};

const apiKey = getApiKey();
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

export async function fetchStockPrices(holdings: { ticker: string, currency: string }[]): Promise<Record<string, number>> {
  if (holdings.length === 0) return {};
  if (!ai) {
    console.error("Gemini API Key is missing. Please set GEMINI_API_KEY or VITE_GEMINI_API_KEY.");
    return {};
  }

  const tickersWithCurrency = holdings.map(h => `${h.ticker} (${h.currency})`).join(", ");
  const prompt = `Find the most recent real-time stock market price for these tickers: ${tickersWithCurrency}. 
  For Korean stocks (KRW), search for their current price on major portals like Naver Finance or Yahoo Finance.
  Return ONLY a JSON object where keys are the exact tickers provided and values are numbers (current price in the specified currency). 
  Do not include any other text or markdown formatting.
  Example: {"AAPL": 150.25, "005930": 72000}`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
      },
    });

    const text = response.text;
    if (!text) return {};
    
    try {
      const prices = JSON.parse(text);
      // Normalize keys to uppercase and trim
      const normalizedPrices: Record<string, number> = {};
      Object.entries(prices).forEach(([key, value]) => {
        normalizedPrices[key.trim().toUpperCase()] = Number(value);
      });
      return normalizedPrices;
    } catch (e) {
      console.error("Failed to parse Gemini response:", text);
      return {};
    }
  } catch (error) {
    console.error("Error fetching stock prices:", error);
    return {};
  }
}

export async function getExchangeRate(from: string, to: string): Promise<number> {
  if (!ai) return 1;
  const prompt = `What is the current exchange rate from ${from} to ${to}? Return only the numeric value as JSON. Example: {"rate": 1350.5}`;
  
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
      },
    });

    const text = response.text;
    if (!text) return 1;
    const data = JSON.parse(text);
    return data.rate || 1;
  } catch (error) {
    console.error("Error fetching exchange rate:", error);
    return 1;
  }
}
