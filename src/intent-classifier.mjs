// Intent classifier — analyzes session turns to recommend an intent tag.
// Used for auto-suggesting Build/Explore/Iterate/Debug intent.

import { getSessionTurns, getSessionRefs, getSessionFiles } from "./db.mjs";

const DEBUG_SIGNALS = /\b(error|bug|fix|broken|not working|crash|exception|stack trace|traceback|undefined|null pointer|segfault|ENOENT|EPERM|TypeError|ReferenceError|SyntaxError|failed|failing|failure|troubleshoot|debug|diagnose|investigate)\b/i;
const EXPLORE_SIGNALS = /\b(how do i|what is|explain|help me understand|can you show|tell me about|research|learn|explore|investigate|what are the options|what would you recommend|documentation)\b/i;
const ITERATE_SIGNALS = /\b(revise|improve|refine|try again|another (round|attempt|version|approach)|let's (tweak|adjust|update|rework|rethink|revisit)|make it (better|more|less)|iterate|brainstorm|polish|enhance)\b/i;
const BUILD_SIGNALS = /\b(create|build|implement|add|write|generate|set up|configure|deploy|install|scaffold|make a|develop)\b/i;

/**
 * Classify a session's intent based on turn content analysis.
 * Returns { intent, confidence, signals } where:
 * - intent: "build" | "explore" | "iterate" | "debug"
 * - confidence: "high" | "medium" | "low"
 * - signals: string[] describing what was detected
 */
export function classifySessionIntent(sessionId) {
  const turns = getSessionTurns(sessionId);
  if (!turns || turns.length === 0) {
    return { intent: "build", confidence: "low", signals: ["No turns to analyze — defaulting to Build"] };
  }

  const refs = getSessionRefs(sessionId);
  const files = getSessionFiles(sessionId);

  const scores = { debug: 0, explore: 0, iterate: 0, build: 0 };
  const signals = [];

  let totalUserTurns = 0;
  let questionTurns = 0;
  let correctionTurns = 0;
  let refinementTurns = 0;
  let errorMentions = 0;

  for (const turn of turns) {
    const msg = cleanMessage(turn.user_message);
    if (!msg) continue;
    totalUserTurns++;

    if (DEBUG_SIGNALS.test(msg)) {
      errorMentions++;
      scores.debug += 3;
    }
    if (EXPLORE_SIGNALS.test(msg)) {
      questionTurns++;
      scores.explore += 2;
    }
    if (ITERATE_SIGNALS.test(msg)) {
      refinementTurns++;
      scores.iterate += 3;
    }
    if (BUILD_SIGNALS.test(msg)) {
      scores.build += 1;
    }

    if (/^(ok|yes|go|sure|lgtm|looks good|proceed|ship|do it|perfect|great|awesome|nice)/i.test(msg) && msg.length < 80) {
      scores.build += 0.5;
    }
    if (/\b(wait|actually|no[, ]|wrong|that's not|stop|shouldn't|revert|undo|go back)\b/i.test(msg)) {
      correctionTurns++;
    }
  }

  const hasFiles = files.length > 0;
  const hasRefs = refs.length > 0;
  const hasCommitsOrPRs = refs.some((r) => r.ref_type === "commit" || r.ref_type === "pr");

  if (errorMentions >= 3) {
    scores.debug += 5;
    signals.push(`${errorMentions} error/debug mentions`);
  }
  if (errorMentions >= 1 && totalUserTurns <= 10) {
    scores.debug += 2;
  }

  if (questionTurns >= 3) {
    scores.explore += 4;
    signals.push(`${questionTurns} question/research turns`);
  }
  if (!hasFiles && questionTurns >= 2) {
    scores.explore += 3;
    signals.push("No file operations — likely research");
  }

  if (refinementTurns >= 2) {
    scores.iterate += 4;
    signals.push(`${refinementTurns} refinement/revision turns`);
  }
  const correctionRate = totalUserTurns > 0 ? correctionTurns / totalUserTurns : 0;
  if (correctionRate > 0.3 && refinementTurns >= 1) {
    scores.iterate += 3;
    signals.push(`High correction rate (${Math.round(correctionRate * 100)}%) with refinement language`);
  }
  if (totalUserTurns >= 15 && correctionRate > 0.2 && refinementTurns >= 1) {
    scores.iterate += 2;
    signals.push("Long session with iterative pattern");
  }

  if (hasFiles) {
    scores.build += 2;
  }
  if (hasRefs) {
    scores.build += 1;
  }
  if (hasCommitsOrPRs) {
    scores.build += 3;
    signals.push("Has commits/PRs — deliverable-oriented");
  }
  if (hasFiles && totalUserTurns <= 10 && correctionRate < 0.2) {
    scores.build += 3;
    signals.push("Efficient build session — few turns, low corrections");
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [bestIntent, bestScore] = sorted[0];
  const [, secondScore] = sorted[1];

  let confidence;
  if (bestScore === 0) {
    confidence = "low";
  } else if (bestScore - secondScore >= 5) {
    confidence = "high";
  } else if (bestScore - secondScore >= 2) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  if (signals.length === 0) {
    signals.push("Default classification based on general patterns");
  }

  return { intent: bestIntent, confidence, signals };
}

function cleanMessage(msg) {
  if (!msg) return "";
  return msg
    .replace(/<[^>]*>[\s\S]*?<\/[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
