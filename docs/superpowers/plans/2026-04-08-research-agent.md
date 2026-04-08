# Research Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 하네스 엔지니어링 학습을 위한 아티클 리서치 에이전트 CLI 구현

**Architecture:** Claude tool use 기반 ReAct 루프가 핵심 엔진. 3개 도구(web_search, crawl_page, write_report)를 에이전트가 자율 선택. Harness Layer(컨텍스트 관리, 가드레일, 로깅)가 매 턴마다 개입하여 에이전트를 통제.

**Tech Stack:** TypeScript, Node.js, @anthropic-ai/sdk, Google Custom Search API, cheerio

---

## File Structure

```
harness-example/
├── src/
│   ├── index.ts              # CLI 진입점 — 사용자 입력 파싱, 루프 호출, 결과 출력
│   ├── react-loop.ts         # ReAct 루프 — Claude API 호출, 도구 디스패치, 턴 관리
│   ├── types.ts              # 공유 타입 정의
│   ├── tools/
│   │   ├── registry.ts       # 도구 등록소 — Claude tool use 스키마 + 실행 함수 매핑
│   │   ├── web-search.ts     # Google Custom Search API 호출
│   │   ├── crawl-page.ts     # URL fetch + HTML→텍스트 변환
│   │   └── write-report.ts   # 마크다운 보고서 파일 저장
│   ├── harness/
│   │   ├── context-manager.ts  # 토큰 추적, 메시지 배열 압축
│   │   ├── guardrails.ts       # 루프 감지, 최대 턴, 출처 검증
│   │   └── logger.ts           # 턴별 JSON 로그 기록
│   └── config.ts              # 환경변수 로드, 상수 정의
├── prompts/
│   └── system.md              # 시스템 프롬프트 (코드와 분리)
├── reports/                   # 생성된 보고서 (gitignore)
├── logs/                      # 실행 로그 (gitignore)
├── package.json
├── tsconfig.json
└── .gitignore
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `src/types.ts`
- Create: `src/config.ts`

- [ ] **Step 1: Initialize package.json**

```bash
cd /Users/kimsanghyun/develop/AI/harness-example
npm init -y
```

- [ ] **Step 2: Install dependencies**

```bash
npm install @anthropic-ai/sdk cheerio dotenv
npm install -D typescript @types/node tsx
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Create .gitignore**

```
node_modules/
dist/
.env
reports/
logs/
```

- [ ] **Step 5: Create .env.example**

```
ANTHROPIC_API_KEY=your-api-key-here
GOOGLE_CSE_API_KEY=your-google-api-key-here
GOOGLE_CSE_ID=your-custom-search-engine-id-here
```

- [ ] **Step 6: Create src/types.ts**

```typescript
import Anthropic from "@anthropic-ai/sdk";

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

export interface ToolResult {
  success: boolean;
  data: string;
  error?: string;
}

export interface TurnLog {
  turn: number;
  timestamp: string;
  toolUsed: string | null;
  toolInput: Record<string, unknown> | null;
  tokens: {
    input: number;
    output: number;
    cumulative: number;
  };
  contextCompressed: boolean;
  loopWarning: boolean;
}

export interface SessionLog {
  query: string;
  startedAt: string;
  turns: TurnLog[];
  totalTokens: number;
  reportPath: string | null;
}

export type Messages = Anthropic.MessageParam[];
```

- [ ] **Step 7: Create src/config.ts**

```typescript
import dotenv from "dotenv";
dotenv.config();

export const config = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  googleCseApiKey: process.env.GOOGLE_CSE_API_KEY ?? "",
  googleCseId: process.env.GOOGLE_CSE_ID ?? "",
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
```

- [ ] **Step 8: Add start script to package.json**

`package.json`의 scripts에 추가:

```json
{
  "scripts": {
    "start": "npx tsx src/index.ts"
  },
  "type": "module"
}
```

- [ ] **Step 9: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: 에러 없이 완료.

- [ ] **Step 10: Commit**

```bash
git add package.json tsconfig.json .gitignore .env.example src/types.ts src/config.ts
git commit -m "chore: scaffold project with TypeScript and dependencies"
```

---

### Task 2: Tool — web_search

**Files:**
- Create: `src/tools/web-search.ts`

- [ ] **Step 1: Create src/tools/web-search.ts**

```typescript
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
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: 에러 없이 완료.

- [ ] **Step 3: Commit**

```bash
git add src/tools/web-search.ts
git commit -m "feat: add web_search tool with Google Custom Search API"
```

---

### Task 3: Tool — crawl_page

**Files:**
- Create: `src/tools/crawl-page.ts`

- [ ] **Step 1: Create src/tools/crawl-page.ts**

```typescript
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
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: 에러 없이 완료.

- [ ] **Step 3: Commit**

```bash
git add src/tools/crawl-page.ts
git commit -m "feat: add crawl_page tool with HTML text extraction"
```

---

### Task 4: Tool — write_report

**Files:**
- Create: `src/tools/write-report.ts`

- [ ] **Step 1: Create src/tools/write-report.ts**

```typescript
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
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: 에러 없이 완료.

- [ ] **Step 3: Commit**

```bash
git add src/tools/write-report.ts
git commit -m "feat: add write_report tool with min sources guardrail"
```

---

### Task 5: Tool Registry

**Files:**
- Create: `src/tools/registry.ts`

- [ ] **Step 1: Create src/tools/registry.ts**

도구 스키마(Claude tool use 형식)와 실행 함수를 매핑하는 등록소.

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { webSearch } from "./web-search.js";
import { crawlPage } from "./crawl-page.js";
import { writeReport } from "./write-report.js";
import type { ToolResult } from "../types.js";

export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: "web_search",
    description:
      "키워드로 웹 검색하여 관련 페이지 목록(URL, 제목, 스니펫)을 반환합니다. 본문 내용은 포함되지 않으므로, 상세 내용이 필요하면 crawl_page를 사용하세요.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "검색 키워드",
        },
        maxResults: {
          type: "number",
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
    input_schema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description: "크롤링할 URL",
        },
        maxLength: {
          type: "number",
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
    input_schema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "보고서 제목",
        },
        content: {
          type: "string",
          description: "보고서 본문 (마크다운 형식)",
        },
        sources: {
          type: "array",
          items: { type: "string" },
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
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: 에러 없이 완료.

- [ ] **Step 3: Commit**

```bash
git add src/tools/registry.ts
git commit -m "feat: add tool registry with schema definitions and executor"
```

---

### Task 6: Harness — Logger

**Files:**
- Create: `src/harness/logger.ts`

- [ ] **Step 1: Create src/harness/logger.ts**

```typescript
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { TurnLog, SessionLog } from "../types.js";

export class Logger {
  private session: SessionLog;

  constructor(query: string) {
    this.session = {
      query,
      startedAt: new Date().toISOString(),
      turns: [],
      totalTokens: 0,
      reportPath: null,
    };
  }

  logTurn(log: TurnLog): void {
    this.session.turns.push(log);
    this.session.totalTokens = log.tokens.cumulative;

    // 터미널에 진행 상황 출력
    const toolInfo = log.toolUsed ? `→ ${log.toolUsed}` : "→ (text response)";
    const tokenInfo = `[토큰: ${log.tokens.input}+${log.tokens.output} / 누적: ${log.tokens.cumulative}]`;
    const warnings: string[] = [];
    if (log.contextCompressed) warnings.push("압축됨");
    if (log.loopWarning) warnings.push("루프 감지");
    const warningInfo = warnings.length > 0 ? ` ⚠️ ${warnings.join(", ")}` : "";

    console.log(`  [턴 ${log.turn}] ${toolInfo} ${tokenInfo}${warningInfo}`);
  }

  setReportPath(path: string): void {
    this.session.reportPath = path;
  }

  save(): string {
    const logsDir = join(process.cwd(), "logs");
    mkdirSync(logsDir, { recursive: true });

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 16);
    const safeQuery = this.session.query.slice(0, 30).replace(/\s+/g, "-");
    const fileName = `${timestamp}-${safeQuery}.json`;
    const filePath = join(logsDir, fileName);

    writeFileSync(filePath, JSON.stringify(this.session, null, 2), "utf-8");
    return filePath;
  }

  getTotalTokens(): number {
    return this.session.totalTokens;
  }

  getTurnCount(): number {
    return this.session.turns.length;
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: 에러 없이 완료.

- [ ] **Step 3: Commit**

```bash
git add src/harness/logger.ts
git commit -m "feat: add turn-level logger with terminal output and JSON export"
```

---

### Task 7: Harness — Guardrails

**Files:**
- Create: `src/harness/guardrails.ts`

- [ ] **Step 1: Create src/harness/guardrails.ts**

```typescript
import { config } from "../config.js";

export interface GuardrailCheck {
  allowed: boolean;
  warning: string | null;
  forceMessage: string | null;
}

export class Guardrails {
  private searchQueries: string[] = [];
  private crawledUrls: string[] = [];
  private turnCount: number = 0;

  recordSearch(query: string): void {
    this.searchQueries.push(query);
  }

  recordCrawl(url: string): void {
    this.crawledUrls.push(url);
  }

  incrementTurn(): void {
    this.turnCount++;
  }

  getTurnCount(): number {
    return this.turnCount;
  }

  check(): GuardrailCheck {
    // 최대 턴 수 초과
    if (this.turnCount >= config.maxTurns) {
      return {
        allowed: false,
        warning: null,
        forceMessage:
          `최대 턴 수(${config.maxTurns})에 도달했습니다. 지금까지 수집한 내용으로 즉시 write_report를 호출하여 보고서를 작성하세요.`,
      };
    }

    // 루프 감지: 같은 검색어 반복
    const lastQuery = this.searchQueries[this.searchQueries.length - 1];
    if (
      lastQuery &&
      this.searchQueries.filter((q) => q === lastQuery).length >= 2
    ) {
      return {
        allowed: true,
        warning:
          `동일한 검색어 "${lastQuery}"를 이미 사용했습니다. 다른 키워드로 검색하거나, 충분히 수집했다면 보고서를 작성하세요.`,
        forceMessage: null,
      };
    }

    // 루프 감지: 같은 URL 반복 크롤링
    const lastUrl = this.crawledUrls[this.crawledUrls.length - 1];
    if (
      lastUrl &&
      this.crawledUrls.filter((u) => u === lastUrl).length >= 2
    ) {
      return {
        allowed: true,
        warning:
          `이미 크롤링한 URL입니다: ${lastUrl}. 다른 페이지를 크롤링하거나 보고서를 작성하세요.`,
        forceMessage: null,
      };
    }

    return { allowed: true, warning: null, forceMessage: null };
  }

  getCrawledUrls(): string[] {
    return [...this.crawledUrls];
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: 에러 없이 완료.

- [ ] **Step 3: Commit**

```bash
git add src/harness/guardrails.ts
git commit -m "feat: add guardrails with loop detection and max turn limit"
```

---

### Task 8: Harness — Context Manager

**Files:**
- Create: `src/harness/context-manager.ts`

- [ ] **Step 1: Create src/harness/context-manager.ts**

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import type { Messages } from "../types.js";

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

export class ContextManager {
  private cumulativeTokens: number = 0;

  updateTokens(inputTokens: number, outputTokens: number): void {
    this.cumulativeTokens += inputTokens + outputTokens;
  }

  getCumulativeTokens(): number {
    return this.cumulativeTokens;
  }

  getUsageRatio(): number {
    return this.cumulativeTokens / config.contextWindow;
  }

  needsCompression(): "none" | "partial" | "full" {
    const ratio = this.getUsageRatio();
    if (ratio < config.compressionThresholdLow) return "none";
    if (ratio < config.compressionThresholdHigh) return "partial";
    return "full";
  }

  async compress(messages: Messages): Promise<{ messages: Messages; compressed: boolean }> {
    const level = this.needsCompression();
    if (level === "none" || messages.length < 4) {
      return { messages, compressed: false };
    }

    if (level === "partial") {
      // 크롤링 결과(긴 텍스트)를 요약으로 교체
      return { messages: await this.compressToolResults(messages), compressed: true };
    }

    // full: 오래된 턴을 전체 요약으로 교체
    return { messages: await this.compressFull(messages), compressed: true };
  }

  private async compressToolResults(messages: Messages): Promise<Messages> {
    const compressed: Messages = [];

    for (const msg of messages) {
      if (
        msg.role === "user" &&
        Array.isArray(msg.content) &&
        msg.content.length > 0
      ) {
        const blocks = msg.content as Anthropic.ToolResultBlockParam[];
        const hasLongToolResult = blocks.some(
          (b) =>
            b.type === "tool_result" &&
            typeof b.content === "string" &&
            b.content.length > 1000
        );

        if (hasLongToolResult) {
          const summarizedBlocks = await Promise.all(
            blocks.map(async (b) => {
              if (
                b.type === "tool_result" &&
                typeof b.content === "string" &&
                b.content.length > 1000
              ) {
                const summary = await this.summarize(b.content);
                return { ...b, content: `[요약] ${summary}` };
              }
              return b;
            })
          );
          compressed.push({ role: "user", content: summarizedBlocks });
        } else {
          compressed.push(msg);
        }
      } else {
        compressed.push(msg);
      }
    }

    return compressed;
  }

  private async compressFull(messages: Messages): Promise<Messages> {
    // 마지막 4개 턴만 유지, 나머지는 요약
    if (messages.length <= 4) return messages;

    const oldMessages = messages.slice(0, -4);
    const recentMessages = messages.slice(-4);

    // 오래된 메시지 내용을 텍스트로 추출
    const oldContent = oldMessages
      .map((m) => {
        if (typeof m.content === "string") return m.content;
        if (Array.isArray(m.content)) {
          return m.content
            .map((b) => {
              if ("text" in b && typeof b.text === "string") return b.text;
              if ("content" in b && typeof b.content === "string") return b.content;
              return "";
            })
            .join(" ");
        }
        return "";
      })
      .join("\n");

    const summary = await this.summarize(oldContent);

    const summaryMessage: Anthropic.MessageParam = {
      role: "user",
      content: `[이전 리서치 요약]\n${summary}`,
    };

    // assistant 메시지를 먼저 넣어서 user→assistant→user 순서 유지
    return [
      summaryMessage,
      { role: "assistant", content: "이전 리서치 내용을 확인했습니다. 계속 진행하겠습니다." },
      ...recentMessages,
    ];
  }

  private async summarize(text: string): Promise<string> {
    const response = await anthropic.messages.create({
      model: config.model,
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: `다음 텍스트의 핵심 내용을 300자 이내로 요약하세요. 출처 URL이 있으면 보존하세요.\n\n${text.slice(0, 10000)}`,
        },
      ],
    });

    const block = response.content[0];
    if (block.type === "text") return block.text;
    return text.slice(0, 300);
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: 에러 없이 완료.

- [ ] **Step 3: Commit**

```bash
git add src/harness/context-manager.ts
git commit -m "feat: add context manager with partial and full compression"
```

---

### Task 9: System Prompt

**Files:**
- Create: `prompts/system.md`

- [ ] **Step 1: Create prompts/system.md**

```markdown
당신은 웹 리서치 에이전트입니다.

## 목적
사용자의 질문에 대해 웹에서 정보를 수집/분석하여 보고서를 작성합니다.

## 도구
- web_search: 키워드로 검색 → URL 목록 반환
- crawl_page: URL 본문 추출
- write_report: 마크다운 보고서 저장 (출처 3개 미만이면 거부됨)

## 워크플로우
검색 → 결과 중 관련 URL 선별 → 크롤링 → 필요시 추가 검색 → 보고서 작성

## 판단 기준
- URL 선별 시: 제목과 스니펫이 질문의 핵심 키워드를 포함하는지 확인
- 추가 검색 시: 수집된 정보에서 답변되지 않은 부분이 있을 때
- 상충 관점이 발견되면 양쪽 모두 포함
```

- [ ] **Step 2: Commit**

```bash
git add prompts/system.md
git commit -m "feat: add system prompt for research agent"
```

---

### Task 10: ReAct Loop Engine

**Files:**
- Create: `src/react-loop.ts`

- [ ] **Step 1: Create src/react-loop.ts**

이 파일이 에이전트의 핵심 엔진. Claude API를 호출하고, tool use 응답을 처리하고, 하네스를 매 턴마다 적용.

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import { toolDefinitions, executeTool } from "./tools/registry.js";
import { ContextManager } from "./harness/context-manager.js";
import { Guardrails } from "./harness/guardrails.js";
import { Logger } from "./harness/logger.js";
import type { Messages, TurnLog } from "./types.js";

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

function loadSystemPrompt(): string {
  const promptPath = join(process.cwd(), "prompts", "system.md");
  return readFileSync(promptPath, "utf-8");
}

export async function runReactLoop(query: string): Promise<{
  summary: string;
  reportPath: string | null;
  logPath: string;
}> {
  const systemPrompt = loadSystemPrompt();
  const contextManager = new ContextManager();
  const guardrails = new Guardrails();
  const logger = new Logger(query);

  let messages: Messages = [{ role: "user", content: query }];

  console.log(`\n🔍 리서치 시작: "${query}"\n`);

  let finalSummary = "";
  let reportPath: string | null = null;

  while (true) {
    guardrails.incrementTurn();
    const turnNumber = guardrails.getTurnCount();

    // [before] 가드레일 체크
    const guardrailCheck = guardrails.check();
    if (!guardrailCheck.allowed) {
      // 강제 종료: 보고서 작성 요청 메시지 주입
      messages.push({
        role: "user",
        content: guardrailCheck.forceMessage!,
      });
    }

    // [before] 컨텍스트 압축
    const { messages: compressedMessages, compressed } =
      await contextManager.compress(messages);
    messages = compressedMessages;

    // [execute] Claude API 호출
    const response = await anthropic.messages.create({
      model: config.model,
      max_tokens: config.maxTokensPerResponse,
      system: systemPrompt,
      tools: toolDefinitions,
      messages,
    });

    // 토큰 추적
    contextManager.updateTokens(
      response.usage.input_tokens,
      response.usage.output_tokens
    );

    // stop_reason에 따라 분기
    if (response.stop_reason === "end_turn") {
      // 텍스트 응답 = 루프 종료
      const textBlock = response.content.find((b) => b.type === "text");
      finalSummary = textBlock ? textBlock.text : "";

      const turnLog: TurnLog = {
        turn: turnNumber,
        timestamp: new Date().toISOString(),
        toolUsed: null,
        toolInput: null,
        tokens: {
          input: response.usage.input_tokens,
          output: response.usage.output_tokens,
          cumulative: contextManager.getCumulativeTokens(),
        },
        contextCompressed: compressed,
        loopWarning: false,
      };
      logger.logTurn(turnLog);
      break;
    }

    if (response.stop_reason === "tool_use") {
      // 도구 호출 처리
      const assistantMessage: Anthropic.MessageParam = {
        role: "assistant",
        content: response.content,
      };
      messages.push(assistantMessage);

      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        const input = toolUse.input as Record<string, unknown>;

        // 가드레일에 기록
        if (toolUse.name === "web_search") {
          guardrails.recordSearch(input.query as string);
        } else if (toolUse.name === "crawl_page") {
          guardrails.recordCrawl(input.url as string);
        }

        // 도구 실행
        const result = await executeTool(toolUse.name, input);

        // write_report 성공 시 경로 저장
        if (toolUse.name === "write_report" && result.success) {
          reportPath = result.data;
          logger.setReportPath(reportPath);
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result.success
            ? result.data
            : `오류: ${result.error}`,
        });

        // 루프 감지 경고 주입
        const postCheck = guardrails.check();
        const loopWarning = postCheck.warning !== null;

        const turnLog: TurnLog = {
          turn: turnNumber,
          timestamp: new Date().toISOString(),
          toolUsed: toolUse.name,
          toolInput: input,
          tokens: {
            input: response.usage.input_tokens,
            output: response.usage.output_tokens,
            cumulative: contextManager.getCumulativeTokens(),
          },
          contextCompressed: compressed,
          loopWarning,
        };
        logger.logTurn(turnLog);

        if (postCheck.warning) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: `⚠️ 하네스 경고: ${postCheck.warning}`,
          });
        }
      }

      messages.push({ role: "user", content: toolResults });
    }
  }

  // 로그 저장
  const logPath = logger.save();

  return { summary: finalSummary, reportPath, logPath };
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: 에러 없이 완료.

- [ ] **Step 3: Commit**

```bash
git add src/react-loop.ts
git commit -m "feat: add ReAct loop engine with harness integration"
```

---

### Task 11: CLI Entry Point

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Create src/index.ts**

```typescript
import { runReactLoop } from "./react-loop.js";

async function main(): Promise<void> {
  const query = process.argv.slice(2).join(" ");

  if (!query) {
    console.log("사용법: npm start -- \"검색할 주제\"");
    console.log("예시:   npm start -- \"하네스 엔지니어링 최신 동향\"");
    process.exit(1);
  }

  try {
    const { summary, reportPath, logPath } = await runReactLoop(query);

    console.log("\n" + "=".repeat(60));
    console.log("📋 요약:");
    console.log(summary);
    console.log("=".repeat(60));

    if (reportPath) {
      console.log(`\n📄 보고서: ${reportPath}`);
    }
    console.log(`📊 실행 로그: ${logPath}`);
  } catch (err) {
    console.error("에러 발생:", (err as Error).message);
    process.exit(1);
  }
}

main();
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: 에러 없이 완료.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add CLI entry point"
```

---

### Task 12: End-to-End Verification

**Files:**
- Modify: 없음 (실행 테스트)

- [ ] **Step 1: .env 파일 생성**

```bash
cp .env.example .env
```

`.env` 파일에 실제 API 키 입력:
- `ANTHROPIC_API_KEY`: Anthropic Console에서 발급
- `GOOGLE_CSE_API_KEY`: Google Cloud Console에서 발급
- `GOOGLE_CSE_ID`: Programmable Search Engine에서 생성

- [ ] **Step 2: 간단한 쿼리로 테스트 실행**

```bash
npm start -- "하네스 엔지니어링이란 무엇인가"
```

Expected:
- 터미널에 턴별 진행 상황 출력 (`[턴 1] → web_search ...`)
- `reports/` 디렉토리에 마크다운 보고서 생성
- `logs/` 디렉토리에 JSON 로그 생성
- 최종 요약 출력

- [ ] **Step 3: 로그 파일 확인**

```bash
cat logs/*.json | head -50
```

Expected: 턴별 토큰 사용량, 도구 호출 기록이 JSON으로 기록됨.

- [ ] **Step 4: 보고서 파일 확인**

```bash
cat reports/*.md
```

Expected: 제목, 본문, 출처 목록이 포함된 마크다운 보고서.

- [ ] **Step 5: 최종 커밋**

```bash
git add -A
git commit -m "chore: verify end-to-end research agent flow"
```
