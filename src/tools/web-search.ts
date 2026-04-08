import { tavily } from "@tavily/core";
import { config } from "../config.js";
import type { SearchResult, ToolResult } from "../types.js";

const tvly = tavily({ apiKey: config.tavilyApiKey });

export async function webSearch(
  query: string,
  maxResults: number = config.searchMaxResults
): Promise<ToolResult> {
  try {
    const response = await tvly.search(query, {
      maxResults: Math.min(maxResults, 10),
      searchDepth: "basic",
    });

    const results: SearchResult[] = response.results.map((item) => ({
      url: item.url,
      title: item.title,
      snippet: item.content?.slice(0, 200) ?? "",
    }));

    const formatted = results
      .map(
        (r, idx) =>
          `[${idx + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.snippet}`
      )
      .join("\n\n");

    return {
      success: true,
      data: formatted || "검색 결과가 없습니다.",
    };
  } catch (err) {
    return {
      success: false,
      data: "",
      error: `Search failed: ${(err as Error).message}`,
    };
  }
}
