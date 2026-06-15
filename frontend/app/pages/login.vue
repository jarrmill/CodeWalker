<script setup lang="ts">
definePageMeta({ layout: false })

const supabase = useSupabaseClient()
const loading = ref(false)
const email = ref('')
const error = ref('')

async function signInWithEmail() {
  loading.value = true
  error.value = ''
  const { error: err } = await supabase.auth.signInWithOtp({
    email: email.value,
    options: { emailRedirectTo: `${window.location.origin}/confirm` },
  })
  loading.value = false
  if (err) {
    error.value = err.message
  } else {
    error.value = ''
    email.value = ''
    // Show confirmation — UNotifications handles this via useToast
    useToast().add({ title: 'Check your email', description: 'We sent you a magic link.' })
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
    <UCard class="w-full max-w-sm">
      <template #header>
        <h1 class="text-xl font-semibold text-center">CodeWalker</h1>
        <p class="text-sm text-center text-gray-500 dark:text-gray-400 mt-1">
          Sign in with your email
        </p>
      </template>

      <UForm @submit="signInWithEmail" class="space-y-4">
        <UFormField label="Email" name="email">
          <UInput
            v-model="email"
            type="email"
            placeholder="you@example.com"
            autocomplete="email"
            class="w-full"
            required
          />
        </UFormField>

        <UAlert v-if="error" color="error" :description="error" />

        <UButton type="submit" class="w-full" :loading="loading">
          Send magic link
        </UButton>
      </UForm>
    </UCard>
    <UNotifications />
  </div>
</template>
