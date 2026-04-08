import { GoogleGenAI, Content } from "@google/genai";
import { config } from "../config.js";
import type { Messages } from "../types.js";

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

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
      return { messages: await this.compressLongContent(messages), compressed: true };
    }

    return { messages: await this.compressFull(messages), compressed: true };
  }

  private async compressLongContent(messages: Messages): Promise<Messages> {
    const compressed: Messages = [];

    for (const msg of messages) {
      if (msg.parts) {
        const hasLong = msg.parts.some(
          (p) => "text" in p && typeof p.text === "string" && p.text.length > 1000
        );

        if (hasLong) {
          const summarizedParts = await Promise.all(
            msg.parts.map(async (p) => {
              if ("text" in p && typeof p.text === "string" && p.text.length > 1000) {
                const summary = await this.summarize(p.text);
                return { text: `[요약] ${summary}` };
              }
              return p;
            })
          );
          compressed.push({ role: msg.role, parts: summarizedParts });
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
    if (messages.length <= 4) return messages;

    const oldMessages = messages.slice(0, -4);
    const recentMessages = messages.slice(-4);

    const oldContent = oldMessages
      .map((m) => {
        if (!m.parts) return "";
        return m.parts
          .map((p) => {
            if ("text" in p && typeof p.text === "string") return p.text;
            if ("functionCall" in p) return `[도구 호출: ${(p as Record<string, unknown>).functionCall}]`;
            if ("functionResponse" in p) {
              const fr = p as { functionResponse: { name: string; response: unknown } };
              return `[도구 결과: ${fr.functionResponse.name}]`;
            }
            return "";
          })
          .join(" ");
      })
      .join("\n");

    const summary = await this.summarize(oldContent);

    const summaryMessage: Content = {
      role: "user",
      parts: [{ text: `[이전 리서치 요약]\n${summary}` }],
    };

    const ackMessage: Content = {
      role: "model",
      parts: [{ text: "이전 리서치 내용을 확인했습니다. 계속 진행하겠습니다." }],
    };

    return [summaryMessage, ackMessage, ...recentMessages];
  }

  private async summarize(text: string): Promise<string> {
    const response = await ai.models.generateContent({
      model: config.model,
      contents: `다음 텍스트의 핵심 내용을 300자 이내로 요약하세요. 출처 URL이 있으면 보존하세요.\n\n${text.slice(0, 10000)}`,
    });

    return response.text ?? text.slice(0, 300);
  }
}
