import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  cwdWhisperPromptPath,
  readWhisperInitialPrompt,
} from "../src/whisper-prompt.js";

async function isolatedDir(t: TestContext, prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function writeLocalSnippet(cwd: string, contents: string): Promise<void> {
  const path = cwdWhisperPromptPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

test("cwd snippet path is .pi/pi-transcribe/prompt-snippet.txt", () => {
  assert.equal(
    cwdWhisperPromptPath("/Users/petrus/docs"),
    "/Users/petrus/docs/.pi/pi-transcribe/prompt-snippet.txt",
  );
});

test("missing snippet files are a no-op", async (t) => {
  const agentDir = await isolatedDir(t, "pi-transcribe-whisper-prompt-");
  assert.equal(
    readWhisperInitialPrompt({ agentDir, cwd: "/tmp/project" }),
    undefined,
  );
});

test("empty snippet files are a no-op", async (t) => {
  const agentDir = await isolatedDir(t, "pi-transcribe-whisper-prompt-");
  const cwd = await isolatedDir(t, "pi-transcribe-whisper-cwd-");
  await writeFile(join(agentDir, "whisper-prompt.txt"), "  \n", "utf8");
  await writeLocalSnippet(cwd, "\n");
  assert.equal(readWhisperInitialPrompt({ agentDir, cwd }), undefined);
});

test("joins global then cwd and trims", async (t) => {
  const agentDir = await isolatedDir(t, "pi-transcribe-whisper-prompt-");
  const cwd = await isolatedDir(t, "pi-transcribe-whisper-cwd-");
  await writeFile(
    join(agentDir, "whisper-prompt.txt"),
    "  We often work with Pi.  \n",
    "utf8",
  );
  await writeLocalSnippet(cwd, "In this project we talk about Elixir.\n");
  assert.equal(
    readWhisperInitialPrompt({ agentDir, cwd }),
    "We often work with Pi.\nIn this project we talk about Elixir.",
  );
});

test("uses only the snippet that exists", async (t) => {
  const agentDir = await isolatedDir(t, "pi-transcribe-whisper-prompt-");
  await writeFile(join(agentDir, "whisper-prompt.txt"), "Pi and Grok.\n", "utf8");
  assert.equal(
    readWhisperInitialPrompt({ agentDir, cwd: "/tmp/other" }),
    "Pi and Grok.",
  );
});

test("skips the prompt when the combined text contains special tokens", async (t) => {
  const agentDir = await isolatedDir(t, "pi-transcribe-whisper-prompt-");
  const cwd = await isolatedDir(t, "pi-transcribe-whisper-cwd-");
  await writeFile(join(agentDir, "whisper-prompt.txt"), "hello <|start|>", "utf8");
  assert.equal(readWhisperInitialPrompt({ agentDir, cwd }), undefined);

  await writeFile(join(agentDir, "whisper-prompt.txt"), "ok", "utf8");
  await writeLocalSnippet(cwd, "end|>");
  assert.equal(readWhisperInitialPrompt({ agentDir, cwd }), undefined);
});
