import * as cheerio from "cheerio";
import { config } from "../config.js";
import type { ToolResult } from "../types.js";

export async function crawlPage(
  url: string,
  maxLength: number = config.crawlMaxLength
): Promise<ToolResult> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "ResearchAgent/1.0",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return {
        success: false,
        data: "",
        error: `Failed to fetch: ${response.status} ${response.statusText}`,
      };
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // 불필요한 요소 제거
    $("script, style, nav, footer, header, aside, iframe, noscript").remove();

    // 본문 추출
    const body = $("article").length > 0 ? $("article") : $("body");
    let text = body.text();

    // 공백 정리
    text = text.replace(/\s+/g, " ").trim();

    // maxLength로 자르기
    if (text.length > maxLength) {
      text = text.slice(0, maxLength) + "\n\n[... 본문이 잘렸습니다. 전체 길이: " + text.length + "자]";
    }

    return {
      success: true,
      data: text || "페이지에서 텍스트를 추출할 수 없습니다.",
    };
  } catch (err) {
    return {
      success: false,
      data: "",
      error: `Crawl failed: ${(err as Error).message}`,
    };
  }
}
