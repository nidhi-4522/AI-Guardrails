import { hookDecision } from "../../src/guard.js";

const event = process.argv[2] || "";
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("end", () => {
  try {
    const input = raw.trim() ? JSON.parse(raw) : {};
    process.stdout.write(JSON.stringify(hookDecision(event, input)));
  } catch {
    process.stdout.write(JSON.stringify({
      continue: false,
      permission: "deny",
      user_message: "Guard failed closed.",
    }));
  }
});
