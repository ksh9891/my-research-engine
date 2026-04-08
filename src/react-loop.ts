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
