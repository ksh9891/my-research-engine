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
  private _reportWritten: boolean = false;

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

  recordReportWritten(): void {
    this._reportWritten = true;
  }

  get reportWritten(): boolean {
    return this._reportWritten;
  }

  getCrawledUrls(): string[] {
    return [...this.crawledUrls];
  }
}
