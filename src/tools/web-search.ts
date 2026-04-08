import { config } from "../config.js";
import type { SearchResult, ToolResult } from "../types.js";

export async function webSearch(
  query: string,
  maxResults: number = config.searchMaxResults
): Promise<ToolResult> {
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", config.googleCseApiKey);
  url.searchParams.set("cx", config.googleCseId);
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(Math.min(maxResults, 10)));

  try {
    const response = await fetch(url.toString());

    if (!response.ok) {
      return {
        success: false,
        data: "",
        error: `Google API error: ${response.status} ${response.statusText}`,
      };
    }

    const json = await response.json();
    const items = (json as Record<string, unknown[]>).items ?? [];

    const results: SearchResult[] = items.map((item: unknown) => {
      const i = item as Record<string, string>;
      return {
        url: i.link,
        title: i.title,
        snippet: i.snippet ?? "",
      };
    });

    const formatted = results
      .map((r, idx) => `[${idx + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.snippet}`)
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
