import { config } from "../config.js";
import type { SearchResult, ToolResult } from "../types.js";

export async function webSearch(
  query: string,
  maxResults: number = config.searchMaxResults
): Promise<ToolResult> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(maxResults, 20)));

  try {
    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": config.braveApiKey,
      },
    });

    if (!response.ok) {
      return {
        success: false,
        data: "",
        error: `Brave API error: ${response.status} ${response.statusText}`,
      };
    }

    const json = await response.json();
    const webResults = (json as Record<string, unknown>).web as
      | { results: unknown[] }
      | undefined;
    const items = webResults?.results ?? [];

    const results: SearchResult[] = items.map((item: unknown) => {
      const i = item as Record<string, string>;
      return {
        url: i.url,
        title: i.title,
        snippet: i.description ?? "",
      };
    });

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
