<template>
  <span
    v-if="visible"
    class="track-origin-tag"
    :class="[`origin-${resolvedOrigin}`, `size-${size}`]"
  >
    {{ label }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import {
  type TrackOriginType,
  useOfflineAvailabilityStore
} from '@/store/modules/offlineAvailability';

const props = withDefaults(
  defineProps<{
    origin?: TrackOriginType;
    song?: { id?: string | number; playMusicUrl?: string; isDownloadedTrack?: boolean } | null;
    showOnline?: boolean;
    size?: 'xs' | 'sm';
  }>(),
  {
    origin: undefined,
    song: null,
    showOnline: true,
    size: 'xs'
  }
);

const offlineStore = useOfflineAvailabilityStore();
offlineStore.ensureInitialized();

const resolvedOrigin = computed<TrackOriginType>(() => {
  if (props.origin) return props.origin;
  return offlineStore.getTrackOrigin(props.song);
});

const visible = computed(() => resolvedOrigin.value !== 'online' || props.showOnline);

const label = computed(() => {
  switch (resolvedOrigin.value) {
    case 'local':
      return '本地';
    case 'downloaded':
      return '已下载';
    case 'cached':
      return '已缓存';
    default:
      return '在线';
  }
});
</script>

<style lang="scss" scoped>
.track-origin-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 5px;
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: 0.01em;
  white-space: nowrap;
  user-select: none;

  &.size-xs {
    padding: 1.5px 5px;
    font-size: 10px;
  }

  &.size-sm {
    padding: 2px 6px;
    font-size: 10.5px;
  }

  &.origin-local {
    background: rgba(245, 158, 11, 0.12);
    color: #b45309;
    border: 1px solid rgba(245, 158, 11, 0.24);
  }

  &.origin-downloaded {
    background: rgba(16, 185, 129, 0.12);
    color: #047857;
    border: 1px solid rgba(16, 185, 129, 0.24);
  }

  &.origin-cached {
    background: rgba(14, 165, 233, 0.12);
    color: #0369a1;
    border: 1px solid rgba(14, 165, 233, 0.24);
  }

  &.origin-online {
    background: rgba(100, 116, 139, 0.1);
    color: #64748b;
    border: 1px solid rgba(148, 163, 184, 0.22);
  }
}

html.dark .track-origin-tag {
  &.origin-local {
    background: rgba(255, 197, 51, 0.14);
    color: #ffd35c;
    border-color: rgba(255, 197, 51, 0.26);
  }

  &.origin-downloaded {
    background: rgba(16, 185, 129, 0.15);
    color: #6ee7b7;
    border-color: rgba(16, 185, 129, 0.28);
  }

  &.origin-cached {
    background: rgba(56, 189, 248, 0.14);
    color: #7dd3fc;
    border-color: rgba(56, 189, 248, 0.26);
  }

  &.origin-online {
    background: rgba(255, 255, 255, 0.06);
    color: #a1a1aa;
    border-color: rgba(255, 255, 255, 0.1);
  }
}
</style>
