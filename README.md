# My Research Engine

하네스 엔지니어링(Harness Engineering) 학습을 위한 아티클 리서치 에이전트입니다.

웹에서 정보를 **검색 > 크롤링 > 분석 > 보고서 작성**까지 자율적으로 수행하는 CLI 도구이며, 핵심 목적은 제품 자체가 아니라 **하네스 구성요소를 직접 구현하고 실험하며 하네스 엔지니어링 감각을 익히는 것**입니다.

## 하네스 엔지니어링이란?

> **AI 에이전트가 실수했을 때, 프롬프트를 고치지 마세요. 마구(harness)를 고치세요.**

`Agent = Model + Harness`

하네스는 AI 모델을 감싸는 모든 것 -- 시스템 프롬프트, 도구, 가드레일, 컨텍스트 관리, 검증 루프 등 -- 을 의미합니다. LangChain은 모델을 바꾸지 않고 하네스만 개선해서 Terminal Bench 순위를 30위에서 5위로 올린 바 있습니다.

이 프로젝트에서는 코드로 강제할 수 있는 것은 프롬프트에 넣지 않고, 가드레일 코드로 구현합니다.

## Architecture

```
CLI (사용자 입력/결과 출력)
  |
ReAct Loop (Gemini tool use 기반)
  |  Think -> Act -> Observe -> Think ... -> 종료
  |
  |-- Tools: web_search, crawl_page, write_report
  |
  +-- Harness Layer
      |-- Context Manager (토큰 추적, 압축)
      |-- Guardrails (루프 감지, 최대 턴 제한, 인용 검증)
      |-- Logger (턴별 토큰/도구/시간 기록)
      +-- System Prompt (파일 분리, 실험 가능)
```

에이전트가 매 턴마다 어떤 도구를 쓸지 **스스로 결정**하고, 하네스가 매 턴마다 **개입하여 통제**합니다.

## Harness 구성요소

### Guardrails (`src/harness/guardrails.ts`)

| 가드레일 | 설명 | 트리거 |
|---|---|---|
| 최대 턴 제한 | 15턴 초과 시 강제 보고서 작성 | 무한루프 방지 |
| 루프 감지 | 같은 검색어/URL 반복 시 경고 주입 | 비효율적 행동 방지 |
| 보고서 작성 강제 | 보고서 없이 종료하려 하면 write_report 호출 강제 | 결과물 보장 |
| 최소 출처 검증 | 출처 3개 미만이면 write_report 거부 | 리서치 품질 확보 |
| 출처 교차 검증 | 크롤링하지 않은 URL을 출처로 쓰면 거부 | 환각 방지 |
| 보고서 품질 체크 | 제목 없음 또는 본문 500자 미만이면 거부 | 최소 품질 보장 |
| 인용 검증 | [N] 인용의 키워드가 해당 출처 본문에 30% 이상 존재하는지 검증 | 거짓 인용 방지 |

### Context Manager (`src/harness/context-manager.ts`)

토큰 사용량에 따라 3단계로 컨텍스트를 관리합니다:

- **< 50%**: 아무것도 안 함
- **50~80%**: 크롤링 본문을 요약본으로 교체 (partial compression)
- **> 80%**: 오래된 턴 전체를 요약으로 압축 (full compression)

### Logger (`src/harness/logger.ts`)

매 턴마다 기록하여 분석에 활용합니다:

```json
{
  "turn": 3,
  "timestamp": "2026-04-08T14:30:00",
  "toolUsed": "crawl_page",
  "toolInput": { "url": "https://..." },
  "tokens": {
    "input": 12500,
    "output": 850,
    "cumulative": 28000
  },
  "contextCompressed": false,
  "loopWarning": false
}
```

활용: 토큰 추이 분석, 압축 효과 측정, 도구 호출 패턴 분석, 프롬프트 A/B 비교.

### System Prompt (`prompts/system.md`)

코드와 분리되어 있어 **코드 수정 없이 프롬프트를 바꿔가며 실험**할 수 있습니다. 코드로 강제할 수 있는 규칙은 프롬프트에 넣지 않고 가드레일에 구현합니다.

## Tools

| 도구 | 설명 | 분리 의도 |
|---|---|---|
| `web_search` | Tavily API로 키워드 검색, URL+제목+스니펫 반환 | 검색 결과만 반환, 본문은 별도 크롤링 필요 |
| `crawl_page` | URL의 웹페이지 본문을 텍스트로 추출 | 에이전트가 "어떤 URL을 크롤링할지" 선별하는 판단을 하게 함 |
| `write_report` | 마크다운 보고서 파일 저장 | 7개 가드레일이 적용되는 검증 게이트 |

검색과 크롤링을 **일부러 분리**했습니다. 에이전트가 검색 결과를 보고 관련성 판단 후 선택적으로 크롤링하는 자율적 의사결정을 하게 하기 위함이며, 이 판단의 품질을 시스템 프롬프트로 개선하는 것이 하네스 엔지니어링의 핵심 학습 포인트입니다.

## Quick Start

### 1. 의존성 설치

```bash
npm install
```

### 2. API 키 설정

```bash
cp .env.example .env
```

`.env` 파일에 API 키를 입력합니다:

```
GEMINI_API_KEY=your-gemini-api-key-here
TAVILY_API_KEY=your-tavily-api-key-here
```

- **Gemini API Key**: [aistudio.google.com](https://aistudio.google.com/) 에서 발급 (무료)
- **Tavily API Key**: [app.tavily.com](https://app.tavily.com/) 에서 발급 (무료 월 1,000건)

### 3. 실행

```bash
npm start -- "하네스 엔지니어링이란 무엇인가"
```

### 4. 결과 확인

- 터미널: 턴별 진행 상황 + 요약
- `reports/`: 마크다운 보고서
- `logs/`: JSON 실행 로그

## 실행 예시

```
$ npm start -- "하네스 엔지니어링이란 무엇인가"

🔍 리서치 시작: "하네스 엔지니어링이란 무엇인가"

  [턴 1] → web_search [토큰: 497+24 / 누적: 521]
  [턴 2] → crawl_page [토큰: 1895+229 / 누적: 2645]
  [턴 3] → crawl_page [토큰: 3352+50 / 누적: 6047]
  [턴 4] → crawl_page [토큰: 6079+128 / 누적: 12254]
  ⚠️ 하네스 개입: 보고서 없이 종료 시도 → write_report 강제 요청
  [턴 6] → write_report [토큰: 7947+1082 / 누적: 29197]
  [턴 7] → (text response) [토큰: 9094+8 / 누적: 38299]

============================================================
📋 요약:
보고서가 성공적으로 저장되었습니다.
============================================================

📄 보고서: reports/2026-04-08-하네스-엔지니어링이란-무엇인가.md
📊 실행 로그: logs/2026-04-08T04-12-하네스-엔지니어링이란-무엇인가.json
```

턴 4에서 에이전트가 텍스트로 바로 응답하려 했지만, 하네스가 **"보고서가 없잖아"**라고 개입해서 `write_report` 호출을 강제한 것을 볼 수 있습니다.

## Project Structure

```
my-research-engine/
├── src/
│   ├── index.ts              # CLI 진입점
│   ├── react-loop.ts         # ReAct 루프 엔진 (핵심)
│   ├── types.ts              # 공유 타입 정의
│   ├── config.ts             # 환경변수 및 설정값
│   ├── tools/
│   │   ├── registry.ts       # 도구 스키마 + 실행 함수 매핑
│   │   ├── web-search.ts     # Tavily 검색 도구
│   │   ├── crawl-page.ts     # HTML 크롤링 도구
│   │   └── write-report.ts   # 보고서 작성 도구 (가드레일 포함)
│   └── harness/
│       ├── context-manager.ts  # 컨텍스트 압축
│       ├── guardrails.ts       # 가드레일 (루프 감지, 인용 검증 등)
│       └── logger.ts           # 턴별 로깅
├── prompts/
│   └── system.md              # 시스템 프롬프트 (코드와 분리)
├── reports/                   # 생성된 보고서 (gitignore)
├── logs/                      # 실행 로그 (gitignore)
└── docs/superpowers/
    ├── specs/                 # 설계 문서
    └── plans/                 # 구현 계획
```

## Tech Stack

| 구분 | 선택 |
|---|---|
| 런타임 | Node.js + TypeScript |
| LLM | Google Gemini API (`@google/genai`) -- gemini-2.5-flash, 무료 |
| 웹 검색 | Tavily API (`@tavily/core`) -- 무료 월 1,000건 |
| 크롤링 | cheerio (HTML 파싱) |

## 학습 참고 자료

이 프로젝트는 아래 글들을 학습한 후 만들었습니다:

1. [하네스 엔지니어링 개념 (WikiDocs)](https://wikidocs.net/blog/@jaehong/9481/)
2. [HaaS - Harness as a Service (vtrivedy)](https://www.vtrivedy.com/posts/claude-code-sdk-haas-harness-as-a-service)
3. [The Anatomy of an Agent Harness (LangChain)](https://blog.langchain.com/the-anatomy-of-an-agent-harness/)
4. [Improving Deep Agents with Harness Engineering (LangChain)](https://blog.langchain.com/improving-deep-agents-with-harness-engineering/)
5. [My AI Adoption Journey (mitchellh)](https://mitchellh.com/writing/my-ai-adoption-journey)

## Future Enhancements

현재는 단일 에이전트 + 아티클 리서치에 집중하고 있으며, 이후 단계적으로 확장할 계획입니다:

1. **서브에이전트 분리** -- 컨텍스트 오염을 체감한 후, 검색/분석/작성 에이전트를 분리
2. **게이트웨이 라우터** -- 질문 유형(기술 리서치, 시장 트렌드 등)에 따라 다른 하네스로 분기
3. **멀티 모델** -- 실행과 검증에 서로 다른 모델을 적용하여 교차 검증
4. **웹 UI** -- 브라우저에서 질문 입력 및 결과 확인

## License

MIT
