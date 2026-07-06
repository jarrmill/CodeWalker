<script setup lang="ts">
import type { FinalResult } from '~/utils/orientation'

const props = defineProps<{
  finalResult: FinalResult
}>()

defineEmits<{
  reset: []
}>()
</script>

<template>
  <UAlert
    :color="props.finalResult.readyForAnalysis ? 'success' : 'warning'"
    variant="subtle"
    :title="props.finalResult.readyForAnalysis ? 'Ready for deeper analysis' : 'Not ready for deeper analysis'"
    :description="
      props.finalResult.readyForAnalysis
        ? 'You demonstrated understanding across all three orientation stages.'
        : 'One or more stages were skipped or not fully understood.'
    "
  />

  <UCard v-for="stage in DONE_STAGES" :key="stage.key">
    <template #header>
      <div class="flex items-center justify-between">
        <h3 class="font-medium">{{ stage.label }}</h3>
        <div class="flex items-center gap-2">
          <UBadge :color="props.finalResult.stages[stage.key]?.understood ? 'success' : 'error'" variant="subtle">
            {{ props.finalResult.stages[stage.key]?.understood ? 'Understood' : 'Not understood' }}
          </UBadge>
          <UBadge v-if="props.finalResult.stages[stage.key]" color="neutral" variant="subtle">
            Score {{ pct(props.finalResult.stages[stage.key]!.score) }}% ·
            {{ props.finalResult.stages[stage.key]!.attempts }} attempt(s)
          </UBadge>
        </div>
      </div>
    </template>

    <div v-if="props.finalResult.stages[stage.key]" class="flex flex-col gap-3 text-sm">
      <div>
        <p class="font-medium text-gray-600 dark:text-gray-400">Your explanation</p>
        <p class="whitespace-pre-wrap text-gray-700 dark:text-gray-300">
          {{ props.finalResult.stages[stage.key]!.explanation }}
        </p>
      </div>
      <div v-if="props.finalResult.stages[stage.key]!.feedback">
        <p class="font-medium text-gray-600 dark:text-gray-400">Feedback</p>
        <p class="text-gray-700 dark:text-gray-300">{{ props.finalResult.stages[stage.key]!.feedback }}</p>
      </div>
    </div>
  </UCard>

  <UCard v-if="props.finalResult.notes?.length">
    <template #header>
      <h3 class="font-medium">Notes gathered</h3>
    </template>
    <ul class="list-disc list-inside text-sm text-gray-700 dark:text-gray-300">
      <li v-for="(note, i) in props.finalResult.notes" :key="i">{{ note }}</li>
    </ul>
  </UCard>

  <div class="flex justify-end">
    <UButton variant="subtle" @click="$emit('reset')">Orient on another change</UButton>
  </div>
</template>
