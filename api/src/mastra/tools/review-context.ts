/**
 * Per-thread store of the change currently under review — its diff and
 * description. Populated when a pull request is fetched or a raw diff is pasted,
 * and read by the orientation grader tool.
 *
 * Why this exists: a diff can be tens of thousands of tokens. Routing it through
 * the chat model as grade-tool arguments made the model re-emit the whole diff
 * on every grade turn — slow, expensive, and error-prone (it sometimes sent an
 * empty diff, grading blind). Keeping the diff server-side, keyed by the memory
 * thread, means it travels through the model exactly once (when the change is
 * loaded) and the grader reads it directly.
 *
 * The server keeps this in process memory, matching the existing in-process PR
 * cache in github-tool. Entries carry a TTL so abandoned sessions don't
 * accumulate. If an entry is missing (e.g. a fresh process), the grader tool
 * surfaces a clear error and the agent reloads the change.
 */

interface ReviewContextEntry {
  diff: string;
  prDescription: string;
  expiresAt: number;
}

const REVIEW_CONTEXT_TTL_MS = 60 * 60 * 1000; // 1 hour

const reviewContextByThread = new Map<string, ReviewContextEntry>();

function pruneExpired(now: number): void {
  for (const [threadId, entry] of reviewContextByThread) {
    if (entry.expiresAt <= now) {
      reviewContextByThread.delete(threadId);
    }
  }
}

export interface ReviewContext {
  diff: string;
  prDescription: string;
}

/**
 * Record the change under review for a memory thread. No-ops without a threadId
 * (nothing to key on) rather than sharing a single slot across users.
 */
export function setReviewContext(threadId: string | undefined, context: ReviewContext): void {
  if (!threadId) {
    return;
  }
  const now = Date.now();
  pruneExpired(now);
  reviewContextByThread.set(threadId, {
    diff: context.diff,
    prDescription: context.prDescription,
    expiresAt: now + REVIEW_CONTEXT_TTL_MS,
  });
}

/** Read the change under review for a thread, or undefined if none is loaded. */
export function getReviewContext(threadId: string | undefined): ReviewContext | undefined {
  if (!threadId) {
    return undefined;
  }
  const entry = reviewContextByThread.get(threadId);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt <= Date.now()) {
    reviewContextByThread.delete(threadId);
    return undefined;
  }
  return { diff: entry.diff, prDescription: entry.prDescription };
}
