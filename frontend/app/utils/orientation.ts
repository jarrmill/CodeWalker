// Shared constants and types for the code-review orientation flow. Auto-imported
// by Nuxt across the page and its components.

export type StageKey = 'selectTask' | 'understandContext' | 'understandRationale'

export const STAGE_ORDER = ['select-task', 'understand-context', 'understand-rationale'] as const

export const STAGE_LABELS: Record<string, string> = {
  'select-task': 'Select the review task',
  'understand-context': 'Understand the context',
  'understand-rationale': 'Understand the rationale',
}

export const DONE_STAGES: { key: StageKey; label: string }[] = [
  { key: 'selectTask', label: 'Select the review task' },
  { key: 'understandContext', label: 'Understand the context' },
  { key: 'understandRationale', label: 'Understand the rationale' },
]

export const TOTAL_STAGES = STAGE_ORDER.length

/** The workflow phase the page is in. */
export type OrientationPhase = 'setup' | 'running' | 'done'

/** Summary of an open pull request, as returned by the open-PRs tool. */
export interface PullRequestSummary {
  number: number
  title: string
  state: string
  draft: boolean
  url: string
  author: string | null
  authorUrl: string | null
  labels: string[]
  createdAt: string
  updatedAt: string
}

/** Payload the workflow emits each time it suspends to collect an explanation. */
export interface SuspendPayload {
  stage: string
  question: string
  attempt: number
  previousScore?: number | null
  previousFeedback?: string
  scoreHistory?: number[]
  missingPoints?: string[]
}

/** Per-stage grade in the final result. */
export interface StageResult {
  understood: boolean
  score?: number
  attempts: number
  explanation: string
  feedback?: string
}

/** The workflow's final verdict, rendered once all stages complete. */
export interface FinalResult {
  readyForAnalysis: boolean
  stages: Partial<Record<StageKey, StageResult>>
  notes?: string[]
}

/** Formats a 0–1 score as a whole-number percentage. */
export function pct(score: number | undefined | null) {
  return Math.round((score ?? 0) * 100)
}
