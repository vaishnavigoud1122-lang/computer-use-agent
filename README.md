
computer-use-agent/
├── artifacts/
│   └── lookup-member-balance.json
├── evidence/
│   ├── discovery-run.json
│   ├── discovery-success.png
│   ├── handoff/
│   ├── replay-failures/
│   ├── successful-member-balance.png
│   ├── successful-member-balance.html
│   └── successful-member-balance.txt
├── src/
│   ├── agent/
│   │   ├── actions.ts
│   │   ├── browser.ts
│   │   ├── discovery.ts
│   │   ├── discovery-log.ts
│   │   ├── llm.ts
│   │   └── test-*.ts
│   ├── artifact/
│   │   ├── schema.ts
│   │   └── validate.ts
│   ├── guardrails/
│   │   ├── policy.ts
│   │   └── test-policy.ts
│   ├── handoff/
│   │   ├── controller.ts
│   │   └── test-handoff.ts
│   └── replay/
│       ├── replay.ts
│       └── test-replay.ts
├── target-app/
├── package.json
└── tsconfig.json
## Setup

Requires Node.js 18+ and Ollama running locally with the qwen2.5:7b model pulled. Run `npm install`, then `cd target-app && npm install && node server.js` to start the mock banking app.

## Demo path

Run `npx ts-node src/agent/discovery.ts` for discovery, `npx ts-node src/artifact/validate.ts artifacts/lookup-member-balance.json` to validate the artifact, `npx ts-node src/replay/test-replay.ts` to replay, and `npx ts-node src/guardrails/test-policy.ts` / `npx ts-node src/handoff/test-handoff.ts` for safety and handoff checks. See REPORT.md for the full design write-up and evidence/ for run logs.
