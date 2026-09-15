---
name: update-whisper-input-prompt
description: >-
  Rewrite the global and current-directory Whisper initial_prompt snippets from historical Pi session user messages. Use when asked to update the Whisper input prompt, refresh ASR vocab, rebuild whisper-prompt.txt / prompt-snippet.txt, or run update-whisper-input-prompt.
---

# Update Whisper input prompt

Rebuild two **static prose snippets** Whisper can use as `initialPrompt` (soft spelling bias, not instructions):

| File | Role |
|------|------|
| `~/.pi/agent/whisper-prompt.txt` | Global — terms used across many working directories |
| `<cwd>/.pi/pi-transcribe/prompt-snippet.txt` | This cwd only |

Respect `PI_CODING_AGENT_DIR` if set for the global file. Write the cwd snippet into the working directory's `.pi`, not into the pi-transcribe package. Do not patch pi-transcribe. Do not scrape the open editor or repo files for identifiers.

The same flow covers **first run** (both missing), **new directory** (global exists, local missing), and **later runs** (both exist). Detect that from the prepare output; do not ask which mode it is.

## 1. Prepare

Scripts live in `scripts/` next to this `SKILL.md`. Resolve them against **this skill directory**, not the project cwd:

```bash
node scripts/prepare.mjs
```

That prints paths, whether each file exists, the current snippets (or `(none)`), candidate terms, and sampled **user** messages. Use that output as the only corpus. If you need a different directory than the process cwd:

```bash
node scripts/prepare.mjs --cwd /absolute/path
```

## 2. Pass 1 — global paragraph

Write a **new** paragraph to the global file. Always rewrite the whole file; do not splice lines.

- Up to **20** terms that would be hard for Whisper (product names, people, hyphenated/package spellings, mixed case, digits). Use as many as the corpus supports; do not stop at a handful for style.
- A term is global only if it shows up in **more than one cwd**, or is clearly about Pi itself across work (`pi`, `pi-transcribe`, `Qwen3-ASR`, `Grok`, `xAI`).
- Spoken-looking prose that **contains the canonical spellings**. Do not write instructions like “spell these correctly.”
- No `<|` or `|>` anywhere.

If a global file already exists, treat it as **spelling memory**, not a draft to preserve: carry over important terms and their exact capitalization when they are still warranted; drop stale ones; add new ones. Prefer an existing file’s spelling over a mangled session form (`Qwen3-ASR` not `QEN3ASR`).

Example shape:

```text
We often work with Pi the coding agent, using models like Grok from xAI.
```

## 3. Pass 2 — cwd paragraph

Write a **new** paragraph to the local file for **this cwd**. Always rewrite the whole file.

- Up to **20** terms from this directory’s sessions / cwd-only candidates. Use as many as the corpus supports; do not stop at a handful for style.
- **Dedup against the global paragraph you just wrote** (not only the old global file). If the global snippet already introduces a name, do not repeat it.
- Rank by “would Whisper mangle this?” and how often it appears here.
- Same prose rules: spoken-looking prose, canonical spellings, no instructions, no `<|`.
- Use the existing local file the same way as global: reference for terms and capitalization, then rewrite.

If this cwd has no sessions yet, still write a local file. Use an empty file, or a single sentence with only terms you are confident belong to this directory from the prepare output. Do not invent a generic programming glossary.

Example shape:

```text
In this project we often talk about Elixir, Erlang's gen_statem, and the Unix design philosophy.
```

## 4. Write, then open for review

Write both files with the `write` tool (create parent dirs if needed). Then:

```bash
scripts/open.sh
```

That opens both files in the OS text editor (`open -t` on macOS) so the human can edit them. If a path was passed to prepare, pass the same cwd:

```bash
scripts/open.sh /absolute/path
```

After opening, stop. Summarize in one short note: global vs local term lists, first-run / new-cwd / update, and the two paths. Do not keep rewriting unless the user asks.

## Hard rules

- User messages only (prepare already filtered). Never mine assistant or tool output.
- Prefer typed/canonical spellings. Session text may already be bad ASR.
- Skip secrets, file dumps, slash-commands, one-off typos, and common English.
- These snippets are Whisper vocab bias. They are not AGENTS.md and not a glossary engine.
