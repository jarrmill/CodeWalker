import type { GradeOrientationStageInput, OrientationStage } from '../agents/orientation-grader';

/**
 * Labelled eval cases for the orientation grader.
 *
 * Each case is a real grading request plus the verdict a good grader should
 * reach. Running the grader over these and comparing `understood` to
 * `expectedUnderstood` gives classification accuracy/precision/recall — the
 * high-signal, deterministic backbone eval for the grader.
 *
 * Coverage aims: all three stages, both labels, and the failure modes that
 * matter — vague/partial answers, confidently-wrong answers, blank answers,
 * and answers that critique the change instead of explaining it.
 */
export interface OrientationEvalCase extends GradeOrientationStageInput {
  id: string;
  stage: OrientationStage;
  expectedUnderstood: boolean;
  // Points a good grader should surface when understood=false. Documentation of
  // intent for now; the accuracy scorer keys off expectedUnderstood.
  expectedMissingPoints?: string[];
  // Why this case exists / what behaviour it probes.
  note: string;
}

// --- Shared diff fixtures ---------------------------------------------------
// Kept small and self-contained so the dataset reads cleanly. Author and repo
// live in the PR description because that (plus the diff) is all the grader is
// given — it cannot see PR metadata the chat agent doesn't pass through.

const AUTH_BUGFIX_DIFF = `diff --git a/src/auth/session.ts b/src/auth/session.ts
--- a/src/auth/session.ts
+++ b/src/auth/session.ts
@@ -14,7 +14,10 @@ export function getSession(req: Request): Session | null {
   const token = req.headers['authorization']?.split(' ')[1];
-  const payload = jwt.verify(token, SECRET);
-  return { userId: payload.sub, roles: payload.roles };
+  if (!token) return null;
+  const payload = jwt.verify(token, SECRET);
+  return { userId: payload.sub, roles: payload.roles ?? [] };
 }`;

const AUTH_BUGFIX_PR = `Fix crash when the Authorization header is missing.
getSession called jwt.verify on an undefined token and threw. Guard for a
missing token by returning null, and default roles to an empty array.
Author: dev-alice. Repository: acme/web-api.`;

const MAU_FEATURE_DIFF = `diff --git a/app/reports.py b/app/reports.py
--- a/app/reports.py
+++ b/app/reports.py
@@ -1,3 +1,9 @@
 from app.db import query
+
+def monthly_active_users(start, end):
+    rows = query(
+        "SELECT count(distinct user_id) FROM events WHERE ts BETWEEN %s AND %s",
+        (start, end),
+    )
+    return rows[0][0]`;

const MAU_FEATURE_PR = `Add a monthly_active_users report helper for the analytics dashboard.
The dashboard needs a MAU metric and there was no query for it yet.
Author: bob-eng. Repository: acme/analytics.`;

const auth = { diff: AUTH_BUGFIX_DIFF, prDescription: AUTH_BUGFIX_PR };
const mau = { diff: MAU_FEATURE_DIFF, prDescription: MAU_FEATURE_PR };

export const orientationEvalDataset: OrientationEvalCase[] = [
  // --- Stage 1: select the review task ------------------------------------
  {
    id: 'auth-select-good',
    stage: 'select-task',
    ...auth,
    explanation:
      "It's a small, focused change to getSession in src/auth/session.ts — one function in one file. It adds a null check for a missing token and defaults roles to an empty array. Scope is clear enough to review.",
    expectedUnderstood: true,
    note: 'Correct: names the file/function, characterises scope, judges it review-ready.',
  },
  {
    id: 'auth-select-vague',
    stage: 'select-task',
    ...auth,
    explanation: 'It changes some authentication code.',
    expectedUnderstood: false,
    expectedMissingPoints: ['which file/function', 'how large the scope is'],
    note: 'Partial: no files named, scope unstated.',
  },
  {
    id: 'auth-select-wrong-scope',
    stage: 'select-task',
    ...auth,
    explanation:
      "It's a large refactor of the whole authentication system spanning many files and modules.",
    expectedUnderstood: false,
    expectedMissingPoints: ['scope is one small function, not a system-wide refactor'],
    note: 'Confidently-wrong: mischaracterises a one-function fix as a big refactor.',
  },
  {
    id: 'mau-select-good',
    stage: 'select-task',
    ...mau,
    explanation:
      'Adds a new function monthly_active_users in app/reports.py. Small additive change touching a single file; scope is clear.',
    expectedUnderstood: true,
    note: 'Correct on an additive feature.',
  },
  {
    id: 'mau-select-blank',
    stage: 'select-task',
    ...mau,
    explanation: '',
    expectedUnderstood: false,
    expectedMissingPoints: ['no explanation given'],
    note: 'Blank answer must fail.',
  },

  // --- Stage 2: understand the context ------------------------------------
  {
    id: 'auth-context-good',
    stage: 'understand-context',
    ...auth,
    explanation:
      'Authored by dev-alice in the acme/web-api repository. The language is TypeScript. It is a bug fix.',
    expectedUnderstood: true,
    note: 'Correct: author, repo, language, and change type.',
  },
  {
    id: 'auth-context-partial',
    stage: 'understand-context',
    ...auth,
    explanation: "It's written in TypeScript.",
    expectedUnderstood: false,
    expectedMissingPoints: ['author', 'repository', 'type of change'],
    note: 'Partial: only language, misses author/repo/type.',
  },
  {
    id: 'mau-context-good',
    stage: 'understand-context',
    ...mau,
    explanation:
      'bob-eng authored it in acme/analytics. The language is Python, and the change type is a new feature.',
    expectedUnderstood: true,
    note: 'Correct on the feature fixture.',
  },
  {
    id: 'mau-context-wrong',
    stage: 'understand-context',
    ...mau,
    explanation: "It's a Java refactor.",
    expectedUnderstood: false,
    expectedMissingPoints: ['language is Python not Java', 'type is a feature not a refactor', 'author/repo'],
    note: 'Confidently-wrong on language and change type.',
  },

  // --- Stage 3: understand the rationale (the "why") ----------------------
  {
    id: 'auth-rationale-good',
    stage: 'understand-rationale',
    ...auth,
    explanation:
      'getSession crashed when the Authorization header was missing because it ran jwt.verify on an undefined token. The change returns null for a missing token to prevent that crash, and defaults roles to [] to harden the return value.',
    expectedUnderstood: true,
    priorNotes: ['Bug fix in src/auth/session.ts (getSession).'],
    note: 'Correct: articulates both what and why, grounded in the diff/description.',
  },
  {
    id: 'auth-rationale-shallow',
    stage: 'understand-rationale',
    ...auth,
    explanation: 'It changes the code to make it better.',
    expectedUnderstood: false,
    expectedMissingPoints: ['what specifically it does', 'why (the missing-header crash)'],
    note: 'Shallow: no concrete what or why.',
  },
  {
    id: 'auth-rationale-critique',
    stage: 'understand-rationale',
    ...auth,
    explanation:
      'They should have used optional chaining instead and added unit tests for the missing-token path.',
    expectedUnderstood: false,
    expectedMissingPoints: ['this critiques the change rather than explaining its rationale'],
    note: 'Probes the guardrail: critiquing the change is not explaining the rationale — must not pass.',
  },
  {
    id: 'mau-rationale-good',
    stage: 'understand-rationale',
    ...mau,
    explanation:
      'It adds a helper so the analytics dashboard can display monthly active users. The why: the dashboard needs a MAU metric and no query existed for it.',
    expectedUnderstood: true,
    priorNotes: ['New feature in app/reports.py adding monthly_active_users.'],
    note: 'Correct rationale on the feature fixture.',
  },
];
