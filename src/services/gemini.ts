import { GoogleGenAI } from "@google/genai";

const getApiKey = () => {
  // In Vite, environment variables must be prefixed with VITE_
  const meta = import.meta as any;
  const viteKey = meta.env?.VITE_GEMINI_API_KEY;
  if (viteKey) {
    console.log("Gemini API Key found in import.meta.env.VITE_GEMINI_API_KEY");
    return viteKey;
  }

  // Fallback for other environments
  if (typeof process !== 'undefined' && process.env && process.env.GEMINI_API_KEY) {
    console.log("Gemini API Key found in process.env.GEMINI_API_KEY");
    return process.env.GEMINI_API_KEY;
  }
  
  if (typeof process !== 'undefined' && process.env && process.env.VITE_GEMINI_API_KEY) {
    console.log("Gemini API Key found in process.env.VITE_GEMINI_API_KEY");
    return process.env.VITE_GEMINI_API_KEY;
  }
  
  console.warn("Gemini API Key NOT found in any environment variable.");
  return "";
};

const apiKey = getApiKey();
export const isGeminiConfigured = !!apiKey;
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
    console.log("Gemini Request Prompt:", prompt);
    let response;
    try {
      response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: "application/json",
        },
      });
    } catch (searchError) {
      console.warn("Google Search tool failed, trying without it:", searchError);
      response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt + " (Use your internal knowledge if real-time search is unavailable)",
        config: {
          responseMimeType: "application/json",
        },
      });
    }

    const text = response.text;
    console.log("Gemini Raw Response:", text);
    if (!text) {
      console.error("Gemini returned empty text.");
      return {};
    }
    
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
    let response;
    try {
      response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: "application/json",
        },
      });
    } catch (searchError) {
      console.warn("Google Search tool failed for exchange rate, trying without it:", searchError);
      response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt + " (Use your internal knowledge if real-time search is unavailable)",
        config: {
          responseMimeType: "application/json",
        },
      });
    }

    const text = response.text;
    if (!text) return 1;
    const data = JSON.parse(text);
    return data.rate || 1;
  } catch (error) {
    console.error("Error fetching exchange rate:", error);
    return 1;
  }
}
