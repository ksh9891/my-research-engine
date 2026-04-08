import dotenv from "dotenv";
dotenv.config();

export const config = {
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  tavilyApiKey: process.env.TAVILY_API_KEY ?? "",
  model: "gemini-2.5-flash",
  maxTurns: 15,
  maxTokensPerResponse: 4096,
  contextWindow: 1_000_000,
  compressionThresholdLow: 0.5,
  compressionThresholdHigh: 0.8,
  crawlMaxLength: 5000,
  searchMaxResults: 10,
  minSources: 3,
};
