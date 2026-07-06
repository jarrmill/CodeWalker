<script setup lang="ts">
import type { SuspendPayload } from '~/utils/orientation'

const props = defineProps<{
  suspendPayload: SuspendPayload
  currentStageIndex: number
  loading: boolean
  grading: boolean
}>()

const emit = defineEmits<{
  submit: [giveUp: boolean]
}>()

const explanation = defineModel<string>('explanation', { required: true })
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between">
        <div>
          <p class="text-xs text-gray-400 dark:text-gray-500">
            Stage {{ props.currentStageIndex + 1 }} of {{ TOTAL_STAGES }}
          </p>
          <h2 class="font-medium">{{ STAGE_LABELS[props.suspendPayload.stage] }}</h2>
        </div>
        <div class="flex items-center gap-2">
          <UBadge v-if="props.suspendPayload.previousScore != null" color="neutral" variant="subtle">
            Last score {{ pct(props.suspendPayload.previousScore) }}%
          </UBadge>
          <UBadge v-if="props.suspendPayload.attempt > 1" color="warning" variant="subtle">
            Attempt {{ props.suspendPayload.attempt }}
          </UBadge>
        </div>
      </div>
    </template>

    <!-- Grading in progress: distinct state so the card never looks frozen -->
    <div v-if="props.grading" class="flex flex-col items-center justify-center gap-3 py-10 text-center">
      <UIcon name="i-lucide-loader-circle" class="size-8 animate-spin text-primary-500" />
      <p class="font-medium">Grading your explanation…</p>
      <p class="text-sm text-gray-500 dark:text-gray-400">
        Checking your understanding of "{{ STAGE_LABELS[props.suspendPayload.stage] }}".
      </p>
    </div>

    <div v-else class="flex flex-col gap-4">
      <p class="text-gray-700 dark:text-gray-300">{{ props.suspendPayload.question }}</p>

      <UAlert
        v-if="props.suspendPayload.previousFeedback"
        color="warning"
        variant="subtle"
        :title="`Not quite — try again${props.suspendPayload.previousScore != null ? ` (scored ${pct(props.suspendPayload.previousScore)}%)` : ''}`"
        :description="props.suspendPayload.previousFeedback"
      />

      <div
        v-if="props.suspendPayload.scoreHistory?.length"
        class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400"
      >
        <span class="font-medium">Your scores:</span>
        <span
          v-for="(s, i) in props.suspendPayload.scoreHistory"
          :key="i"
          class="flex items-center gap-2"
        >
          <span class="font-mono">{{ pct(s) }}%</span>
          <span v-if="i < props.suspendPayload.scoreHistory.length - 1" class="text-gray-300 dark:text-gray-700">→</span>
        </span>
      </div>

      <div v-if="props.suspendPayload.missingPoints?.length" class="text-sm">
        <p class="font-medium text-gray-600 dark:text-gray-400 mb-1">You missed:</p>
        <ul class="list-disc list-inside text-gray-600 dark:text-gray-400">
          <li v-for="(p, i) in props.suspendPayload.missingPoints" :key="i">{{ p }}</li>
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

      <UAlert
        color="neutral"
        variant="subtle"
        icon="i-lucide-info"
        description="Skipping records your latest grade for this stage. If it hasn't passed, the final readiness verdict will reflect that."
      />

      <div class="flex justify-between">
        <UButton variant="ghost" color="neutral" :loading="props.loading" @click="emit('submit', true)">
          Skip this stage
        </UButton>
        <UButton :loading="props.loading" :disabled="!explanation.trim()" @click="emit('submit', false)">
          Submit for grading
        </UButton>
      </div>
    </div>
  </UCard>
</template>
