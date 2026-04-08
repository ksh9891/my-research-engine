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
