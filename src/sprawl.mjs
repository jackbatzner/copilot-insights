// Session sprawl detection — identifies scope creep, topic drift, and distraction.
// Complements redirection detection by analyzing session-level patterns.

import { getSessionTurns, getSessionFiles } from "./db.mjs";

/**
 * Scope creep patterns — phrases that indicate adding unrelated work mid-session.
 */
const SCOPE_PATTERNS = [
  { pattern: /\b(can you |could you )?(also|additionally)\b/i, label: "Scope addition", weight: 2 },
  { pattern: /\bone more thing\b/i, label: "Task addition", weight: 2 },
  { pattern: /\bwhile (you're|we're|you are) at it\b/i, label: "Piggyback request", weight: 2 },
  { pattern: /\boh and\b/i, label: "Afterthought", weight: 1 },
  { pattern: /\bbefore (I|we) forget\b/i, label: "Afterthought", weight: 1 },
  { pattern: /\breal quick\b/i, label: "Quick detour", weight: 1 },
  { pattern: /\bunrelated\b.*\bbut\b/i, label: "Unrelated tangent", weight: 3 },
  { pattern: /\bseparate(ly)?\b.*\b(can|could|let'?s)\b/i, label: "Separate task", weight: 2 },
  { pattern: /\bcompletely different\b/i, label: "Topic switch", weight: 3 },
  { pattern: /\bchange of topic\b/i, label: "Explicit topic change", weight: 3 },
  { pattern: /\bswitch(ing)? gears?\b/i, label: "Gear switch", weight: 2 },
  { pattern: /\bside( |-)?track/i, label: "Sidetrack", weight: 2 },
  { pattern: /\banyway(s)?[,.]?\s+(can|let|now)\b/i, label: "Topic pivot", weight: 1 },
  { pattern: /\bnew task\b/i, label: "New task declaration", weight: 3 },
  { pattern: /\bmoving on\b/i, label: "Moving on", weight: 2 },
];

/**
 * Extract top-level directory from a file path.
 */
function topDir(filePath) {
  const parts = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > 1 ? parts[0] : "(root)";
}

/**
 * Extract keywords from a user message for topic similarity.
 */
function extractKeywords(message) {
  if (!message) return new Set();
  const cleaned = message
    .replace(/<[^>]*>[\s\S]*?<\/[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .toLowerCase();
  // Keep meaningful words (4+ chars, no common stop words)
  const stops = new Set([
    "this", "that", "with", "from", "have", "been", "will", "would", "could",
    "should", "about", "there", "their", "they", "them", "then", "than",
    "what", "when", "where", "which", "while", "were", "your", "just",
    "also", "some", "make", "like", "does", "done", "into", "each",
    "here", "more", "very", "much", "need", "want", "please", "using",
    "file", "code", "sure", "okay", "yeah", "let's",
  ]);
  return new Set(
    cleaned.match(/\b[a-z]{4,}\b/g)?.filter((w) => !stops.has(w)) || []
  );
}

/**
 * Jaccard similarity between two keyword sets.
 */
function similarity(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  return intersection / (setA.size + setB.size - intersection);
}

/**
 * Analyze a session for sprawl indicators.
 */
export function analyzeSprawl(sessionId) {
  const turns = getSessionTurns(sessionId);
  const files = getSessionFiles(sessionId);

  const userTurns = turns.filter((t) => t.user_message);
  if (userTurns.length < 2) return null;

  // ── 1. Scope creep pattern matching ────────────────────────
  const scopeAdditions = [];
  for (const turn of userTurns) {
    const cleaned = turn.user_message
      .replace(/<[^>]*>[\s\S]*?<\/[^>]*>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .trim();
    if (cleaned.length < 3) continue;

    for (const p of SCOPE_PATTERNS) {
      if (p.pattern.test(cleaned)) {
        scopeAdditions.push({
          turnIndex: turn.turn_index,
          timestamp: turn.timestamp,
          message: cleaned.substring(0, 200),
          label: p.label,
          weight: p.weight,
        });
        break; // one match per turn
      }
    }
  }

  // ── 2. File spread — how many different areas are touched ───
  const uniqueDirs = new Set(files.map((f) => topDir(f.file_path)));
  const uniqueFiles = new Set(files.map((f) => f.file_path));
  const fileSpread = uniqueDirs.size;

  // ── 3. Topic drift — keyword similarity between consecutive messages ───
  const topicShifts = [];
  let prevKeywords = null;
  for (let i = 0; i < userTurns.length; i++) {
    const kw = extractKeywords(userTurns[i].user_message);
    if (prevKeywords && kw.size > 0) {
      const sim = similarity(prevKeywords, kw);
      if (sim < 0.05 && prevKeywords.size >= 3 && kw.size >= 3) {
        topicShifts.push({
          fromTurn: userTurns[i - 1].turn_index,
          toTurn: userTurns[i].turn_index,
          similarity: sim,
          message: userTurns[i].user_message.substring(0, 150),
        });
      }
    }
    if (kw.size > 0) prevKeywords = kw;
  }

  // ── 4. Session duration ────────────────────────────────────
  const timestamps = turns
    .map((t) => t.timestamp)
    .filter(Boolean)
    .map((t) => new Date(t).getTime())
    .filter((t) => !isNaN(t));
  const durationMinutes =
    timestamps.length >= 2
      ? (Math.max(...timestamps) - Math.min(...timestamps)) / 60000
      : 0;

  // ── 5. Sprawl score (0-100, higher = more sprawl) ─────────
  let sprawlScore = 0;

  // Turn count factor (sessions over 15 turns start accumulating)
  if (userTurns.length > 30) sprawlScore += 25;
  else if (userTurns.length > 20) sprawlScore += 15;
  else if (userTurns.length > 15) sprawlScore += 8;

  // Scope additions
  sprawlScore += Math.min(30, scopeAdditions.length * 10);

  // Topic drift
  sprawlScore += Math.min(25, topicShifts.length * 8);

  // File spread (touching 5+ different top-level dirs)
  if (fileSpread > 8) sprawlScore += 20;
  else if (fileSpread > 5) sprawlScore += 12;
  else if (fileSpread > 3) sprawlScore += 5;

  sprawlScore = Math.min(100, sprawlScore);

  // ── Sprawl level label ────────────────────────────────────
  let level;
  if (sprawlScore >= 70) level = { label: "High Sprawl", emoji: "🌊", color: "red" };
  else if (sprawlScore >= 40) level = { label: "Moderate Sprawl", emoji: "📐", color: "yellow" };
  else if (sprawlScore >= 15) level = { label: "Mild Drift", emoji: "〰️", color: "green" };
  else level = { label: "Focused", emoji: "🎯", color: "green" };

  return {
    sprawlScore,
    level,
    turnCount: userTurns.length,
    durationMinutes: Math.round(durationMinutes),
    scopeAdditions,
    topicShifts,
    fileSpread: {
      directories: uniqueDirs.size,
      files: uniqueFiles.size,
      topDirs: [...uniqueDirs].slice(0, 10),
    },
    summary: {
      scopeCreepCount: scopeAdditions.length,
      topicShiftCount: topicShifts.length,
    },
  };
}
