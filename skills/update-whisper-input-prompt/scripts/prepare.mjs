#!/usr/bin/env node
/**
 * Collect Whisper prompt paths, existing snippets, and a compact user-message
 * corpus from Pi sessions. Prints markdown for the skill's two rewrite passes.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_MSG_CHARS = 360;
const MAX_MSGS_PER_CWD_GLOBAL = 8;
const MAX_CWDS_GLOBAL = 10;
const MAX_MSGS_LOCAL = 50;
const MAX_CANDIDATES = 40;
const SKIP_MSG_CHARS = 2500;

function agentDir() {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

function sessionRoot(dir) {
  return process.env.PI_CODING_AGENT_SESSION_DIR || join(dir, "sessions");
}

/** Match Pi: `--${resolvedCwd without leading slash, /\\: → -}--` */
export function encodeCwd(cwd) {
  const resolved = resolve(cwd);
  return `--${resolved.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

function parseArgs(argv) {
  let cwd = process.cwd();
  let pathsOnly = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--cwd" && argv[i + 1]) {
      cwd = argv[++i];
    } else if (argv[i] === "--paths") {
      pathsOnly = true;
    }
  }
  return { cwd: resolve(cwd), pathsOnly };
}

function userText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

function shouldSkip(text) {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith("/")) return true;
  if (trimmed.startsWith("<skill")) return true;
  if (trimmed.length > SKIP_MSG_CHARS) return true;
  return false;
}

function extractUserMessages(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  const out = [];
  let cwdFromHeader = "";
  for (const line of raw.split("\n")) {
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type === "session" && typeof entry.cwd === "string") {
      cwdFromHeader = entry.cwd;
      continue;
    }
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (!message || message.role !== "user") continue;
    const text = userText(message);
    if (shouldSkip(text)) continue;
    out.push({
      text: text.trim().slice(0, MAX_MSG_CHARS),
      timestamp: entry.timestamp || "",
    });
  }
  return { cwdFromHeader, messages: out };
}

function listSessionFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => join(dir, name))
    .sort()
    .reverse();
}

const CANDIDATE_RE =
  /\b[A-Za-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)+\b|\b[A-Z][a-z]+[A-Z][A-Za-z0-9]*\b|\b[A-Za-z]+[0-9][A-Za-z0-9._-]*\b|\b[A-Z]{2,4}\b|\b(?:pi|Pi)\b/g;

function candidatesIn(text) {
  const found = text.match(CANDIDATE_RE) || [];
  const ticks = [];
  const tickRe = /`([^`]+)`/g;
  let match;
  while ((match = tickRe.exec(text))) {
    const inner = match[1].trim();
    if (inner && inner.length < 80 && !inner.includes("\n")) ticks.push(inner);
  }
  return [...found, ...ticks];
}

function keepCandidate(term) {
  if (term.length < 2 || term.length > 60) return false;
  if (/\.(md|json|txt|html)$/i.test(term)) return false;
  if (/^[A-Z][A-Z0-9_]+$/.test(term) && term.includes("_")) return false;
  if (/^https?:/i.test(term) || term.includes("www.")) return false;
  return true;
}

function addCandidates(table, text, cwdKey) {
  for (const term of candidatesIn(text)) {
    if (!keepCandidate(term)) continue;
    let row = table.get(term);
    if (!row) {
      row = { term, msgs: 0, cwds: new Set() };
      table.set(term, row);
    }
    row.msgs += 1;
    row.cwds.add(cwdKey);
  }
}

function formatCandidates(table, { minCwds = 1, limit = MAX_CANDIDATES } = {}) {
  const rows = [...table.values()]
    .filter((row) => row.cwds.size >= minCwds)
    .sort((a, b) => b.cwds.size - a.cwds.size || b.msgs - a.msgs || a.term.localeCompare(b.term))
    .slice(0, limit);
  if (rows.length === 0) return "(none)";
  return rows
    .map((row) => `- ${row.term}  (${row.cwds.size} cwd${row.cwds.size === 1 ? "" : "s"}, ${row.msgs} hits)`)
    .join("\n");
}

function readOptional(path) {
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function collectCwdBuckets(root) {
  if (!existsSync(root)) return [];
  const buckets = [];
  for (const name of readdirSync(root)) {
    if (!name.startsWith("--") || !name.endsWith("--")) continue;
    const dir = join(root, name);
    let st;
    try {
      st = statSync(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const files = listSessionFiles(dir);
    if (files.length === 0) continue;
    let latest = 0;
    try {
      latest = statSync(files[0]).mtimeMs;
    } catch {
      latest = 0;
    }
    buckets.push({ encoded: name, dir, files, latest });
  }
  buckets.sort((a, b) => b.latest - a.latest);
  return buckets;
}

function sampleMessages(files, limit) {
  const sampled = [];
  const seen = new Set();
  let cwdFromHeader = "";
  for (const file of files) {
    if (sampled.length >= limit) break;
    const extracted = extractUserMessages(file);
    if (extracted.cwdFromHeader) cwdFromHeader = extracted.cwdFromHeader;
    for (const msg of extracted.messages) {
      if (sampled.length >= limit) break;
      const key = msg.text.replace(/\s+/g, " ");
      if (seen.has(key)) continue;
      seen.add(key);
      sampled.push(msg);
    }
  }
  return { cwdFromHeader, sampled };
}

function formatMessages(messages, cwdLabel) {
  if (messages.length === 0) return `(no user messages for ${cwdLabel})`;
  return messages
    .map((msg) => `- ${msg.text.replace(/\s+/g, " ")}`)
    .join("\n");
}

function promptPaths(cwd) {
  const dir = agentDir();
  const encoded = encodeCwd(cwd);
  return {
    cwd,
    dir,
    encoded,
    globalPath: join(dir, "whisper-prompt.txt"),
    localPath: join(cwd, ".pi", "pi-transcribe", "prompt-snippet.txt"),
    sessions: sessionRoot(dir),
    localSessionDir: join(sessionRoot(dir), encoded),
  };
}

function main() {
  const { cwd, pathsOnly } = parseArgs(process.argv.slice(2));
  const {
    dir,
    encoded,
    globalPath,
    localPath,
    sessions,
    localSessionDir,
  } = promptPaths(cwd);
  if (pathsOnly) {
    process.stdout.write(`${globalPath}\n${localPath}\n`);
    return;
  }

  const globalExisting = readOptional(globalPath);
  const localExisting = readOptional(localPath);

  const globalTable = new Map();
  const localTable = new Map();
  const globalSamples = [];
  const buckets = collectCwdBuckets(sessions);
  const globalBuckets = buckets.slice(0, MAX_CWDS_GLOBAL);

  for (const bucket of globalBuckets) {
    const { cwdFromHeader, sampled } = sampleMessages(bucket.files, MAX_MSGS_PER_CWD_GLOBAL);
    const label = cwdFromHeader || bucket.encoded;
    for (const msg of sampled) addCandidates(globalTable, msg.text, bucket.encoded);
    globalSamples.push({ label, encoded: bucket.encoded, messages: sampled });
  }

  let localCwdLabel = cwd;
  let localMessages = [];
  if (existsSync(localSessionDir)) {
    const local = sampleMessages(listSessionFiles(localSessionDir), MAX_MSGS_LOCAL);
    if (local.cwdFromHeader) localCwdLabel = local.cwdFromHeader;
    localMessages = local.sampled;
    for (const msg of localMessages) addCandidates(localTable, msg.text, encoded);
  }

  const localOnlyTable = new Map();
  for (const [term, row] of localTable) {
    const globalRow = globalTable.get(term);
    const cwdCount = globalRow ? globalRow.cwds.size : 1;
    if (cwdCount <= 1) localOnlyTable.set(term, row);
  }

  const missing = (path, content) =>
    content === null ? `${path}  (missing)` : `${path}  (exists, ${content.trim().length} chars)`;

  const sections = [
    "# Whisper prompt prepare",
    "",
    `cwd: ${cwd}`,
    `encoded cwd: ${encoded}`,
    `agent dir: ${dir}`,
    `global file: ${missing(globalPath, globalExisting)}`,
    `local file: ${missing(localPath, localExisting)}`,
    `local sessions: ${existsSync(localSessionDir) ? localSessionDir : `${localSessionDir}  (missing)`}`,
    "",
    "## Existing global prompt",
    "",
    globalExisting === null ? "(none — first run for global)" : globalExisting.trim() || "(empty file)",
    "",
    "## Existing local prompt",
    "",
    localExisting === null ? "(none — first run for this cwd)" : localExisting.trim() || "(empty file)",
    "",
    "## Cross-cwd candidate terms",
    "",
    "Prefer these for the **global** paragraph when they would be hard for Whisper.",
    "A term should appear in more than one cwd to be global.",
    "",
    formatCandidates(globalTable, { minCwds: 2 }),
    "",
    "## Cwd-only candidate terms",
    "",
    `For **local** paragraph (${localCwdLabel}). Exclude anything already in the global paragraph.`,
    "",
    formatCandidates(localOnlyTable, { minCwds: 1 }),
    "",
    "## Sample user messages across recent cwds",
    "",
  ];

  for (const sample of globalSamples) {
    sections.push(`### ${sample.label}`, "", formatMessages(sample.messages, sample.label), "");
  }

  sections.push(
    `## Sample user messages for this cwd (${localCwdLabel})`,
    "",
    formatMessages(localMessages, localCwdLabel),
    "",
  );

  process.stdout.write(`${sections.join("\n").trim()}\n`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
