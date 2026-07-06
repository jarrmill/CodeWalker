<script setup lang="ts">
import type {
  FinalResult,
  OrientationPhase,
  PullRequestSummary,
  SuspendPayload,
} from '~/utils/orientation'

const user = useSupabaseUser()
const supabase = useSupabaseClient()
const { startOrientation, fetchPullRequest, fetchOpenPullRequests } = useMastra()
const toast = useToast()

const phase = ref<OrientationPhase>('setup')
const loading = ref(false)
// True only while an explanation is being graded by the agent, so we can show a
// distinct "grading" state instead of a frozen card.
const grading = ref(false)

// Setup: the open-PR list and the user's selection
const pullRequests = ref<PullRequestSummary[]>([])
const prsLoading = ref(false)
const selectedPrNumber = ref<number>()

// The selected PR's loaded diff/description
const diff = ref('')
const prDescription = ref('')
const diffTruncated = ref(false)

// Running state (the suspended workflow)
const run = shallowRef<any>(null)
const suspendPayload = ref<SuspendPayload | null>(null)
const suspendedStep = ref<string[] | null>(null)
const explanation = ref('')

// Final state
const finalResult = ref<FinalResult | null>(null)

const currentStageIndex = computed(() =>
  suspendPayload.value ? STAGE_ORDER.indexOf(suspendPayload.value.stage as any) : -1,
)

async function loadOpenPrs() {
  prsLoading.value = true
  try {
    const { pullRequests: prs } = await fetchOpenPullRequests()
    pullRequests.value = (prs ?? [])
      .filter((pr: PullRequestSummary) => !pr.draft)
      .sort((a: PullRequestSummary, b: PullRequestSummary) => b.number - a.number)
  } catch (e: any) {
    toast.add({ title: 'Failed to load open PRs', description: e?.message, color: 'error' })
  } finally {
    prsLoading.value = false
  }
}

async function loadPr(n: number) {
  // The diff/description are cleared while loading so a stale diff can never be
  // submitted for a different PR, and Start stays disabled until the load lands.
  diff.value = ''
  prDescription.value = ''
  diffTruncated.value = false
  loading.value = true
  try {
    const pr = await fetchPullRequest(n)
    diff.value = pr.diff ?? ''
    prDescription.value = [pr.title, pr.description].filter(Boolean).join('\n\n')
    diffTruncated.value = Boolean(pr.diffTruncated)
  } catch (e: any) {
    toast.add({ title: 'Failed to load PR', description: e?.message, color: 'error' })
  } finally {
    loading.value = false
  }
}

// Loading a PR's diff is driven purely by the selection.
watch(selectedPrNumber, (n) => {
  if (n) loadPr(n)
})

onMounted(loadOpenPrs)

function applyResult(result: any) {
  if (result.status === 'suspended') {
    const step = result.suspended?.[0] ?? null
    suspendedStep.value = step
    // The server keys suspendPayload by the suspended step's id, so unwrap to
    // the inner payload (stage, question, feedback, ...) the UI renders.
    const stepId = Array.isArray(step) ? step[0] : step
    suspendPayload.value =
      (stepId && result.suspendPayload?.[stepId]) ?? result.suspendPayload
    explanation.value = ''
    phase.value = 'running'
  } else if (result.status === 'success') {
    finalResult.value = result.result
    phase.value = 'done'
  } else {
    toast.add({
      title: `Workflow ${result.status}`,
      description: result.error?.message,
      color: 'error',
    })
  }
}

async function start() {
  if (!diff.value.trim()) {
    toast.add({ title: 'Provide a diff first', color: 'error' })
    return
  }
  loading.value = true
  try {
    const { run: r, result } = await startOrientation({
      diff: diff.value,
      prDescription: prDescription.value,
    })
    run.value = r
    applyResult(result)
  } catch (e: any) {
    toast.add({ title: 'Could not start orientation', description: e?.message, color: 'error' })
  } finally {
    loading.value = false
  }
}

async function submit(giveUp = false) {
  if (!run.value || !suspendedStep.value) return
  if (!giveUp && !explanation.value.trim()) {
    toast.add({ title: 'Write your explanation first', color: 'error' })
    return
  }
  loading.value = true
  // Skipping advances with the latest grade; only a real submission is "grading".
  grading.value = !giveUp
  try {
    const result = await run.value.resumeAsync({
      step: suspendedStep.value,
      resumeData: { explanation: explanation.value, giveUp },
    })
    applyResult(result)
  } catch (e: any) {
    toast.add({ title: 'Could not submit', description: e?.message, color: 'error' })
  } finally {
    loading.value = false
    grading.value = false
  }
}

function reset() {
  phase.value = 'setup'
  run.value = null
  suspendPayload.value = null
  suspendedStep.value = null
  explanation.value = ''
  finalResult.value = null
  // Keep the fetched PR list, but clear the previous selection and its diff.
  selectedPrNumber.value = undefined
  diff.value = ''
  prDescription.value = ''
  diffTruncated.value = false
}

async function signOut() {
  await supabase.auth.signOut()
  await navigateTo('/login')
}
</script>

<template>
  <div class="flex flex-col min-h-screen bg-gray-50 dark:bg-gray-950">
    <header
      class="border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-between shrink-0"
    >
      <h1 class="font-semibold text-lg">Code Review Orientation</h1>
      <div class="flex items-center gap-3">
        <span class="text-sm text-gray-500 dark:text-gray-400">{{ user?.email }}</span>
        <UButton variant="ghost" size="sm" @click="signOut">Sign out</UButton>
      </div>
    </header>

    <UContainer class="flex-1 w-full max-w-3xl py-6 flex flex-col gap-6">
      <OrientationStageIndicator
        v-if="phase !== 'setup'"
        :phase="phase"
        :current-stage-index="currentStageIndex"
        :attempt="suspendPayload?.attempt"
      />

      <OrientationSetup
        v-if="phase === 'setup'"
        v-model:selected="selectedPrNumber"
        :pull-requests="pullRequests"
        :prs-loading="prsLoading"
        :loading="loading"
        :diff-truncated="diffTruncated"
        :has-diff="Boolean(diff.trim())"
        :pr-description="prDescription"
        @refresh="loadOpenPrs"
        @start="start"
      />

      <OrientationStageRunner
        v-else-if="phase === 'running' && suspendPayload"
        v-model:explanation="explanation"
        :suspend-payload="suspendPayload"
        :current-stage-index="currentStageIndex"
        :loading="loading"
        :grading="grading"
        @submit="submit"
      />

      <OrientationResult
        v-else-if="phase === 'done' && finalResult"
        :final-result="finalResult"
        @reset="reset"
      />
    </UContainer>
  </div>
</template>
