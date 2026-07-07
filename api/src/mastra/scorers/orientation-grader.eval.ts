/**
 * Offline eval harness for the orientation grader.
 *
 * Runs the standalone `gradeOrientationStage` over the labelled dataset, scores
 * each verdict with `orientationGradeAccuracyScorer`, and reports accuracy plus
 * precision/recall/F1 (treating understood=true as the positive class). This is
 * the deterministic backbone eval: it isolates the grader's judgment from the
 * chat agent, so a prompt or model change shows up as a metric movement here.
 *
 * Run it (loads model credentials from .env):
 *   npm run eval:orientation
 *
 * Exits non-zero if accuracy falls below THRESHOLD, so it can gate CI.
 */
import { gradeOrientationStage } from '../agents/orientation-grader';
import { orientationEvalDataset } from './orientation-eval-dataset';
import { orientationGradeAccuracyScorer } from './orientation-grader-scorer';

const THRESHOLD = 0.85;

interface Outcome {
  id: string;
  stage: string;
  expected: boolean;
  actual: boolean;
  correct: boolean;
  reason: string;
}

const outcomes: Outcome[] = [];

for (const testCase of orientationEvalDataset) {
  const grade = await gradeOrientationStage({
    stage: testCase.stage,
    diff: testCase.diff,
    prDescription: testCase.prDescription,
    explanation: testCase.explanation,
    priorNotes: testCase.priorNotes,
  });

  const result = await orientationGradeAccuracyScorer.run({
    input: { stage: testCase.stage, explanation: testCase.explanation },
    output: grade,
    groundTruth: { expectedUnderstood: testCase.expectedUnderstood },
  });

  outcomes.push({
    id: testCase.id,
    stage: testCase.stage,
    expected: testCase.expectedUnderstood,
    actual: grade.understood,
    correct: result.score === 1,
    reason: result.reason ?? '',
  });

  const mark = result.score === 1 ? '✓' : '✗';
  console.log(`${mark} ${testCase.id.padEnd(24)} ${result.reason}`);
}

// Confusion matrix with understood=true as the positive class.
const tp = outcomes.filter((o) => o.expected && o.actual).length;
const fp = outcomes.filter((o) => !o.expected && o.actual).length;
const fn = outcomes.filter((o) => o.expected && !o.actual).length;
const tn = outcomes.filter((o) => !o.expected && !o.actual).length;

const total = outcomes.length;
const accuracy = (tp + tn) / total;
const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

console.log('\n— Orientation grader eval —');
console.log(`cases:     ${total}`);
console.log(`accuracy:  ${pct(accuracy)} (${tp + tn}/${total})`);
console.log(`precision: ${pct(precision)}  recall: ${pct(recall)}  F1: ${f1.toFixed(3)}`);
console.log(`confusion: TP=${tp} FP=${fp} FN=${fn} TN=${tn}`);

const misses = outcomes.filter((o) => !o.correct);
if (misses.length) {
  console.log(`\nMisclassified (${misses.length}):`);
  for (const m of misses) console.log(`  - ${m.id}: ${m.reason}`);
}

if (accuracy < THRESHOLD) {
  console.error(`\nFAIL: accuracy ${pct(accuracy)} < threshold ${pct(THRESHOLD)}`);
  process.exit(1);
}
console.log(`\nPASS: accuracy ${pct(accuracy)} >= threshold ${pct(THRESHOLD)}`);
