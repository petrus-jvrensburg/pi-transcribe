#!/usr/bin/env node
/**
 * Count Whisper tokens for the joined global + cwd initialPrompt using the
 * configured transcribe.cpp model. Exit 0 if at or under the ceiling.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TranscribeModel } from "transcribe-cpp";

const CEILING = 120;

function agentDir() {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

function parseArgs(argv) {
  let cwd = process.cwd();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--cwd" && argv[i + 1]) {
      cwd = argv[++i];
    }
  }
  return { cwd: resolve(cwd) };
}

function readSnippet(path) {
  if (!existsSync(path)) return { text: "", missing: true };
  try {
    return { text: readFileSync(path, "utf8"), missing: false };
  } catch {
    return { text: "", missing: true };
  }
}

function describe(path, snippet) {
  if (snippet.missing) return `${path}  (missing)`;
  return `${path}  (${snippet.text.trim().length} chars)`;
}

function readModelPath(dir) {
  const settingsPath = join(dir, "pi-transcribe.json");
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read ${settingsPath}: ${reason}`);
  }
  const model = parsed?.model;
  if (!model || typeof model.path !== "string" || !model.path) {
    throw new Error(`No model path in ${settingsPath}`);
  }
  if (!existsSync(model.path)) {
    throw new Error(`Configured model is missing: ${model.path}`);
  }
  return {
    id: typeof model.id === "string" ? model.id : "(unknown)",
    path: model.path,
    settingsPath,
  };
}

function fail(message, extra = []) {
  process.stderr.write(`${message}\n`);
  for (const line of extra) process.stderr.write(`${line}\n`);
  process.exit(1);
}

async function main() {
  const { cwd } = parseArgs(process.argv.slice(2));
  const dir = agentDir();
  const globalPath = join(dir, "whisper-prompt.txt");
  const localPath = join(cwd, ".pi", "pi-transcribe", "prompt-snippet.txt");
  const global = readSnippet(globalPath);
  const local = readSnippet(localPath);
  const combined = [global.text, local.text]
    .map((text) => text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();

  const header = [
    "# Whisper prompt token count",
    "",
    `cwd: ${cwd}`,
    `global: ${describe(globalPath, global)}`,
    `local: ${describe(localPath, local)}`,
    `ceiling: ${CEILING}`,
  ];

  if (combined.includes("<|") || combined.includes("|>")) {
    fail("Combined prompt contains special tokens (<| or |>) and cannot be used.", header);
  }

  let tokens = 0;
  let modelId = "(none)";
  let modelPath = "(none)";
  let arch = "";
  if (combined) {
    const configured = readModelPath(dir);
    modelId = configured.id;
    modelPath = configured.path;
    let model;
    try {
      model = await TranscribeModel.load(modelPath, { backend: "cpu" });
      arch = model.arch || "";
      tokens = model.tokenize(combined).length;
    } finally {
      model?.dispose();
    }
  }

  const ok = tokens <= CEILING;
  const lines = [
    ...header,
    `model: ${modelId}`,
    `model path: ${modelPath}`,
    ...(arch ? [`arch: ${arch}`] : []),
    `combined chars: ${combined.length}`,
    `tokens: ${tokens}`,
    `ok: ${ok ? "yes" : "no"}`,
    ...(ok ? [] : [`over by: ${tokens - CEILING}`]),
    "",
  ];
  process.stdout.write(`${lines.join("\n")}`);
  process.exit(ok ? 0 : 1);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
  });
}
