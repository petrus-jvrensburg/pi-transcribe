import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Match Pi sessions / the update-whisper-input-prompt skill. */
export function encodeCwd(cwd: string): string {
  const resolved = resolve(cwd);
  return `--${resolved.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

function readSnippet(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/**
 * Join the global and cwd Whisper spelling-bias snippets, if present.
 * Missing or empty files are skipped. Special tokens are rejected so
 * transcribe.cpp does not fail the run.
 */
export function readWhisperInitialPrompt(
  options: { cwd?: string; agentDir?: string } = {},
): string | undefined {
  const agentDir = options.agentDir ?? getAgentDir();
  const cwd = options.cwd ?? process.cwd();
  const combined = [
    readSnippet(join(agentDir, "whisper-prompt.txt")),
    readSnippet(join(agentDir, "whisper-prompts", `${encodeCwd(cwd)}.txt`)),
  ]
    .map((text) => text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  if (!combined || combined.includes("<|") || combined.includes("|>")) {
    return undefined;
  }
  return combined;
}
