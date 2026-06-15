<script setup lang="ts">
// @nuxtjs/supabase handles the token exchange from the URL hash automatically.
// This page is the OAuth/magic-link callback target — just redirect home.
const router = useRouter()
onMounted(() => router.replace('/'))
</script>

<template>
  <div class="min-h-screen flex items-center justify-center">
    <UIcon name="i-heroicons-arrow-path" class="animate-spin text-2xl" />
  </div>
</template>
