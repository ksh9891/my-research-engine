import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import type { ToolResult } from "../types.js";

export function writeReport(
  title: string,
  content: string,
  sources: string[]
): ToolResult {
  // 가드레일: 최소 출처 검증
  if (sources.length < config.minSources) {
    return {
      success: false,
      data: "",
      error: `출처가 ${sources.length}개뿐입니다. 최소 ${config.minSources}개의 출처가 필요합니다. 추가 검색을 수행하세요.`,
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
