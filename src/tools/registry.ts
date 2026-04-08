import { FunctionDeclaration, Type } from "@google/genai";
import { webSearch } from "./web-search.js";
import { crawlPage } from "./crawl-page.js";
import { writeReport } from "./write-report.js";
import type { ToolResult } from "../types.js";

export const toolDefinitions: FunctionDeclaration[] = [
  {
    name: "web_search",
    description:
      "키워드로 웹 검색하여 관련 페이지 목록(URL, 제목, 스니펫)을 반환합니다. 본문 내용은 포함되지 않으므로, 상세 내용이 필요하면 crawl_page를 사용하세요.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: "검색 키워드",
        },
        maxResults: {
          type: Type.NUMBER,
          description: "최대 결과 수 (기본 10, 최대 10)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "crawl_page",
    description:
      "URL의 웹페이지 본문을 텍스트로 추출합니다. HTML 태그가 제거된 정제된 텍스트를 반환합니다.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: {
          type: Type.STRING,
          description: "크롤링할 URL",
        },
        maxLength: {
          type: Type.NUMBER,
          description: "추출할 최대 글자 수 (기본 5000)",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "write_report",
    description:
      "수집/분석한 내용을 마크다운 보고서로 작성하여 파일로 저장합니다. 출처가 3개 미만이면 거부됩니다.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: {
          type: Type.STRING,
          description: "보고서 제목",
        },
        content: {
          type: Type.STRING,
          description: "보고서 본문 (마크다운 형식)",
        },
        sources: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "참고 출처 URL 목록",
        },
      },
      required: ["title", "content", "sources"],
    },
  },
];

export async function executeTool(
  name: string,
  input: Record<string, unknown>
): Promise<ToolResult> {
  switch (name) {
    case "web_search":
      return webSearch(
        input.query as string,
        input.maxResults as number | undefined
      );
    case "crawl_page":
      return crawlPage(
        input.url as string,
        input.maxLength as number | undefined
      );
    case "write_report":
      return writeReport(
        input.title as string,
        input.content as string,
        input.sources as string[]
      );
    default:
      return { success: false, data: "", error: `Unknown tool: ${name}` };
  }
}
