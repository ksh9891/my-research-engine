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
