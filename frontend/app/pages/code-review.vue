<script setup lang="ts">
const user = useSupabaseUser()
const supabase = useSupabaseClient()
const { startOrientation, fetchPullRequest } = useMastra()
const toast = useToast()

type StageKey = 'selectTask' | 'understandContext' | 'understandRationale'

const STAGE_ORDER = ['select-task', 'understand-context', 'understand-rationale'] as const
const STAGE_LABELS: Record<string, string> = {
  'select-task': 'Select the review task',
  'understand-context': 'Understand the context',
  'understand-rationale': 'Understand the rationale',
}
const DONE_STAGES: { key: StageKey; label: string }[] = [
  { key: 'selectTask', label: 'Select the review task' },
  { key: 'understandContext', label: 'Understand the context' },
  { key: 'understandRationale', label: 'Understand the rationale' },
]

const phase = ref<'setup' | 'running' | 'done'>('setup')
const loading = ref(false)

// Setup inputs
const pullNumber = ref('')
const diff = ref('')
const prDescription = ref('')
const diffTruncated = ref(false)

// Running state (the suspended workflow)
const run = shallowRef<any>(null)
const suspendPayload = ref<any>(null)
const suspendedStep = ref<string[] | null>(null)
const explanation = ref('')

// Final state
const finalResult = ref<any>(null)

const currentStageIndex = computed(() =>
  suspendPayload.value ? STAGE_ORDER.indexOf(suspendPayload.value.stage) : -1,
)

async function loadPr() {
  const n = Number(pullNumber.value)
  if (!Number.isInteger(n) || n <= 0) {
    toast.add({ title: 'Enter a valid PR number', color: 'error' })
    return
  }
  loading.value = true
  try {
    const pr = await fetchPullRequest(n)
    diff.value = pr.diff ?? ''
    prDescription.value = [pr.title, pr.description].filter(Boolean).join('\n\n')
    diffTruncated.value = Boolean(pr.diffTruncated)
    toast.add({ title: `Loaded PR #${pr.number}`, description: pr.title, color: 'success' })
  } catch (e: any) {
    toast.add({ title: 'Failed to load PR', description: e?.message, color: 'error' })
  } finally {
    loading.value = false
  }
}

function applyResult(result: any) {
  if (result.status === 'suspended') {
    suspendPayload.value = result.suspendPayload
    suspendedStep.value = result.suspended?.[0] ?? null
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
  }
}

function reset() {
  phase.value = 'setup'
  run.value = null
  suspendPayload.value = null
  suspendedStep.value = null
  explanation.value = ''
  finalResult.value = null
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
      <!-- Stage indicator (running / done) -->
      <ol v-if="phase !== 'setup'" class="flex items-center gap-2 text-sm">
        <li
          v-for="(id, i) in STAGE_ORDER"
          :key="id"
          class="flex items-center gap-2"
        >
          <span
            class="flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium"
            :class="
              phase === 'done' || i < currentStageIndex
                ? 'bg-primary-500 text-white'
                : i === currentStageIndex
                  ? 'bg-primary-100 text-primary-700 ring-2 ring-primary-500 dark:bg-primary-900 dark:text-primary-200'
                  : 'bg-gray-200 text-gray-500 dark:bg-gray-800'
            "
          >
            {{ phase === 'done' || i < currentStageIndex ? '✓' : i + 1 }}
          </span>
          <span :class="i === currentStageIndex && phase === 'running' ? 'font-medium' : 'text-gray-500'">
            {{ STAGE_LABELS[id] }}
          </span>
          <span v-if="i < STAGE_ORDER.length - 1" class="text-gray-300 dark:text-gray-700">→</span>
        </li>
      </ol>

      <!-- Setup -->
      <UCard v-if="phase === 'setup'">
        <template #header>
          <h2 class="font-medium">Pick a change to orient on</h2>
        </template>

        <div class="flex flex-col gap-4">
          <div class="flex items-end gap-2">
            <UFormField label="Pull request number" class="flex-1">
              <UInput v-model="pullNumber" type="number" placeholder="e.g. 5" />
            </UFormField>
            <UButton :loading="loading" variant="subtle" @click="loadPr">Load PR</UButton>
          </div>

          <UFormField label="PR description / context">
            <UTextarea v-model="prDescription" :rows="3" placeholder="Title and description of the change..." class="w-full" />
          </UFormField>

          <UFormField label="Diff">
            <UTextarea v-model="diff" :rows="10" placeholder="Paste a unified diff, or load a PR above..." class="w-full font-mono text-xs" />
          </UFormField>

          <UAlert
            v-if="diffTruncated"
            color="warning"
            variant="subtle"
            title="Diff was truncated"
            description="The loaded diff exceeded the size limit and was cut off."
          />

          <div class="flex justify-end">
            <UButton :loading="loading" :disabled="!diff.trim()" @click="start">
              Start orientation
            </UButton>
          </div>
        </div>
      </UCard>

      <!-- Running: collect the user's explanation for the current stage -->
      <UCard v-else-if="phase === 'running' && suspendPayload">
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="font-medium">{{ STAGE_LABELS[suspendPayload.stage] }}</h2>
            <UBadge v-if="suspendPayload.attempt > 1" color="warning" variant="subtle">
              Attempt {{ suspendPayload.attempt }}
            </UBadge>
          </div>
        </template>

        <div class="flex flex-col gap-4">
          <p class="text-gray-700 dark:text-gray-300">{{ suspendPayload.question }}</p>

          <UAlert
            v-if="suspendPayload.previousFeedback"
            color="warning"
            variant="subtle"
            title="Not quite — try again"
            :description="suspendPayload.previousFeedback"
          />

          <div v-if="suspendPayload.missingPoints?.length" class="text-sm">
            <p class="font-medium text-gray-600 dark:text-gray-400 mb-1">You missed:</p>
            <ul class="list-disc list-inside text-gray-600 dark:text-gray-400">
              <li v-for="(p, i) in suspendPayload.missingPoints" :key="i">{{ p }}</li>
            </ul>
          </div>

          <UFormField label="Your explanation">
            <UTextarea
              v-model="explanation"
              :rows="6"
              placeholder="Explain this stage in your own words..."
              class="w-full"
            />
          </UFormField>

          <div class="flex justify-between">
            <UButton variant="ghost" color="neutral" :loading="loading" @click="submit(true)">
              Skip this stage
            </UButton>
            <UButton :loading="loading" :disabled="!explanation.trim()" @click="submit(false)">
              Submit for grading
            </UButton>
          </div>
        </div>
      </UCard>

      <!-- Done: show the verdict -->
      <template v-else-if="phase === 'done' && finalResult">
        <UAlert
          :color="finalResult.readyForAnalysis ? 'success' : 'warning'"
          variant="subtle"
          :title="finalResult.readyForAnalysis ? 'Ready for deeper analysis' : 'Not ready for deeper analysis'"
          :description="
            finalResult.readyForAnalysis
              ? 'You demonstrated understanding across all three orientation stages.'
              : 'One or more stages were skipped or not fully understood.'
          "
        />

        <UCard v-for="stage in DONE_STAGES" :key="stage.key">
          <template #header>
            <div class="flex items-center justify-between">
              <h3 class="font-medium">{{ stage.label }}</h3>
              <div class="flex items-center gap-2">
                <UBadge :color="finalResult.stages[stage.key]?.understood ? 'success' : 'error'" variant="subtle">
                  {{ finalResult.stages[stage.key]?.understood ? 'Understood' : 'Not understood' }}
                </UBadge>
                <UBadge v-if="finalResult.stages[stage.key]" color="neutral" variant="subtle">
                  Score {{ Math.round((finalResult.stages[stage.key].score ?? 0) * 100) }}% ·
                  {{ finalResult.stages[stage.key].attempts }} attempt(s)
                </UBadge>
              </div>
            </div>
          </template>

          <div v-if="finalResult.stages[stage.key]" class="flex flex-col gap-3 text-sm">
            <div>
              <p class="font-medium text-gray-600 dark:text-gray-400">Your explanation</p>
              <p class="whitespace-pre-wrap text-gray-700 dark:text-gray-300">
                {{ finalResult.stages[stage.key].explanation }}
              </p>
            </div>
            <div v-if="finalResult.stages[stage.key].feedback">
              <p class="font-medium text-gray-600 dark:text-gray-400">Feedback</p>
              <p class="text-gray-700 dark:text-gray-300">{{ finalResult.stages[stage.key].feedback }}</p>
            </div>
          </div>
        </UCard>

        <UCard v-if="finalResult.notes?.length">
          <template #header>
            <h3 class="font-medium">Notes gathered</h3>
          </template>
          <ul class="list-disc list-inside text-sm text-gray-700 dark:text-gray-300">
            <li v-for="(note, i) in finalResult.notes" :key="i">{{ note }}</li>
          </ul>
        </UCard>

        <div class="flex justify-end">
          <UButton variant="subtle" @click="reset">Orient on another change</UButton>
        </div>
      </template>
    </UContainer>
  </div>
</template>
