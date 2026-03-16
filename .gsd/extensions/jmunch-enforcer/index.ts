/**
 * jMunch Enforcer — blocks Read on code/doc files to enforce jcodemunch/jdocmunch usage.
 * Also enforces reindexing after commits via temp file flags (shared across all agents/sessions).
 *
 * Translates the Claude Code hook pattern to a Pi extension:
 *   - jcodemunch-nudge.sh    → tool_call handler blocking Read on .py/.ts/.tsx
 *   - jdocmunch-nudge.sh     → tool_call handler blocking Read on .md/.mdx/.rst >50 lines
 *   - reindex-after-commit.sh → tool_result handler writing needs-reindex flag
 *   - jmunch-session-gate.sh  → tool_call handler blocking jmunch queries when flag exists
 *   - jmunch-sentinel-writer.sh → tool_result handler clearing flag after both indexes complete
 *
 * Flag files (shared across all gsd processes for this project):
 *   /tmp/jmunch-needs-reindex-<hash>  — written after git commit, cleared after both indexes
 *   /tmp/jmunch-ready-<hash>          — sentinel with "code" and "doc" lines
 *
 * Requires: pi-mcp-adapter with directTools: true for jcodemunch + jdocmunch servers.
 */

import type { ExtensionAPI } from "@gsd/pi-coding-agent";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { basename } from "node:path";
import { createHash } from "node:crypto";

// ── Hash for temp file names (same scheme as Claude Code hooks) ──────────────

function projectHash(cwd: string): string {
  return createHash("md5").update(cwd).digest("hex").slice(0, 12);
}

function getSentinelPath(cwd: string): string {
  return `/tmp/jmunch-ready-${projectHash(cwd)}`;
}

function getNeedsReindexPath(cwd: string): string {
  return `/tmp/jmunch-needs-reindex-${projectHash(cwd)}`;
}

// ── Sentinel helpers ─────────────────────────────────────────────────────────

function sentinelHas(sentinelPath: string, tag: "code" | "doc"): boolean {
  try {
    const content = readFileSync(sentinelPath, "utf-8");
    return content.split("\n").includes(tag);
  } catch {
    return false;
  }
}

function sentinelIsComplete(sentinelPath: string): boolean {
  return sentinelHas(sentinelPath, "code") && sentinelHas(sentinelPath, "doc");
}

// ── Files that should always be allowed through Read ─────────────────────────

const ALWAYS_ALLOW = new Set([
  "CLAUDE.md", "SKILL.md", "KNOWLEDGE.md", "MEMORY.md", "README.md",
  "preferences.md", "conftest.py",
]);

const ALLOW_PATH_PATTERNS = [
  /\/\.gsd\//,
  /\/\.pi\//,
  /\/\.claude\//,
  /\/\.planning\//,
  /\/\.vbw-planning\//,
];

// ── jmunch query tools that get stale after commits ──────────────────────────

const JMUNCH_QUERY_TOOLS = new Set([
  "jcodemunch_search_symbols", "jcodemunch_search_text",
  "jcodemunch_get_symbol", "jcodemunch_get_symbols",
  "jcodemunch_get_file_outline", "jcodemunch_get_file_content",
  "jcodemunch_get_file_tree", "jcodemunch_get_repo_outline",
  "jcodemunch_find_importers", "jcodemunch_find_references",
  "jdocmunch_search_sections", "jdocmunch_get_section",
  "jdocmunch_get_sections", "jdocmunch_get_document_outline",
  "jdocmunch_get_toc", "jdocmunch_get_toc_tree",
]);

// ── Index tools (always allowed, they're the fix) ────────────────────────────

const JMUNCH_INDEX_TOOLS = new Set([
  "jcodemunch_index_folder", "jdocmunch_index_local",
]);

const REINDEX_MSG = [
  "Run both now:",
  "  1. jcodemunch_index_folder(path='.', incremental=true, use_ai_summaries=false)",
  "  2. jdocmunch_index_local(path='.', use_ai_summaries=false)",
].join("\n");

// ── Extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  const cwd = process.cwd();
  const sentinelPath = getSentinelPath(cwd);
  const needsReindexPath = getNeedsReindexPath(cwd);

  // ── Gate: block tools until indexes are ready + block stale queries ───────

  pi.on("tool_call", async (event: any) => {
    const toolName: string = event.toolName || "";

    // Index tools always pass — they're the fix
    if (JMUNCH_INDEX_TOOLS.has(toolName)) return;

    // Gate 1: Session startup — sentinel must have both "code" and "doc"
    if (!sentinelIsComplete(sentinelPath)) {
      // Only block jmunch query tools + read nudges, let everything else through
      // so the agent can still do basic work while indexing
      if (JMUNCH_QUERY_TOOLS.has(toolName)) {
        return {
          block: true,
          reason: `BLOCKED: jMunch indexes not yet refreshed this session.\n${REINDEX_MSG}`,
        };
      }
    }

    // Gate 2: Post-commit staleness — block ALL tools when flag exists
    // Forces immediate reindex. Index tools already passed above.
    if (existsSync(needsReindexPath)) {
      return {
        block: true,
        reason: `BLOCKED: jMunch indexes are stale after a git commit. ALL tools blocked until you re-index.\n${REINDEX_MSG}`,
      };
    }

    // ── Read nudges (same as before) ─────────────────────────────────────

    if (toolName !== "read") return;

    const filePath: string = event.input?.file_path || event.input?.path || "";
    if (!filePath) return;

    const name = basename(filePath);

    if (ALWAYS_ALLOW.has(name)) return;

    for (const pattern of ALLOW_PATH_PATTERNS) {
      if (pattern.test(filePath)) return;
    }

    // Block code files → use jcodemunch
    if (/\.(py|ts|tsx)$/.test(filePath)) {
      return {
        block: true,
        reason: [
          `BLOCKED: Use jcodemunch instead of Read for '${name}'.`,
          "  - Find a function/class: jcodemunch_get_symbol(repo, symbol_id)",
          "  - Search by name: jcodemunch_search_symbols(repo, query)",
          "  - Sliced edit: get_symbol → get_file_content(start_line, end_line) → Edit",
          "  - Full Read ONLY when: editing 6+ functions, need imports/globals, or file <50 lines",
        ].join("\n"),
      };
    }

    // Block large doc files → use jdocmunch
    if (/\.(md|mdx|rst)$/.test(filePath)) {
      if (existsSync(filePath)) {
        try {
          const content = readFileSync(filePath, "utf-8");
          const lineCount = content.split("\n").length;
          if (lineCount < 50) return;
        } catch {
          return;
        }
      }

      return {
        block: true,
        reason: [
          `BLOCKED: Use jdocmunch instead of Read for '${name}'.`,
          "  - Search sections: jdocmunch_search_sections(repo, query)",
          "  - Get specific section: jdocmunch_get_section(repo, section_id)",
          "  - Read ONLY allowed for: small docs (<50 lines), CLAUDE.md, SKILL.md, planning files",
        ].join("\n"),
      };
    }
  });

  // ── Post-tool: detect commits, track edits, manage sentinel/flag ─────────

  pi.on("tool_result", async (event: any) => {
    // Detect git commits → write needs-reindex flag
    if (event.toolName === "bash") {
      const cmd: string = event.input?.command || "";
      if (!cmd.includes("git commit")) return;

      const output: string = event.content?.[0]?.text || "";
      if (output.includes("nothing to commit") || output.includes("no changes")) return;

      writeFileSync(needsReindexPath, `${Date.now()}\n`);

      return {
        content: [
          ...(event.content || []),
          { type: "text", text: `\n\n[jMunch] Commit detected — indexes are stale.\n${REINDEX_MSG}` },
        ],
      };
    }

    // Detect code/doc edits → write needs-reindex flag (only if not already set)
    if (event.toolName === "edit" || event.toolName === "write") {
      const filePath: string = event.input?.file_path || event.input?.path || "";
      if (/\.(py|ts|tsx|md|mdx|rst)$/.test(filePath) && !existsSync(needsReindexPath)) {
        writeFileSync(needsReindexPath, `${Date.now()}\n`);
        return {
          content: [
            ...(event.content || []),
            { type: "text", text: `\n\n[jMunch] Indexed file modified — indexes are stale.\n${REINDEX_MSG}` },
          ],
        };
      }
    }

    // Sentinel writer — track which indexes have completed
    // Read-modify-write whole file to avoid append race conditions.
    // Worst case TOCTOU: duplicate tag line — sentinelIsComplete still works.
    if (event.toolName === "jcodemunch_index_folder" || event.toolName === "jdocmunch_index_local") {
      const tag = event.toolName === "jcodemunch_index_folder" ? "code" : "doc";
      const current = existsSync(sentinelPath) ? readFileSync(sentinelPath, "utf-8") : "";
      if (!current.split("\n").includes(tag)) {
        writeFileSync(sentinelPath, current + tag + "\n");
      }
    }

    // Clear needs-reindex flag when both indexes are fresh
    if (event.toolName === "jcodemunch_index_folder" || event.toolName === "jdocmunch_index_local") {
      if (sentinelIsComplete(sentinelPath) && existsSync(needsReindexPath)) {
        try { unlinkSync(needsReindexPath); } catch {}
      }
    }
  });

  // ── /jmunch command ────────────────────────────────────────────────────────

  pi.registerCommand("jmunch", {
    description: "Manage jMunch enforcer — unblock stuck sessions, check status",
    handler: async (args: string, ctx: any) => {
      const sub = args.trim().split(/\s+/)[0] || "status";

      if (sub === "unblock") {
        writeFileSync(sentinelPath, "code\ndoc\n");
        try { unlinkSync(needsReindexPath); } catch {}
        ctx.ui.notify("Session unblocked — sentinel created, stale flag cleared.", "success");
        return;
      }

      if (sub === "status") {
        const sentinelExists = existsSync(sentinelPath);
        const hasCode = sentinelHas(sentinelPath, "code");
        const hasDoc = sentinelHas(sentinelPath, "doc");
        const stale = existsSync(needsReindexPath);
        const lines = [
          `Sentinel: ${sentinelExists ? `exists (code: ${hasCode ? "✓" : "✗"}, doc: ${hasDoc ? "✓" : "✗"})` : "missing"}`,
          `Needs reindex: ${stale ? "YES" : "no"}`,
          `Gate 1 (session): ${hasCode && hasDoc ? "PASS" : "BLOCKING"}`,
          `Gate 2 (staleness): ${stale ? "BLOCKING ALL TOOLS" : "PASS"}`,
          "",
          "Commands: /jmunch unblock | /jmunch status",
        ];
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      ctx.ui.notify("Unknown subcommand. Use: /jmunch unblock | /jmunch status", "warning");
    },
  });

  // ── Session start: clear sentinel so agent must re-index ─────────────────

  pi.on("session_start", async (_event: any, ctx: any) => {
    try { unlinkSync(sentinelPath); } catch {}
    ctx.ui.notify("jMunch enforcer active — Read blocked on code/doc files, indexes must refresh", "info");
  });
}
