import dotenv from "dotenv";
dotenv.config();

export const config = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  tavilyApiKey: process.env.TAVILY_API_KEY ?? "",
  model: "claude-sonnet-4-20250514" as const,
  maxTurns: 15,
  maxTokensPerResponse: 4096,
  contextWindow: 200_000,
  compressionThresholdLow: 0.5,
  compressionThresholdHigh: 0.8,
  crawlMaxLength: 5000,
  searchMaxResults: 10,
  minSources: 3,
};
