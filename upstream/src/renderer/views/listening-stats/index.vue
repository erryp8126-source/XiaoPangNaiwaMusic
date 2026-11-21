<template>
  <div class="listening-stats-page h-full w-full bg-transparent">
    <n-scrollbar class="h-full">
      <div class="page-padding pt-3 max-w-2xl mx-auto">
        <div class="flex items-center justify-between mb-3 px-1">
          <div>
            <h2 class="text-xl font-extrabold text-slate-800 dark:text-white tracking-tight">
              听歌时长统计
            </h2>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              记录每一段与旋律相伴的时光
            </p>
          </div>
        </div>
        <listening-stats-panel />
      </div>
    </n-scrollbar>
  </div>
</template>

<script setup lang="ts">
import ListeningStatsPanel from '@/components/stats/ListeningStatsPanel.vue';

defineOptions({
  name: 'ListeningStats'
});
</script>
