import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import type { ToolResult } from "../types.js";

/**
 * 보고서 본문에서 [N] 형식의 인용을 추출하고,
 * 인용 주변 문장의 핵심 키워드가 해당 출처의 크롤링 본문에 존재하는지 검증
 */
function verifyCitations(
  content: string,
  sources: string[],
  crawledContent: Map<string, string>
): { valid: boolean; errors: string[] } {
  // [N] 또는 [N, M] 패턴 찾기
  const citationPattern = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
  const errors: string[] = [];
  let match;

  while ((match = citationPattern.exec(content)) !== null) {
    const nums = match[1].split(",").map((n) => parseInt(n.trim(), 10));
    // 인용 주변 텍스트 추출 (앞뒤 100자)
    const start = Math.max(0, match.index - 100);
    const end = Math.min(content.length, match.index + match[0].length + 100);
    const surroundingText = content.slice(start, end);

    // 핵심 키워드 추출 (2글자 이상 단어, 불용어 제외)
    const stopWords = new Set([
      "있습니다", "합니다", "입니다", "됩니다", "위해", "통해", "대한",
      "것을", "수행", "하는", "이는", "또한", "등을", "것이", "하며",
      "위한", "같은", "있는", "에서", "으로", "하여", "이를", "the",
      "and", "for", "that", "this", "with", "from",
    ]);
    const keywords = surroundingText
      .replace(/\[[\d,\s]+\]/g, "")
      .split(/[\s,.:;!?·*#\-()[\]{}'"]+/)
      .filter((w) => w.length >= 2 && !stopWords.has(w))
      .slice(0, 8);

    for (const num of nums) {
      if (num < 1 || num > sources.length) {
        errors.push(`[${num}] 출처 번호가 범위를 벗어났습니다 (총 ${sources.length}개).`);
        continue;
      }

      const sourceUrl = sources[num - 1];

      // 해당 URL의 크롤링 본문 찾기 (URL 부분 매칭)
      let sourceContent: string | undefined;
      for (const [url, text] of crawledContent.entries()) {
        if (sourceUrl.includes(url) || url.includes(sourceUrl)) {
          sourceContent = text;
          break;
        }
      }

      if (!sourceContent) {
        errors.push(
          `[${num}] 출처 "${sourceUrl}"의 크롤링 본문을 찾을 수 없습니다. crawl_page로 먼저 해당 페이지를 크롤링하세요.`
        );
        continue;
      }

      // 키워드 매칭: 핵심 키워드 중 최소 30%가 크롤링 본문에 존재해야 함
      const matchedKeywords = keywords.filter((kw) =>
        sourceContent!.toLowerCase().includes(kw.toLowerCase())
      );
      const matchRate = keywords.length > 0 ? matchedKeywords.length / keywords.length : 0;

      if (matchRate < 0.3) {
        errors.push(
          `[${num}] 인용 검증 실패: "${surroundingText.slice(0, 50)}..." 문장의 핵심 키워드가 출처 "${sourceUrl}" 본문에서 충분히 발견되지 않았습니다 (매칭률: ${Math.round(matchRate * 100)}%).`
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function writeReport(
  title: string,
  content: string,
  sources: string[],
  crawledUrls?: string[],
  crawledContent?: Map<string, string>
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

  // 가드레일 4: 인용 검증 — [N] 패턴의 인용이 실제 출처 본문에 근거하는지 검증
  if (crawledContent && crawledContent.size > 0) {
    const citationCheck = verifyCitations(content, sources, crawledContent);
    if (!citationCheck.valid) {
      const errorList = citationCheck.errors.slice(0, 5).join("\n");
      return {
        success: false,
        data: "",
        error: `인용 검증 실패:\n${errorList}\n\n인용 번호를 제거하거나, 실제 출처 내용에 근거한 인용으로 수정하세요.`,
      };
    }
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
