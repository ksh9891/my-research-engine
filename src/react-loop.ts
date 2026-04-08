import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GoogleGenAI, Content, FunctionCall } from "@google/genai";
import { config } from "./config.js";
import { toolDefinitions, executeTool } from "./tools/registry.js";
import { ContextManager } from "./harness/context-manager.js";
import { Guardrails } from "./harness/guardrails.js";
import { Logger } from "./harness/logger.js";
import type { Messages, TurnLog } from "./types.js";

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

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

  let messages: Messages = [
    { role: "user", parts: [{ text: query }] },
  ];

  console.log(`\n🔍 리서치 시작: "${query}"\n`);

  let finalSummary = "";
  let reportPath: string | null = null;

  while (true) {
    guardrails.incrementTurn();
    const turnNumber = guardrails.getTurnCount();

    // [before] 가드레일 체크
    const guardrailCheck = guardrails.check();
    if (!guardrailCheck.allowed) {
      messages.push({
        role: "user",
        parts: [{ text: guardrailCheck.forceMessage! }],
      });
    }

    // [before] 컨텍스트 압축
    const { messages: compressedMessages, compressed } =
      await contextManager.compress(messages);
    messages = compressedMessages;

    // [execute] Gemini API 호출
    const response = await ai.models.generateContent({
      model: config.model,
      contents: messages,
      config: {
        systemInstruction: systemPrompt,
        tools: [{ functionDeclarations: toolDefinitions }],
        maxOutputTokens: config.maxTokensPerResponse,
      },
    });

    // 토큰 추적
    const usage = response.usageMetadata;
    const inputTokens = usage?.promptTokenCount ?? 0;
    const outputTokens = usage?.candidatesTokenCount ?? 0;
    contextManager.updateTokens(inputTokens, outputTokens);

    // function call 확인
    const functionCalls = response.functionCalls;

    if (!functionCalls || functionCalls.length === 0) {
      // 텍스트 응답이 왔지만 보고서가 아직 작성되지 않은 경우 → 강제 요청
      if (!guardrails.reportWritten) {
        console.log("  ⚠️ 하네스 개입: 보고서 없이 종료 시도 → write_report 강제 요청");

        const modelMsg: Content = {
          role: "model",
          parts: [{ text: response.text ?? "" }],
        };
        messages.push(modelMsg);
        messages.push({
          role: "user",
          parts: [{ text: "반드시 write_report 도구를 호출하여 보고서를 파일로 저장하세요. 위에서 작성한 내용을 그대로 write_report의 content에 전달하세요." }],
        });
        continue;
      }

      // 보고서 작성 완료 → 정상 종료
      finalSummary = response.text ?? "";

      const turnLog: TurnLog = {
        turn: turnNumber,
        timestamp: new Date().toISOString(),
        toolUsed: null,
        toolInput: null,
        tokens: {
          input: inputTokens,
          output: outputTokens,
          cumulative: contextManager.getCumulativeTokens(),
        },
        contextCompressed: compressed,
        loopWarning: false,
      };
      logger.logTurn(turnLog);
      break;
    }

    // 도구 호출 처리
    // model의 응답을 메시지에 추가
    const modelMessage: Content = {
      role: "model",
      parts: functionCalls.map((fc) => ({
        functionCall: { name: fc.name, args: fc.args },
      })),
    };
    messages.push(modelMessage);

    // 각 function call 실행 및 결과 수집
    const functionResponses: Content = {
      role: "user",
      parts: [],
    };

    for (const fc of functionCalls) {
      const input = (fc.args ?? {}) as Record<string, unknown>;

      // 가드레일에 기록
      const toolName = fc.name ?? "unknown";

      // 가드레일에 기록
      if (toolName === "web_search") {
        guardrails.recordSearch(input.query as string);
      } else if (toolName === "crawl_page") {
        guardrails.recordCrawl(input.url as string);
      }
      const result = await executeTool(toolName, input);

      // write_report 성공 시 경로 저장
      if (toolName === "write_report" && result.success) {
        reportPath = result.data;
        logger.setReportPath(reportPath);
        guardrails.recordReportWritten();
      }

      const resultText = result.success
        ? result.data
        : `오류: ${result.error}`;

      functionResponses.parts!.push({
        functionResponse: {
          name: toolName,
          response: { result: resultText },
        },
      });

      // 루프 감지 경고
      const postCheck = guardrails.check();
      const loopWarning = postCheck.warning !== null;

      const turnLog: TurnLog = {
        turn: turnNumber,
        timestamp: new Date().toISOString(),
        toolUsed: toolName,
        toolInput: input,
        tokens: {
          input: inputTokens,
          output: outputTokens,
          cumulative: contextManager.getCumulativeTokens(),
        },
        contextCompressed: compressed,
        loopWarning,
      };
      logger.logTurn(turnLog);

      if (postCheck.warning) {
        functionResponses.parts!.push({
          text: `⚠️ 하네스 경고: ${postCheck.warning}`,
        });
      }
    }

    messages.push(functionResponses);
  }

  // 로그 저장
  const logPath = logger.save();

  return { summary: finalSummary, reportPath, logPath };
}
