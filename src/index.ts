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
