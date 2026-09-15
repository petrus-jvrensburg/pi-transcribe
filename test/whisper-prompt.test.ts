import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { encodeCwd, readWhisperInitialPrompt } from "../src/whisper-prompt.js";

async function isolatedAgentDir(t: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-transcribe-whisper-prompt-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("encodeCwd matches Pi session directory encoding", () => {
  assert.equal(
    encodeCwd("/Users/petrus/code/pi-transcribe"),
    "--Users-petrus-code-pi-transcribe--",
  );
});

test("missing snippet files are a no-op", async (t) => {
  const agentDir = await isolatedAgentDir(t);
  assert.equal(
    readWhisperInitialPrompt({ agentDir, cwd: "/tmp/project" }),
    undefined,
  );
});

test("empty snippet files are a no-op", async (t) => {
  const agentDir = await isolatedAgentDir(t);
  const cwd = "/tmp/project";
  await writeFile(join(agentDir, "whisper-prompt.txt"), "  \n", "utf8");
  await mkdir(join(agentDir, "whisper-prompts"));
  await writeFile(
    join(agentDir, "whisper-prompts", `${encodeCwd(cwd)}.txt`),
    "\n",
    "utf8",
  );
  assert.equal(readWhisperInitialPrompt({ agentDir, cwd }), undefined);
});

test("joins global then cwd and trims", async (t) => {
  const agentDir = await isolatedAgentDir(t);
  const cwd = "/Users/petrus/code/pi-transcribe";
  await writeFile(
    join(agentDir, "whisper-prompt.txt"),
    "  We often work with Pi.  \n",
    "utf8",
  );
  await mkdir(join(agentDir, "whisper-prompts"));
  await writeFile(
    join(agentDir, "whisper-prompts", `${encodeCwd(cwd)}.txt`),
    "In this project we talk about Elixir.\n",
    "utf8",
  );
  assert.equal(
    readWhisperInitialPrompt({ agentDir, cwd }),
    "We often work with Pi.\nIn this project we talk about Elixir.",
  );
});

test("uses only the snippet that exists", async (t) => {
  const agentDir = await isolatedAgentDir(t);
  await writeFile(join(agentDir, "whisper-prompt.txt"), "Pi and Grok.\n", "utf8");
  assert.equal(
    readWhisperInitialPrompt({ agentDir, cwd: "/tmp/other" }),
    "Pi and Grok.",
  );
});

test("skips the prompt when the combined text contains special tokens", async (t) => {
  const agentDir = await isolatedAgentDir(t);
  const cwd = "/tmp/project";
  await writeFile(join(agentDir, "whisper-prompt.txt"), "hello <|start|>", "utf8");
  assert.equal(readWhisperInitialPrompt({ agentDir, cwd }), undefined);

  await writeFile(join(agentDir, "whisper-prompt.txt"), "ok", "utf8");
  await mkdir(join(agentDir, "whisper-prompts"));
  await writeFile(
    join(agentDir, "whisper-prompts", `${encodeCwd(cwd)}.txt`),
    "end|>",
    "utf8",
  );
  assert.equal(readWhisperInitialPrompt({ agentDir, cwd }), undefined);
});
