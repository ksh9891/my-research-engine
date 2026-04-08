# Research Agent - Design Spec

## Overview

하네스 엔지니어링 학습을 위한 아티클 리서치 에이전트. 웹에서 정보를 검색/수집/분석하여 마크다운 보고서를 생성하는 CLI 도구.

핵심 목적은 제품 자체가 아니라, 하네스 구성요소(가드레일, 컨텍스트 관리, 검증 루프, 로깅)를 직접 구현하고 실험하며 하네스 엔지니어링 감각을 익히는 것.

## Architecture

```
CLI (사용자 입력/결과 출력)
  │
ReAct Loop (Claude tool use 기반)
  │  Think → Act → Observe → Think ... → 종료
  │
  ├── Tools: web_search, crawl_page, write_report
  │
  └── Harness Layer
      ├── Context Manager (토큰 추적, 압축)
      ├── Guardrails (루프 감지, 최대 턴 제한, 최소 출처)
      ├── Logger (턴별 토큰/도구/시간 기록)
      └── System Prompt (파일 분리, 실험 가능)
```

- 단일 에이전트로 시작. 컨텍스트 오염을 체감한 후 서브에이전트로 분리하는 건 이후 단계.
- 장기 목표: 게이트웨이 라우터를 앞에 두고 기술 리서치, 시장 트렌드 등 도메인별 하네스로 분기하는 범용 구조.

## Tools

### web_search

- 입력: `query` (검색 키워드), `maxResults?` (기본 10)
- 출력: `{ url, title, snippet }[]`
- 구현: Google Custom Search API
- 도구 경계: 검색만 수행, 본문 가져오기 불가. 에이전트가 crawl_page를 별도 호출해야 함.

### crawl_page

- 입력: `url`, `maxLength?` (기본 5000자)
- 출력: 정제된 본문 텍스트
- 구현: node-fetch + cheerio
- 도구 경계: maxLength로 컨텍스트 폭발 방지. 이 값을 조정하며 컨텍스트 오염 정도 관찰 가능.

### write_report

- 입력: `title`, `content` (마크다운), `sources` (URL 목록)
- 출력: 파일 경로 (`reports/YYYY-MM-DD-{title}.md`)
- 검증 게이트: sources < 3이면 실행 거부 → 에이전트가 더 수집하도록 강제.

### 도구 분리 의도

검색과 크롤링을 일부러 분리. 에이전트가 검색 결과를 보고 "어떤 URL을 크롤링할지" 선별하는 자율적 판단을 하게 함. 이 판단의 품질을 시스템 프롬프트로 개선하는 게 하네스 엔지니어링의 핵심 학습.

## ReAct Loop

Claude의 tool use 기능 활용. 매 턴마다 Claude가 도구 호출 또는 최종 응답을 스스로 결정.

### 종료 조건

| 조건 | 유형 | 동작 |
|---|---|---|
| Claude가 text만 응답 (tool_use 없음) | 정상 종료 | 루프 탈출 |
| 총 턴 수 > 15회 | 가드레일 | 강제 보고서 작성 요청 후 종료 |
| 같은 URL 2회 이상 크롤링 | 루프 감지 | 경고 메시지 주입 |
| 같은 검색어 2회 이상 | 루프 감지 | 경고 메시지 주입 |

### 완료 조건 설계

체크리스트 기반 + 정량 안전장치:
- 하한선: 최소 출처 3개 미만이면 write_report 거부
- 상한선: 최대 15턴 초과 시 강제 종료
- 그 사이: 에이전트가 자율 판단

### 하네스 개입 지점

```
매 턴마다:
├── [before] 컨텍스트 관리: 토큰 사용량 체크 → 임계치 초과 시 압축
├── [before] 가드레일: 최대 턴 수, 루프 감지, write_report 출처 검증
├── [execute] Claude API 호출 + 도구 실행
└── [after] 로깅: 턴 번호, 도구명, 토큰 수, 경과 시간
```

## Context Management

### 압축 전략

```
토큰 < 50% → 아무것도 안 함
토큰 50~80% → 크롤링 본문을 요약본으로 교체
토큰 > 80% → 오래된 턴의 도구 결과 전부 제거, 요약만 유지
```

압축은 별도 Claude API 호출로 수행. 압축 전후 응답 품질 차이가 컨텍스트 오염을 체감하는 순간.

## Logging

매 턴마다 기록:

```json
{
  "turn": 3,
  "timestamp": "2026-04-08T14:30:00",
  "tool_used": "crawl_page",
  "tool_input": { "url": "https://..." },
  "tokens": {
    "input": 12500,
    "output": 850,
    "cumulative": 28000
  },
  "context_compressed": false,
  "loop_warning": false
}
```

저장: `logs/YYYY-MM-DD-HH-mm-{query}.json`

활용: 토큰 추이 분석, 압축 효과 측정, 도구 호출 패턴 분석, 프롬프트 A/B 비교.

## System Prompt

`prompts/system.md`로 분리. 코드 수정 없이 프롬프트 실험 가능.

```
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

원칙: 코드로 강제할 수 있는 건 프롬프트에서 빼고 가드레일 코드로 이동.

## Tech Stack

| 구분 | 선택 | 이유 |
|---|---|---|
| 런타임 | Node.js + TypeScript | 편의성 |
| LLM | Claude API (`@anthropic-ai/sdk`) | tool use 지원 |
| 웹 검색 | Google Custom Search API | 무료 일 100건 |
| 크롤링 | node-fetch + cheerio | 가볍고 단순 |
| CLI | readline (직접 구현) | 의존성 최소화 |

## Project Structure

```
harness-example/
├── src/
│   ├── index.ts              # CLI 진입점
│   ├── react-loop.ts         # ReAct 루프 엔진
│   ├── tools/
│   │   ├── web-search.ts     # 검색 도구
│   │   ├── crawl-page.ts     # 크롤링 도구
│   │   └── write-report.ts   # 보고서 작성 도구
│   ├── harness/
│   │   ├── context-manager.ts  # 컨텍스트 압축
│   │   ├── guardrails.ts       # 루프 감지, 최대 턴 제한
│   │   └── logger.ts           # 턴별 로깅
│   └── config.ts              # API 키, 설정값
├── prompts/
│   └── system.md              # 시스템 프롬프트
├── reports/                   # 생성된 보고서
├── logs/                      # 실행 로그
├── package.json
└── tsconfig.json
```

## Output

- 터미널: 실행 중 진행 상황 + 완료 시 요약 출력
- 파일: `reports/YYYY-MM-DD-{title}.md` (상세 보고서)
- 로그: `logs/YYYY-MM-DD-HH-mm-{query}.json` (분석용)

## Future Enhancements (현재 범위 밖)

1. 서브에이전트 분리 — 컨텍스트 오염 체감 후
2. 게이트웨이 라우터 — 도메인별 하네스 분기
3. 멀티 모델 — 검증 단계에 다른 모델 적용
4. 웹 UI
