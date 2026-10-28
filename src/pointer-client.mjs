import { readFile } from "node:fs/promises";
import path from "node:path";
import { DATA_ROOT } from "./config.mjs";

export async function sendPointer(command) {
  let config;
  try {
    config = JSON.parse(
      await readFile(
        process.env.QUIET_DESKTOP_PREVIEW_CONFIG ||
          path.join(DATA_ROOT, "preview.json"),
        "utf8",
      ),
    );
  } catch {
    throw new Error("Open Preview.cmd before using the agent pointer.");
  }
  const response = await fetch(`http://127.0.0.1:${config.port}/pointer`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(45000),
  });
  const result = await response.json();
  if (!response.ok || !result.ok)
    throw new Error(result.error || "The agent pointer is unavailable.");
  return result.result;
}
