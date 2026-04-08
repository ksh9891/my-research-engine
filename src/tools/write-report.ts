import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import type { ToolResult } from "../types.js";

export function writeReport(
  title: string,
  content: string,
  sources: string[],
  crawledUrls?: string[]
): ToolResult {
  // 가드레일 1: 최소 출처 수 검증
  if (sources.length < config.minSources) {
    return {
      success: false,
      data: "",
      error: `출처가 ${sources.length}개뿐입니다. 최소 ${config.minSources}개의 출처가 필요합니다. 추가 검색을 수행하세요.`,
    };
  }

  // 가드레일 2: 출처 교차 검증 — 크롤링하지 않은 URL을 출처로 쓸 수 없음
  if (crawledUrls) {
    const unverifiedSources = sources.filter(
      (src) => !crawledUrls.some((crawled) => src.includes(crawled) || crawled.includes(src))
    );
    if (unverifiedSources.length > 0) {
      return {
        success: false,
        data: "",
        error: `다음 출처는 크롤링되지 않은 URL입니다: ${unverifiedSources.join(", ")}. crawl_page로 먼저 해당 페이지를 크롤링한 후 출처로 사용하세요.`,
      };
    }
  }

  // 가드레일 3: 보고서 품질 체크
  if (!title || title.trim().length === 0) {
    return {
      success: false,
      data: "",
      error: "보고서 제목이 비어있습니다. 제목을 입력하세요.",
    };
  }

  if (content.length < 500) {
    return {
      success: false,
      data: "",
      error: `보고서 본문이 너무 짧습니다 (${content.length}자). 최소 500자 이상의 충실한 보고서를 작성하세요.`,
    };
  }

  const date = new Date().toISOString().split("T")[0];
  const safeTitle = title
    .replace(/[^a-zA-Z0-9가-힣\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 50);
  const fileName = `${date}-${safeTitle}.md`;
  const reportsDir = join(process.cwd(), "reports");

  mkdirSync(reportsDir, { recursive: true });

  const sourcesSection = sources
    .map((url, idx) => `${idx + 1}. ${url}`)
    .join("\n");

  const fullContent = `# ${title}\n\n*생성일: ${date}*\n\n${content}\n\n---\n\n## 출처\n\n${sourcesSection}\n`;

  const filePath = join(reportsDir, fileName);
  writeFileSync(filePath, fullContent, "utf-8");

  return {
    success: true,
    data: `보고서가 저장되었습니다: ${filePath}`,
  };
}
