import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const GLOBAL_WHISPER_PROMPT_FILE = "whisper-prompt.txt";
export const CWD_WHISPER_PROMPT_FILE = "prompt-snippet.txt";

/** `<cwd>/.pi/pi-transcribe/prompt-snippet.txt` */
export function cwdWhisperPromptPath(cwd: string): string {
  return join(resolve(cwd), ".pi", "pi-transcribe", CWD_WHISPER_PROMPT_FILE);
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
    readSnippet(join(agentDir, GLOBAL_WHISPER_PROMPT_FILE)),
    readSnippet(cwdWhisperPromptPath(cwd)),
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
