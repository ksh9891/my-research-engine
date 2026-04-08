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
      return { messages: await this.compressToolResults(messages), compressed: true };
    }

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
    if (messages.length <= 4) return messages;

    const oldMessages = messages.slice(0, -4);
    const recentMessages = messages.slice(-4);

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
