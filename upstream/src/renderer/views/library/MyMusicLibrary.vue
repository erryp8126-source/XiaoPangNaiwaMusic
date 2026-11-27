<template>
  <div class="my-library-page h-full w-full flex flex-col bg-transparent overflow-hidden">
    <!-- 顶部标题、账号入口与总存储占用卡片 -->
    <div class="flex-shrink-0 page-padding pt-3 pb-2 space-y-3">
      <div
        class="rounded-[22px] p-4 bg-white/88 dark:bg-[#131316]/95 backdrop-blur-xl border border-sky-100/80 dark:border-white/[0.08] shadow-[0_6px_22px_rgba(82,134,168,0.08)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <h1 class="text-lg md:text-xl font-extrabold text-slate-900 dark:text-[#FAFAFA] tracking-tight">
                我的音乐
              </h1>
              <span
                v-if="invalidFileCount > 0"
                class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-600 dark:text-rose-300"
              >
                {{ invalidFileCount }} 项失效
              </span>
            </div>
            <div class="mt-1 flex items-center gap-2 flex-wrap text-xs text-slate-500 dark:text-[#A1A1AA]">
              <span>
                总存储占用
                <b class="text-slate-800 dark:text-[#FAFAFA] font-extrabold">{{ totalStorageText }}</b>
              </span>
              <span class="opacity-40">·</span>
              <span>已下载 {{ formatBytes(downloadedTotalBytes) }}</span>
              <span class="opacity-40">·</span>
              <span>手机本地 {{ formatBytes(localTotalBytes) }}</span>
              <template v-if="nativeCapabilities.supportsAudioCache">
                <span class="opacity-40">·</span>
                <span>缓存 {{ formatBytes(audioCacheBytes) }}</span>
              </template>
            </div>
          </div>

          <!-- 账号快捷入口 + 当前分页主操作 -->
          <div class="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              class="account-entry-pill px-2.5 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 active:scale-95 transition-all bg-slate-100/90 text-slate-700 hover:bg-slate-200/80 dark:bg-[#1C1C22] dark:text-[#FAFAFA] dark:border dark:border-white/[0.08]"
              @click="goToUserAccount"
            >
              <img
                v-if="userStore.user?.avatarUrl"
                :src="getImgUrl(userStore.user.avatarUrl, '50y50')"
                alt=""
                class="w-4 h-4 rounded-full object-cover"
              />
              <i v-else class="ri-user-smile-line text-sm text-amber-500 dark:text-[#FFC533]"></i>
              <span class="max-w-[72px] truncate">{{ userStore.user?.nickname || '账号' }}</span>
            </button>

            <button
              v-if="primaryActionLabel"
              type="button"
              class="px-3.5 py-2 rounded-full text-xs font-extrabold text-white shadow-md active:scale-95 transition-all flex items-center gap-1.5 flex-shrink-0"
              style="background: linear-gradient(135deg, #ffc21c 0%, #eb8f00 100%)"
              @click="handlePrimaryAction"
            >
              <i :class="primaryActionIcon" class="text-sm"></i>
              <span>{{ primaryActionLabel }}</span>
            </button>
          </div>
        </div>

        <!-- 6 分类统一标签栏：收藏 · 已下载 · 手机音乐 · 已缓存 · 最近播放 · 歌单 -->
        <div class="mt-3 flex items-center gap-1.5 overflow-x-auto scrollbar-hide pb-0.5">
          <button
            v-for="tab in libraryTabs"
            :key="tab.id"
            type="button"
            class="px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all active:scale-95 flex items-center gap-1"
            :class="
              activeTab === tab.id
                ? 'bg-slate-900 text-white dark:bg-[#FFC533] dark:text-[#1E1404] shadow-sm'
                : 'bg-slate-100/90 text-slate-600 dark:bg-[#1C1C22] dark:text-[#A1A1AA] hover:bg-slate-200/70 dark:hover:bg-[#27272F]'
            "
            @click="switchTab(tab.id)"
          >
            <span>{{ tab.label }}</span>
            <span class="text-[10px] opacity-75 tabular-nums">{{ tab.count }}</span>
          </button>
        </div>
      </div>

      <!-- 批量管理条（仅在已下载 / 手机音乐 / 已缓存标签显示） -->
      <div
        v-if="canBatchDeleteCurrentTab"
        class="flex items-center justify-between gap-2 px-1"
      >
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="px-3 py-1 rounded-full text-xs font-bold transition-colors border"
            :class="
              batchMode
                ? 'bg-amber-500/15 border-amber-400/50 text-amber-700 dark:text-[#FFC533]'
                : 'bg-white/80 dark:bg-[#1C1C22] border-slate-200/80 dark:border-white/[0.08] text-slate-600 dark:text-[#A1A1AA]'
            "
            @click="toggleBatchMode"
          >
            <i class="ri-checkbox-multiple-line mr-1"></i>
            {{ batchMode ? '完成管理' : '批量删除' }}
          </button>

          <button
            v-if="batchMode && currentSelectableKeys.length > 0"
            type="button"
            class="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 dark:bg-[#1C1C22] text-slate-600 dark:text-[#A1A1AA]"
            @click="toggleSelectAll"
          >
            {{ isAllSelected ? '取消全选' : '全选' }}
          </button>

          <button
            v-if="!batchMode && activeTab === 'local'"
            type="button"
            class="px-2.5 py-1 rounded-full text-xs font-semibold bg-white/80 dark:bg-[#1C1C22] border border-slate-200/80 dark:border-white/[0.08] text-slate-600 dark:text-[#A1A1AA]"
            :disabled="localMusicStore.scanning"
            @click="handleImportOrScanLocal"
          >
            <i
              class="mr-1"
              :class="localMusicStore.scanning ? 'ri-loader-4-line animate-spin' : 'ri-folder-add-line'"
            ></i>
            {{ localMusicStore.scanning ? '扫描中...' : '导入/扫描' }}
          </button>

          <button
            v-if="!batchMode && activeTab === 'cached' && nativeCapabilities.supportsAudioCache && audioCacheBytes > 0"
            type="button"
            class="px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 dark:bg-rose-500/15 text-rose-600 dark:text-rose-300"
            @click="handleClearAllAudioCache"
          >
            <i class="ri-delete-bin-line mr-1"></i>一键清空缓存
          </button>
        </div>

        <button
          v-if="batchMode && selectedKeys.size > 0"
          type="button"
          class="px-3.5 py-1.5 rounded-full text-xs font-extrabold bg-rose-500 hover:bg-rose-600 text-white shadow-sm active:scale-95 transition-all"
          @click="confirmBatchDelete"
        >
          删除所选 ({{ selectedKeys.size }})
        </button>
      </div>
    </div>

    <!-- 内容区 -->
    <div class="flex-1 min-h-0 overflow-hidden page-padding pb-32">
      <!-- Tab 1: 收藏（复用现有 Favorite 视图并统一来源徽标，永不受批量删文件影响） -->
      <div
        v-if="activeTab === 'favorite'"
        class="h-full rounded-[24px] overflow-hidden bg-white/80 dark:bg-[#131316] border border-sky-100/70 dark:border-white/[0.08]"
      >
        <favorite-view class="h-full" show-origin />
      </div>

      <!-- Tab 2: 已下载 -->
      <n-scrollbar v-else-if="activeTab === 'downloaded'" class="h-full">
        <div v-if="loadingDownloaded" class="py-16 flex justify-center">
          <n-spin size="medium" />
        </div>
        <div v-else-if="downloadedItems.length === 0" class="py-16 text-center space-y-2">
          <i class="ri-download-cloud-2-line text-4xl text-slate-300 dark:text-[#71717A]"></i>
          <p class="text-sm text-slate-500 dark:text-[#A1A1AA]">暂无已下载歌曲</p>
          <p class="text-xs text-slate-400 dark:text-[#71717A]">在播放页或歌单菜单中点击下载，即可离线随心畅听</p>
        </div>
        <div v-else class="space-y-2 pb-16">
          <div
            v-for="item in downloadedItems"
            :key="item.key"
            class="flex items-center gap-3 p-3 rounded-2xl bg-white/85 dark:bg-[#131316] border border-slate-200/70 dark:border-white/[0.08] hover:bg-white dark:hover:bg-[#1C1C22] transition-all cursor-pointer"
            @click="batchMode ? toggleSelect(item.key) : playDownloadedItem(item)"
          >
            <div
              v-if="batchMode"
              class="w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors"
              :class="
                selectedKeys.has(item.key)
                  ? 'bg-amber-500 border-amber-500 text-white'
                  : 'border-slate-300 dark:border-zinc-600'
              "
            >
              <i v-if="selectedKeys.has(item.key)" class="ri-check-line text-xs"></i>
            </div>
            <div class="w-11 h-11 rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-300 flex items-center justify-center flex-shrink-0 overflow-hidden">
              <img v-if="item.picUrl" :src="getImgUrl(item.picUrl, '100y100')" class="w-full h-full object-cover" />
              <i v-else class="ri-music-2-fill text-lg"></i>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="text-sm font-bold text-slate-900 dark:text-[#FAFAFA] truncate">
                  {{ item.name }}
                </span>
                <track-origin-tag origin="downloaded" />
                <span
                  class="px-1.5 py-0.5 rounded text-[10px] font-bold flex-shrink-0 bg-amber-500/15 text-amber-700 dark:text-[#FFC533]"
                >
                  {{ item.qualityLabel }}
                </span>
                <span
                  v-if="item.isInvalid"
                  class="px-1.5 py-0.5 rounded text-[10px] font-bold flex-shrink-0 bg-rose-500/15 text-rose-600 dark:text-rose-300"
                >
                  文件已失效
                </span>
              </div>
              <div class="text-xs text-slate-500 dark:text-[#A1A1AA] truncate mt-0.5">
                {{ item.artist }} · {{ formatBytes(item.size) }}
              </div>
            </div>
            <i v-if="!batchMode" class="ri-play-circle-line text-xl text-amber-500 dark:text-[#FFC533] flex-shrink-0"></i>
          </div>
        </div>
      </n-scrollbar>

      <!-- Tab 3: 手机音乐（本地扫描） -->
      <n-scrollbar v-else-if="activeTab === 'local'" class="h-full">
        <div v-if="localItems.length === 0" class="py-16 text-center space-y-3">
          <i class="ri-folder-music-line text-4xl text-slate-300 dark:text-[#71717A]"></i>
          <p class="text-sm text-slate-500 dark:text-[#A1A1AA]">还没有导入手机音乐</p>
          <button
            type="button"
            class="px-5 py-2 rounded-full text-xs font-extrabold text-white shadow-md"
            style="background: linear-gradient(135deg, #ffc21c 0%, #eb8f00 100%)"
            @click="handleImportOrScanLocal"
          >
            <i class="ri-folder-add-line mr-1"></i>扫描 / 导入本地音乐
          </button>
        </div>
        <div v-else class="space-y-2 pb-16">
          <div
            v-for="item in localItems"
            :key="item.key"
            class="flex items-center gap-3 p-3 rounded-2xl bg-white/85 dark:bg-[#131316] border border-slate-200/70 dark:border-white/[0.08] hover:bg-white dark:hover:bg-[#1C1C22] transition-all cursor-pointer"
            @click="batchMode ? toggleSelect(item.key) : playLocalItem(item)"
          >
            <div
              v-if="batchMode"
              class="w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors"
              :class="
                selectedKeys.has(item.key)
                  ? 'bg-amber-500 border-amber-500 text-white'
                  : 'border-slate-300 dark:border-zinc-600'
              "
            >
              <i v-if="selectedKeys.has(item.key)" class="ri-check-line text-xs"></i>
            </div>
            <div class="w-11 h-11 rounded-xl bg-amber-500/10 text-amber-600 dark:text-[#FFC533] flex items-center justify-center flex-shrink-0 overflow-hidden">
              <img v-if="item.picUrl" :src="item.picUrl" class="w-full h-full object-cover" />
              <i v-else class="ri-disc-line text-lg"></i>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="text-sm font-bold text-slate-900 dark:text-[#FAFAFA] truncate">
                  {{ item.name }}
                </span>
                <track-origin-tag origin="local" />
                <span
                  class="px-1.5 py-0.5 rounded text-[10px] font-bold flex-shrink-0 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                >
                  {{ item.qualityLabel }}
                </span>
                <span
                  v-if="item.isInvalid"
                  class="px-1.5 py-0.5 rounded text-[10px] font-bold flex-shrink-0 bg-rose-500/15 text-rose-600 dark:text-rose-300"
                >
                  文件已失效
                </span>
              </div>
              <div class="text-xs text-slate-500 dark:text-[#A1A1AA] truncate mt-0.5">
                {{ item.artist }} · {{ formatBytes(item.size) }}
              </div>
            </div>
            <i v-if="!batchMode" class="ri-play-circle-line text-xl text-amber-500 dark:text-[#FFC533] flex-shrink-0"></i>
          </div>
        </div>
      </n-scrollbar>

      <!-- Tab 4: 已缓存 -->
      <n-scrollbar v-else-if="activeTab === 'cached'" class="h-full">
        <div v-if="cachedItems.length === 0" class="py-16 text-center space-y-2">
          <i class="ri-hard-drive-2-line text-4xl text-slate-300 dark:text-[#71717A]"></i>
          <p class="text-sm text-slate-500 dark:text-[#A1A1AA]">暂无边听边缓存记录</p>
          <p class="text-xs text-slate-400 dark:text-[#71717A]">
            {{
              nativeCapabilities.supportsAudioCache
                ? '听过的在线歌曲会自动缓存在本机，二次播放秒开且省流量'
                : '当前平台暂未开启磁盘音频缓存，可使用「已下载」与「手机音乐」实现离线畅听'
            }}
          </p>
        </div>
        <div v-else class="space-y-2 pb-16">
          <div
            v-for="item in cachedItems"
            :key="item.key"
            class="flex items-center gap-3 p-3 rounded-2xl bg-white/85 dark:bg-[#131316] border border-slate-200/70 dark:border-white/[0.08] hover:bg-white dark:hover:bg-[#1C1C22] transition-all cursor-pointer"
            @click="batchMode ? toggleSelect(item.key) : playCachedItem(item)"
          >
            <div
              v-if="batchMode"
              class="w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors"
              :class="
                selectedKeys.has(item.key)
                  ? 'bg-amber-500 border-amber-500 text-white'
                  : 'border-slate-300 dark:border-zinc-600'
              "
            >
              <i v-if="selectedKeys.has(item.key)" class="ri-check-line text-xs"></i>
            </div>
            <div class="w-11 h-11 rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-300 flex items-center justify-center flex-shrink-0 overflow-hidden">
              <img v-if="item.picUrl" :src="getImgUrl(item.picUrl, '100y100')" class="w-full h-full object-cover" />
              <i v-else class="ri-flashlight-fill text-lg"></i>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="text-sm font-bold text-slate-900 dark:text-[#FAFAFA] truncate">
                  {{ item.name }}
                </span>
                <track-origin-tag origin="cached" />
                <span class="px-1.5 py-0.5 rounded text-[10px] font-bold flex-shrink-0 bg-sky-500/15 text-sky-700 dark:text-sky-300">
                  {{ item.qualityLabel }}
                </span>
              </div>
              <div class="text-xs text-slate-500 dark:text-[#A1A1AA] truncate mt-0.5">
                {{ item.artist }}
              </div>
            </div>
            <i v-if="!batchMode" class="ri-play-circle-line text-xl text-sky-500 flex-shrink-0"></i>
          </div>
        </div>
      </n-scrollbar>

      <!-- Tab 5: 最近播放 -->
      <n-scrollbar v-else-if="activeTab === 'recent'" class="h-full">
        <div v-if="recentItems.length === 0" class="py-16 text-center space-y-2">
          <i class="ri-history-line text-4xl text-slate-300 dark:text-[#71717A]"></i>
          <p class="text-sm text-slate-500 dark:text-[#A1A1AA]">暂无最近播放记录</p>
        </div>
        <div v-else class="space-y-2 pb-16">
          <div
            v-for="song in recentItems"
            :key="song.id"
            class="recent-track-row flex items-center gap-3 p-3 rounded-2xl bg-white/85 dark:bg-[#131316] border border-slate-200/70 dark:border-white/[0.08] hover:bg-white dark:hover:bg-[#1C1C22] transition-all cursor-pointer"
            :class="{ 'is-offline-unavailable': offlineStore.isTrackUnavailableOffline(song) }"
            @click="playRecentSong(song)"
          >
            <div class="w-11 h-11 rounded-xl overflow-hidden bg-slate-100 dark:bg-[#1C1C22] flex-shrink-0">
              <img v-if="song.picUrl || song.al?.picUrl" :src="getImgUrl(song.picUrl || song.al?.picUrl, '100y100')" class="w-full h-full object-cover" />
              <div v-else class="w-full h-full flex items-center justify-center text-slate-400">
                <i class="ri-music-line"></i>
              </div>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="text-sm font-bold text-slate-900 dark:text-[#FAFAFA] truncate">
                  {{ song.name }}
                </span>
                <track-origin-tag :song="song" show-online />
              </div>
              <div class="text-xs text-slate-500 dark:text-[#A1A1AA] truncate mt-0.5">
                {{ formatArtists(song) }} · 听过 {{ song.count || 1 }} 次
              </div>
            </div>
            <i class="ri-play-circle-line text-xl text-amber-500 dark:text-[#FFC533] flex-shrink-0"></i>
          </div>
        </div>
      </n-scrollbar>

      <!-- Tab 6: 歌单（本地自建歌单 + 云端创建/收藏歌单） -->
      <n-scrollbar v-else class="h-full">
        <div v-if="loadingPlaylists" class="py-16 flex justify-center">
          <n-spin size="medium" />
        </div>
        <div v-else-if="customPlaylists.length === 0 && cloudPlaylists.length === 0" class="py-16 text-center space-y-3">
          <i class="ri-play-list-2-line text-4xl text-slate-300 dark:text-[#71717A]"></i>
          <p class="text-sm text-slate-500 dark:text-[#A1A1AA]">暂无自建或收藏歌单</p>
          <p class="text-xs text-slate-400 dark:text-[#71717A]">
            可在播放队列点击「存为歌单」保存到本地，或登录账号同步网易云歌单
          </p>
          <button
            v-if="!userStore.user"
            type="button"
            class="px-5 py-2 rounded-full text-xs font-extrabold text-white shadow-md"
            style="background: linear-gradient(135deg, #ffc21c 0%, #eb8f00 100%)"
            @click="goToUserAccount"
          >
            登录同步网易云歌单
          </button>
        </div>
        <div v-else class="space-y-4 pb-16">
          <!-- 本地自建歌单 -->
          <div v-if="customPlaylists.length > 0" class="space-y-2">
            <div class="px-1 text-xs font-bold text-slate-500 dark:text-[#A1A1AA] flex items-center justify-between">
              <span>本地自建歌单</span>
              <span>{{ customPlaylists.length }} 个</span>
            </div>
            <div
              v-for="pl in customPlaylists"
              :key="pl.id"
              class="flex items-center gap-3 p-3 rounded-2xl bg-white/85 dark:bg-[#131316] border border-slate-200/70 dark:border-white/[0.08] hover:bg-white dark:hover:bg-[#1C1C22] transition-all cursor-pointer"
              @click="openCustomPlaylist(pl)"
            >
              <div class="w-12 h-12 rounded-xl overflow-hidden bg-amber-500/10 text-amber-500 dark:text-[#FFC533] flex items-center justify-center flex-shrink-0">
                <img
                  v-if="pl.tracks?.[0]?.picUrl || pl.tracks?.[0]?.al?.picUrl"
                  :src="getImgUrl(pl.tracks[0].picUrl || pl.tracks[0].al?.picUrl, '100y100')"
                  class="w-full h-full object-cover"
                />
                <i v-else class="ri-play-list-2-fill text-xl"></i>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5 min-w-0">
                  <span class="text-sm font-bold text-slate-900 dark:text-[#FAFAFA] truncate">
                    {{ pl.name }}
                  </span>
                  <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/12 text-amber-700 dark:text-[#FFC533] border border-amber-500/20 flex-shrink-0">
                    自建
                  </span>
                </div>
                <div class="text-xs text-slate-500 dark:text-[#A1A1AA] mt-0.5">
                  {{ pl.tracks?.length || 0 }} 首歌曲
                </div>
              </div>
              <i class="ri-arrow-right-s-line text-lg text-slate-400 dark:text-[#71717A] flex-shrink-0"></i>
            </div>
          </div>

          <!-- 网易云创建与收藏歌单 -->
          <div v-if="cloudPlaylists.length > 0" class="space-y-2">
            <div class="px-1 text-xs font-bold text-slate-500 dark:text-[#A1A1AA] flex items-center justify-between">
              <span>云端创建与收藏歌单</span>
              <span>{{ cloudPlaylists.length }} 个</span>
            </div>
            <div
              v-for="item in cloudPlaylists"
              :key="item.id"
              class="flex items-center gap-3 p-3 rounded-2xl bg-white/85 dark:bg-[#131316] border border-slate-200/70 dark:border-white/[0.08] hover:bg-white dark:hover:bg-[#1C1C22] transition-all cursor-pointer"
              @click="openCloudPlaylist(item)"
            >
              <div class="w-12 h-12 rounded-xl overflow-hidden bg-slate-100 dark:bg-[#1C1C22] flex items-center justify-center flex-shrink-0">
                <img
                  v-if="item.coverImgUrl || item.picUrl"
                  :src="getImgUrl(item.coverImgUrl || item.picUrl, '100y100')"
                  class="w-full h-full object-cover"
                />
                <i v-else class="ri-disc-line text-xl text-slate-400"></i>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5 min-w-0">
                  <span class="text-sm font-bold text-slate-900 dark:text-[#FAFAFA] truncate">
                    {{ item.name }}
                  </span>
                  <span
                    v-if="userStore.user && item.creator?.userId === userStore.user.userId"
                    class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-500/12 text-sky-700 dark:text-sky-300 border border-sky-500/20 flex-shrink-0"
                  >
                    创建
                  </span>
                </div>
                <div class="text-xs text-slate-500 dark:text-[#A1A1AA] truncate mt-0.5">
                  {{ item.trackCount || 0 }} 首 · {{ item.creator?.nickname || '网易云歌单' }}
                </div>
              </div>
              <i class="ri-arrow-right-s-line text-lg text-slate-400 dark:text-[#71717A] flex-shrink-0"></i>
            </div>
          </div>
        </div>
      </n-scrollbar>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useDialog, useMessage } from 'naive-ui';
import { computed, onActivated, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { getUserPlaylist } from '@/api/user';
import { navigateToMusicList } from '@/components/common/MusicListNavigator';
import TrackOriginTag from '@/components/common/TrackOriginTag.vue';
import { useFavoriteStore } from '@/store/modules/favorite';
import { useLocalMusicStore } from '@/store/modules/localMusic';
import { useOfflineAvailabilityStore } from '@/store/modules/offlineAvailability';
import { usePlayerStore } from '@/store/modules/player';
import { usePlayHistoryStore } from '@/store/modules/playHistory';
import { useUserStore } from '@/store/modules/user';
import type { SongResult } from '@/types/music';
import { getImgUrl } from '@/utils';
import { getNativeCapabilities, getNativeIpc, isAndroid, triggerHaptic } from '@/utils/androidBridge';
import { inferPlaybackMetaFromUrl } from '@/utils/playbackMeta';
import FavoriteView from '@/views/favorite/index.vue';

defineOptions({
  name: 'Library'
});

type LibraryTab = 'favorite' | 'downloaded' | 'local' | 'cached' | 'recent' | 'playlists';

interface CustomPlaylistEntry {
  id: string;
  name: string;
  updatedAt?: number;
  tracks: SongResult[];
}

interface LibraryFileRow {
  key: string;
  id: string | number;
  name: string;
  artist: string;
  picUrl: string;
  size: number;
  filePath: string;
  qualityLabel: string;
  isInvalid: boolean;
  rawSong: SongResult;
}

const CUSTOM_PLAYLISTS_STORAGE_KEY = 'xiaopang_custom_playlists_v1';

const route = useRoute();
const router = useRouter();
const message = useMessage();
const dialog = useDialog();
const playerStore = usePlayerStore();
const offlineStore = useOfflineAvailabilityStore();
const localMusicStore = useLocalMusicStore();
const playHistoryStore = usePlayHistoryStore();
const favoriteStore = useFavoriteStore();
const userStore = useUserStore();
const nativeCapabilities = getNativeCapabilities();

const activeTab = ref<LibraryTab>(offlineStore.isOffline ? 'downloaded' : 'favorite');
const batchMode = ref(false);
const selectedKeys = ref<Set<string>>(new Set());
const loadingDownloaded = ref(false);
const loadingPlaylists = ref(false);
const rawDownloadedList = ref<any[]>([]);
const customPlaylists = ref<CustomPlaylistEntry[]>([]);
const invalidPathSet = ref<Set<string>>(new Set());
const audioCacheBytes = ref<number>(0);

const formatBytes = (bytes: number): string => {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const formatArtists = (song: any): string => {
  const list = song?.ar || song?.artists || song?.song?.artists || [];
  if (Array.isArray(list) && list.length > 0) {
    return list.map((a: any) => a?.name).filter(Boolean).join(' / ');
  }
  return song?.artist || '未知歌手';
};

const inferQualityTag = (pathOrUrl?: string, existing?: any): string => {
  const meta = inferPlaybackMetaFromUrl(pathOrUrl, { existing });
  return meta.qualityLabel || '标准';
};

const refreshAudioCacheSize = () => {
  if (nativeCapabilities.supportsAudioCache) {
    audioCacheBytes.value = Number((window as any).AlgerAndroid?.getAudioCacheSize?.() || 0);
  } else {
    audioCacheBytes.value = 0;
  }
};

const loadCustomPlaylists = () => {
  try {
    const raw = localStorage.getItem(CUSTOM_PLAYLISTS_STORAGE_KEY);
    if (!raw) {
      customPlaylists.value = [];
      return;
    }
    const parsed = JSON.parse(raw);
    customPlaylists.value = Array.isArray(parsed)
      ? parsed.filter((item) => item && typeof item.name === 'string')
      : [];
  } catch {
    customPlaylists.value = [];
  }
};

const ensureCloudPlaylistsLoaded = async () => {
  if (offlineStore.isOffline || !userStore.user?.userId || userStore.playList.length > 0) {
    return;
  }
  loadingPlaylists.value = true;
  try {
    const res = await getUserPlaylist(userStore.user.userId);
    if (Array.isArray(res?.data?.playlist)) {
      userStore.playList = res.data.playlist;
    }
  } catch {
    // 离线安静模式：拉取失败不打扰用户
  } finally {
    loadingPlaylists.value = false;
  }
};

const verifyFileExistence = async (paths: string[]) => {
  const ipc = getNativeIpc();
  if (!ipc || paths.length === 0) return;
  const nextInvalid = new Set(invalidPathSet.value);
  for (const p of paths.slice(0, 80)) {
    if (!p) continue;
    try {
      const exists = await ipc.invoke('check-file-exists', p);
      if (exists === false) nextInvalid.add(p);
      else nextInvalid.delete(p);
    } catch {
      // ignore check failure
    }
  }
  invalidPathSet.value = nextInvalid;
};

const loadDownloadedFiles = async () => {
  const ipc = getNativeIpc();
  if (!ipc) {
    rawDownloadedList.value = [];
    return;
  }
  loadingDownloaded.value = true;
  try {
    const res = await ipc.invoke('get-downloaded-music');
    const list = Array.isArray(res) ? res : [];
    rawDownloadedList.value = list;
    void verifyFileExistence(list.map((i: any) => String(i?.path || i?.filePath || '')).filter(Boolean));
  } catch {
    rawDownloadedList.value = [];
  } finally {
    loadingDownloaded.value = false;
  }
};

const downloadedItems = computed<LibraryFileRow[]>(() =>
  rawDownloadedList.value.map((item: any, idx: number) => {
    const filePath = String(item.path || item.filePath || '');
    const playUrl = item.playMusicUrl || (filePath ? `local:///${encodeURIComponent(filePath)}` : '');
    const name = item.displayName || item.name || item.filename || `已下载歌曲 ${idx + 1}`;
    const size = Number(item.size) || 0;
    const isInvalid = !filePath || size <= 0 || invalidPathSet.value.has(filePath);
    const rawSong: SongResult = {
      id: item.id || `dl_${idx}_${name}`,
      name,
      picUrl: item.picUrl || '',
      ar: item.ar || [{ id: 0, name: item.artist || '已下载音乐' }],
      al: item.al || { id: 0, name: item.album || '已下载', picUrl: item.picUrl || '' },
      dt: Number(item.duration || item.dt || 0),
      count: 0,
      playMusicUrl: playUrl,
      isDownloadedTrack: true,
      source: 'netease'
    };
    return {
      key: `dl:${filePath || rawSong.id}`,
      id: rawSong.id,
      name,
      artist: formatArtists(rawSong),
      picUrl: rawSong.picUrl || '',
      size,
      filePath,
      qualityLabel: inferQualityTag(filePath || playUrl),
      isInvalid,
      rawSong
    };
  })
);

const localItems = computed<LibraryFileRow[]>(() =>
  localMusicStore.musicList.map((entry) => {
    const filePath = entry.filePath || '';
    const size = Number(entry.fileSize) || 0;
    const isInvalid = !filePath || invalidPathSet.value.has(filePath);
    const playUrl = `local:///${encodeURIComponent(filePath)}`;
    const rawSong: SongResult = {
      id: entry.id,
      name: entry.title || '未知歌曲',
      picUrl: entry.cover || '',
      ar: [{ id: 0, name: entry.artist || '本地歌手' }] as any,
      al: { id: 0, name: entry.album || '本地音乐', picUrl: entry.cover || '' } as any,
      dt: entry.duration || 0,
      count: 0,
      playMusicUrl: playUrl,
      source: 'netease'
    };
    return {
      key: `local:${entry.id}`,
      id: entry.id,
      name: entry.title || '未知歌曲',
      artist: entry.artist || '本地歌手',
      picUrl: entry.cover || '',
      size,
      filePath,
      qualityLabel: inferQualityTag(filePath),
      isInvalid,
      rawSong
    };
  })
);

const cachedItems = computed<LibraryFileRow[]>(() => {
  const historyMap = new Map<string, SongResult>();
  for (const s of playHistoryStore.musicHistory || []) {
    if (s?.id !== undefined && s?.id !== null) historyMap.set(String(s.id), s);
  }
  for (const s of playerStore.playList || []) {
    if (s?.id !== undefined && s?.id !== null && !historyMap.has(String(s.id))) {
      historyMap.set(String(s.id), s);
    }
  }
  const rows: LibraryFileRow[] = [];
  for (const cachedId of offlineStore.cachedIds) {
    const matched = historyMap.get(String(cachedId));
    if (matched) {
      rows.push({
        key: `cache:${cachedId}`,
        id: matched.id,
        name: matched.name || `缓存曲目 #${cachedId}`,
        artist: formatArtists(matched),
        picUrl: matched.picUrl || matched.al?.picUrl || '',
        size: 0,
        filePath: '',
        qualityLabel: inferQualityTag(matched.playMusicUrl, matched.playbackMeta),
        isInvalid: false,
        rawSong: matched
      });
    }
  }
  return rows;
});

const recentItems = computed(() => playHistoryStore.musicHistory || []);
const cloudPlaylists = computed(() => userStore.playList || []);

const downloadedTotalBytes = computed(() =>
  downloadedItems.value.reduce((acc, i) => acc + (i.size || 0), 0)
);
const localTotalBytes = computed(() =>
  localItems.value.reduce((acc, i) => acc + (i.size || 0), 0)
);
const totalStorageText = computed(() =>
  formatBytes(downloadedTotalBytes.value + localTotalBytes.value + audioCacheBytes.value)
);
const invalidFileCount = computed(
  () =>
    downloadedItems.value.filter((i) => i.isInvalid).length +
    localItems.value.filter((i) => i.isInvalid).length
);

const libraryTabs = computed<Array<{ id: LibraryTab; label: string; count: number }>>(() => [
  { id: 'favorite', label: '收藏', count: favoriteStore.favoriteList.length },
  { id: 'downloaded', label: '已下载', count: downloadedItems.value.length },
  { id: 'local', label: '手机音乐', count: localItems.value.length },
  { id: 'cached', label: '已缓存', count: cachedItems.value.length },
  { id: 'recent', label: '最近播放', count: recentItems.value.length },
  {
    id: 'playlists',
    label: '歌单',
    count: customPlaylists.value.length + cloudPlaylists.value.length
  }
]);

const canBatchDeleteCurrentTab = computed(
  () => activeTab.value === 'downloaded' || activeTab.value === 'local' || activeTab.value === 'cached'
);

const currentSelectableKeys = computed<string[]>(() => {
  if (activeTab.value === 'downloaded') return downloadedItems.value.map((i) => i.key);
  if (activeTab.value === 'local') return localItems.value.map((i) => i.key);
  if (activeTab.value === 'cached') return cachedItems.value.map((i) => i.key);
  return [];
});

const isAllSelected = computed(
  () =>
    currentSelectableKeys.value.length > 0 &&
    currentSelectableKeys.value.every((k) => selectedKeys.value.has(k))
);

const primaryActionLabel = computed(() => {
  if (activeTab.value === 'downloaded' && downloadedItems.value.length > 0) return '播放全部';
  if (activeTab.value === 'local') return localItems.value.length > 0 ? '播放全部' : '导入本地';
  if (activeTab.value === 'cached' && cachedItems.value.length > 0) return '播放全部';
  if (activeTab.value === 'recent' && recentItems.value.length > 0) return '播放全部';
  return '';
});

const primaryActionIcon = computed(() => {
  if (activeTab.value === 'local' && localItems.value.length === 0) return 'ri-folder-add-line';
  return 'ri-play-fill';
});

const goToUserAccount = () => {
  triggerHaptic('light');
  void router.push('/user');
};

const switchTab = (tab: LibraryTab) => {
  triggerHaptic('selection');
  activeTab.value = tab;
  batchMode.value = false;
  selectedKeys.value = new Set();
  if (tab === 'playlists') {
    loadCustomPlaylists();
    void ensureCloudPlaylistsLoaded();
  }
};

const toggleBatchMode = () => {
  triggerHaptic('light');
  batchMode.value = !batchMode.value;
  selectedKeys.value = new Set();
};

const toggleSelect = (key: string) => {
  const next = new Set(selectedKeys.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  selectedKeys.value = next;
};

const toggleSelectAll = () => {
  if (isAllSelected.value) {
    selectedKeys.value = new Set();
  } else {
    selectedKeys.value = new Set(currentSelectableKeys.value);
  }
};

const handlePrimaryAction = async () => {
  triggerHaptic('medium');
  if (activeTab.value === 'local' && localItems.value.length === 0) {
    await handleImportOrScanLocal();
    return;
  }
  const songs: SongResult[] =
    activeTab.value === 'downloaded'
      ? downloadedItems.value.filter((i) => !i.isInvalid).map((i) => i.rawSong)
      : activeTab.value === 'local'
        ? localItems.value.filter((i) => !i.isInvalid).map((i) => i.rawSong)
        : activeTab.value === 'cached'
          ? cachedItems.value.map((i) => i.rawSong)
          : recentItems.value;
  if (songs.length === 0) {
    message.info('当前分类下没有可播放的曲目');
    return;
  }
  playerStore.setPlayList(songs);
  await playerStore.setPlay(songs[0]);
};

const playDownloadedItem = async (item: LibraryFileRow) => {
  if (item.isInvalid) {
    message.warning('该音频文件已失效或被移除，建议勾选删除记录');
    return;
  }
  const valid = downloadedItems.value.filter((i) => !i.isInvalid).map((i) => i.rawSong);
  playerStore.setPlayList(valid);
  await playerStore.setPlay(item.rawSong);
};

const playLocalItem = async (item: LibraryFileRow) => {
  if (item.isInvalid) {
    message.warning('该本地音频文件已失效或被移动');
    return;
  }
  const valid = localItems.value.filter((i) => !i.isInvalid).map((i) => i.rawSong);
  playerStore.setPlayList(valid);
  await playerStore.setPlay(item.rawSong);
};

const playCachedItem = async (item: LibraryFileRow) => {
  playerStore.setPlayList(cachedItems.value.map((i) => i.rawSong));
  await playerStore.setPlay(item.rawSong);
};

const playRecentSong = async (song: SongResult) => {
  playerStore.setPlayList(recentItems.value);
  await playerStore.setPlay(song);
};

const openCustomPlaylist = (pl: CustomPlaylistEntry) => {
  triggerHaptic('light');
  navigateToMusicList(router, {
    id: pl.id,
    type: 'custom',
    name: pl.name,
    songList: pl.tracks || [],
    listInfo: {
      id: pl.id,
      name: pl.name,
      coverImgUrl: pl.tracks?.[0]?.picUrl || pl.tracks?.[0]?.al?.picUrl || '',
      description: '本地自建歌单'
    },
    canRemove: false
  });
};

const openCloudPlaylist = (item: any) => {
  triggerHaptic('light');
  navigateToMusicList(router, {
    id: item.id,
    type: 'playlist',
    name: item.name,
    listInfo: item,
    canRemove: item.creator?.userId === userStore.user?.userId
  });
};

const handleImportOrScanLocal = async () => {
  const ipc = getNativeIpc();
  if (!ipc) {
    message.info('网页版暂不支持直接扫描本地目录，请使用 Android / iOS / 桌面客户端');
    return;
  }
  try {
    if (isAndroid()) {
      const picked = await ipc.invoke('select-local-music-source');
      if (picked && typeof picked === 'string') {
        localMusicStore.addFolder(picked);
        await localMusicStore.scanFolders();
        await offlineStore.refresh();
        message.success('本地音乐扫描完成');
      } else if (picked && typeof picked === 'object' && picked.folder) {
        localMusicStore.addFolder(String(picked.folder));
        await localMusicStore.scanFolders();
        await offlineStore.refresh();
        message.success('本地音乐导入并扫描完成');
      } else {
        localMusicStore.addFolder('__ANDROID_MEDIASTORE__');
        await localMusicStore.scanFolders();
        await offlineStore.refresh();
        message.success('本地音乐扫描完成');
      }
    } else {
      const result = await ipc.invoke('select-directory');
      if (result && !result.canceled && result.filePaths?.length > 0) {
        localMusicStore.addFolder(result.filePaths[0]);
        await localMusicStore.scanFolders();
        await offlineStore.refresh();
        message.success('本地音乐扫描完成');
      }
    }
  } catch (err: any) {
    message.error(`扫描本地音乐失败：${err?.message || '请稍后重试'}`);
  }
};

const handleClearAllAudioCache = () => {
  dialog.warning({
    title: '清空音频缓存',
    content: '仅清理边听边缓存的临时文件，不会删除已下载音乐与「我喜欢」收藏记录。确定清空吗？',
    positiveText: '确认清空',
    negativeText: '取消',
    onPositiveClick: async () => {
      const ok = Boolean((window as any).AlgerAndroid?.clearAudioCache?.());
      refreshAudioCacheSize();
      await offlineStore.refresh();
      if (ok) message.success('已清空音频缓存');
      else message.error('缓存清理失败');
    }
  });
};

const confirmBatchDelete = () => {
  const count = selectedKeys.value.size;
  if (count === 0) return;

  dialog.warning({
    title: `批量删除 ${count} 项文件`,
    content:
      '仅删除所选的本地/下载/缓存文件记录，绝不会删除您的「我喜欢」收藏与云同步记录。是否继续？',
    positiveText: '确认删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      if (activeTab.value === 'downloaded') {
        const ipc = getNativeIpc();
        let removed = 0;
        for (const item of downloadedItems.value) {
          if (!selectedKeys.value.has(item.key)) continue;
          try {
            await ipc?.invoke('delete-downloaded-music', item.filePath);
            removed++;
          } catch {
            // continue deleting remaining items
          }
        }
        await loadDownloadedFiles();
        await offlineStore.refresh();
        message.success(`已删除 ${removed} 首下载文件（收藏记录已保留）`);
      } else if (activeTab.value === 'local') {
        const idsToRemove = localItems.value
          .filter((i) => selectedKeys.value.has(i.key))
          .map((i) => String(i.id));
        const removed = await localMusicStore.removeEntries(idsToRemove);
        await offlineStore.refresh();
        message.success(`已从本地库移除 ${removed} 首条目（收藏记录已保留）`);
      } else if (activeTab.value === 'cached') {
        if (nativeCapabilities.supportsAudioCache) {
          (window as any).AlgerAndroid?.clearAudioCache?.();
        }
        refreshAudioCacheSize();
        await offlineStore.refresh();
        message.success('已清理音频缓存（收藏记录已保留）');
      }
      selectedKeys.value = new Set();
      batchMode.value = false;
    }
  });
};

watch(
  () => route.query.tab,
  (tab) => {
    const val = String(tab || '') as LibraryTab;
    if (['favorite', 'downloaded', 'local', 'cached', 'recent', 'playlists'].includes(val)) {
      activeTab.value = val;
    }
  },
  { immediate: true }
);

const refreshLibraryData = async () => {
  offlineStore.ensureInitialized();
  refreshAudioCacheSize();
  loadCustomPlaylists();
  await Promise.all([loadDownloadedFiles(), localMusicStore.loadFromCache()]);
  void verifyFileExistence(localMusicStore.musicList.map((e) => e.filePath).filter(Boolean));
  if (activeTab.value === 'playlists') {
    void ensureCloudPlaylistsLoaded();
  }
};

onMounted(async () => {
  await refreshLibraryData();
  if (!route.query.tab && offlineStore.isOffline) {
    if (downloadedItems.value.length === 0 && localItems.value.length > 0) {
      activeTab.value = 'local';
    } else {
      activeTab.value = 'downloaded';
    }
  }
  if (route.query.autoScan === '1') {
    activeTab.value = 'local';
    await handleImportOrScanLocal();
  }
});

onActivated(() => {
  void refreshLibraryData();
});
</script>

<style lang="scss" scoped>
.recent-track-row.is-offline-unavailable {
  opacity: 0.46;

  img {
    filter: grayscale(0.35);
  }
}
</style>
