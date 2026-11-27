<template>
  <div class="space-y-4">
    <!-- ==================== 1. 主推小白入口：一键专属同步口令 ==================== -->
    <div
      v-if="showCommonSections"
      class="relative overflow-hidden rounded-[22px] p-5 bg-gradient-to-br from-sky-500 via-blue-600 to-indigo-600 text-white shadow-lg shadow-sky-600/20"
    >
      <div class="relative z-10 flex flex-col gap-4">
        <!-- 标题与状态 -->
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="flex items-center gap-2">
              <i class="ri-sparkling-2-fill text-xl text-amber-300"></i>
              <span class="text-base font-extrabold tracking-tight">一键口令云同步</span>
            </div>
            <p class="text-xs text-white/85 mt-1 leading-relaxed">
              无需注册账号、不用网易云 Cookie；一个专属口令，安卓 / 苹果 / 网页版 3 秒同步全部记录
            </p>
          </div>
          <span
            class="px-2.5 py-1 rounded-full text-[11px] font-bold flex-shrink-0"
            :class="
              cloudSyncStore.isQuickSyncConfigured
                ? 'bg-emerald-400/25 text-emerald-50 border border-emerald-200/40'
                : 'bg-white/15 text-white/90 border border-white/25'
            "
          >
            {{ cloudSyncStore.isQuickSyncConfigured ? '同步已开启' : '未开启' }}
          </span>
        </div>

        <!-- 上次同步时间与当前设备名称（可编辑） -->
        <div
          class="rounded-2xl bg-white/15 backdrop-blur-md px-3.5 py-2.5 flex items-center justify-between gap-2 flex-wrap"
        >
          <div class="flex items-center gap-2 min-w-0 flex-1">
            <i class="ri-smartphone-line text-sm text-amber-200 flex-shrink-0"></i>
            <template v-if="editingDeviceName">
              <input
                v-model="deviceNameDraft"
                type="text"
                maxlength="32"
                placeholder="输入设备名称（如 我的 iPhone）"
                class="flex-1 min-w-[120px] h-7 px-2.5 rounded-lg bg-white/20 border border-white/35 text-xs text-white placeholder-white/60 focus:outline-none"
                @keyup.enter="saveDeviceNameEdit"
              />
              <button
                type="button"
                class="px-2.5 py-1 rounded-full bg-white text-blue-700 text-[11px] font-bold flex-shrink-0"
                @click="saveDeviceNameEdit"
              >
                保存
              </button>
              <button
                type="button"
                class="px-2 py-1 rounded-full bg-white/15 text-white text-[11px] flex-shrink-0"
                @click="editingDeviceName = false"
              >
                取消
              </button>
            </template>
            <template v-else>
              <span class="text-xs font-semibold truncate">
                当前设备：{{ cloudSyncStore.effectiveDeviceName }}
              </span>
              <button
                type="button"
                class="px-2 py-0.5 rounded-full bg-white/15 hover:bg-white/25 text-[10px] font-bold text-white flex-shrink-0"
                @click="startEditDeviceName"
              >
                <i class="ri-edit-line mr-0.5"></i>修改
              </button>
            </template>
          </div>
          <div class="text-[11px] text-white/90 flex-shrink-0 font-medium">
            {{ relativeLastSyncLabel }}
          </div>
        </div>

        <!-- 本地数据概览 -->
        <div class="grid grid-cols-3 gap-2">
          <div class="rounded-2xl bg-white/15 backdrop-blur-md px-3 py-2.5">
            <div class="text-[11px] text-white/75">播放历史</div>
            <div class="text-base font-extrabold mt-0.5">
              {{ playHistoryStore.musicHistory.length }}
              <span class="text-xs font-normal">首</span>
            </div>
          </div>
          <div class="rounded-2xl bg-white/15 backdrop-blur-md px-3 py-2.5">
            <div class="text-[11px] text-white/75">我喜欢</div>
            <div class="text-base font-extrabold mt-0.5">
              {{ favoriteStore.favoriteList.length }}
              <span class="text-xs font-normal">首</span>
            </div>
          </div>
          <div class="rounded-2xl bg-white/15 backdrop-blur-md px-3 py-2.5">
            <div class="text-[11px] text-white/75">听歌时长</div>
            <div class="text-base font-extrabold mt-0.5 truncate">
              {{ formatDurationCompact(listeningStatsStore.stats.totalSeconds) }}
            </div>
          </div>
        </div>

        <!-- 状态 A：已开启口令云同步 -->
        <template v-if="cloudSyncStore.isQuickSyncConfigured && config.provider === 'quick'">
          <div
            class="rounded-2xl bg-black/20 backdrop-blur-md border border-white/20 p-3.5 space-y-2.5"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="text-[11px] text-white/80 font-semibold">我的专属同步口令</span>
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  class="text-[11px] text-white/85 hover:text-white flex items-center gap-0.5"
                  @click="showSyncCode = !showSyncCode"
                >
                  <i :class="showSyncCode ? 'ri-eye-off-line' : 'ri-eye-line'"></i>
                  {{ showSyncCode ? '隐藏' : '显示' }}
                </button>
                <button
                  type="button"
                  class="px-2.5 py-0.5 rounded-full bg-white/20 hover:bg-white/30 text-[11px] font-bold text-white transition-colors"
                  @click="handleCopySyncCode"
                >
                  <i class="ri-file-copy-line mr-0.5"></i>复制口令
                </button>
              </div>
            </div>

            <div class="font-mono text-lg font-extrabold tracking-widest select-all">
              {{ showSyncCode ? config.quick.syncCode : maskCode(config.quick.syncCode) }}
            </div>

            <div class="text-[11px] text-white/75 flex items-center gap-1">
              <i class="ri-lock-2-line text-emerald-300"></i>
              <span>端到端 AES-256 加密 · 换手机后输入此口令即可 3 秒恢复</span>
            </div>
          </div>

          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div class="text-xs text-white/90 truncate max-w-full flex items-center gap-1.5">
              <i class="ri-time-line text-amber-200"></i>
              <span>{{ relativeLastSyncLabel }}</span>
              <span
                v-if="cloudSyncStore.lastSyncAt && cloudSyncStore.lastSyncedRevision > 0"
                class="px-1.5 py-0.5 rounded bg-white/15 font-mono text-[10px]"
              >
                v{{ cloudSyncStore.lastSyncedRevision }}
              </span>
            </div>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="px-3 py-2 rounded-full text-xs font-bold bg-white/15 hover:bg-white/25 text-white transition-colors"
                @click="handleDisconnectQuickSync"
              >
                更换/退出
              </button>
              <button
                type="button"
                :disabled="cloudSyncStore.syncing || cloudSyncStore.previewing"
                class="px-4 py-2 rounded-full text-xs font-extrabold bg-white text-blue-700 hover:bg-sky-50 transition-all active:scale-95 flex items-center gap-1.5 shadow-md"
                @click="handleSyncNow"
              >
                <i
                  class="text-sm"
                  :class="
                    cloudSyncStore.syncing || cloudSyncStore.previewing
                      ? 'ri-loader-4-line animate-spin'
                      : 'ri-refresh-line'
                  "
                ></i>
                {{
                  cloudSyncStore.previewing
                    ? '检查差异中...'
                    : cloudSyncStore.syncing
                      ? '同步中...'
                      : '立即同步'
                }}
              </button>
            </div>
          </div>
        </template>

        <!-- 状态 B：尚未开启口令云同步（极简小白两步引导） -->
        <template v-else>
          <!-- 一键生成 -->
          <button
            type="button"
            :disabled="cloudSyncStore.syncing"
            class="w-full py-3 px-4 rounded-2xl bg-white text-blue-700 hover:bg-sky-50 font-extrabold text-sm shadow-md active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            @click="handleOneTapGenerate"
          >
            <i
              class="text-base"
              :class="
                cloudSyncStore.syncing ? 'ri-loader-4-line animate-spin' : 'ri-magic-line'
              "
            ></i>
            <span>{{
              cloudSyncStore.syncing ? '正在创建并同步...' : '一键生成我的同步口令并开启'
            }}</span>
          </button>

          <!-- 已有口令恢复 -->
          <div class="space-y-2">
            <div class="text-[11px] text-white/80 text-center">
              ── 已有口令？在新设备输入即可 3 秒找回全部数据 ──
            </div>
            <div class="flex items-center gap-2">
              <input
                v-model="inputSyncCode"
                type="text"
                placeholder="输入同步口令（如 NAIWA-7392-K8M4）"
                class="flex-1 min-w-0 h-10 px-3.5 rounded-xl bg-white/15 border border-white/25 text-white placeholder-white/60 text-xs font-mono tracking-wider focus:outline-none focus:bg-white/20"
                @keyup.enter="handleRestoreByCode"
              />
              <button
                type="button"
                :disabled="cloudSyncStore.syncing || !inputSyncCode.trim()"
                class="h-10 px-4 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-900 font-extrabold text-xs flex-shrink-0 active:scale-95 transition-all"
                @click="handleRestoreByCode"
              >
                立即恢复
              </button>
            </div>
          </div>

          <!-- 如果尚未内置 Supabase 节点，给部署者提示一步直达配置 -->
          <div
            v-if="!cloudSyncStore.hasQuickSyncEndpoint"
            class="rounded-xl px-3 py-2 bg-amber-400/20 border border-amber-200/40 text-[11px] text-amber-50 flex items-center justify-between gap-2"
          >
            <span>当前版本尚未绑定默认免费云节点，可在下方「高级设置」填入 Supabase 地址启用</span>
            <button
              type="button"
              class="px-2.5 py-1 rounded-full bg-white/20 font-bold flex-shrink-0"
              @click="openCustomSupabasePanel"
            >
              去填写
            </button>
          </div>
        </template>
      </div>
    </div>

    <!-- ==================== 2. 网易云扫码同步（免抓 Cookie） ==================== -->
    <div
      v-if="showCommonSections"
      class="rounded-[20px] p-4 bg-white dark:bg-[#131316] border border-slate-200/90 dark:border-white/[0.08] shadow-[0_2px_12px_rgba(15,23,42,0.05)] flex items-center justify-between gap-3 flex-wrap"
    >
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <div
          class="w-10 h-10 rounded-2xl bg-rose-50 dark:bg-rose-500/15 text-rose-500 flex items-center justify-center flex-shrink-0"
        >
          <i class="ri-netease-cloud-music-fill text-xl"></i>
        </div>
        <div class="min-w-0">
          <div class="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
            <span>网易云扫码同步</span>
            <span
              v-if="userStore.hasNeteaseAuth"
              class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
            >
              已连接
            </span>
          </div>
          <div class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {{
              userStore.hasNeteaseAuth
                ? '已免 Cookie 同步网易云最近播放、红心歌单，听满 30 秒自动打卡回传'
                : '扫一下即可直接同步网易云播放历史与红心，不再需要手动抓 Cookie'
            }}
          </div>
        </div>
      </div>
      <s-btn
        v-if="!userStore.hasNeteaseAuth"
        variant="primary"
        @click="router.push('/login')"
      >
        去扫码登录
      </s-btn>
    </div>

    <!-- ==================== 3. 发给微信 / 本地一键备份 ==================== -->
    <div
      v-if="showAdvancedSections"
      class="rounded-[20px] p-4 bg-white dark:bg-[#131316] border border-slate-200/90 dark:border-white/[0.08] shadow-[0_2px_12px_rgba(15,23,42,0.05)] space-y-3"
    >
      <div>
        <div class="text-sm font-extrabold text-slate-900 dark:text-white">
          离线换机备份（可发给微信「文件传输助手」）
        </div>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          不连任何云端也能搬家：一键复制备份发到自己微信，换新手机粘贴即可完整恢复
        </p>
      </div>

      <div class="flex items-center gap-2 flex-wrap">
        <s-btn variant="primary" @click="handleExportEncryptedJsonFile">
          <i class="ri-shield-keyhole-line mr-1"></i>一键导出加密备份（JSON）
        </s-btn>
        <s-btn @click="triggerFileImport">
          <i class="ri-upload-2-line mr-1"></i>导入备份恢复
        </s-btn>
        <s-btn @click="handleCopyBackupJson">
          <i class="ri-wechat-line mr-1"></i>复制备份发微信
        </s-btn>
        <s-btn @click="showPasteBox = !showPasteBox">
          <i class="ri-clipboard-line mr-1"></i>{{ showPasteBox ? '收起粘贴框' : '粘贴恢复' }}
        </s-btn>
        <s-btn @click="handleExportJsonFile">
          <i class="ri-download-2-line mr-1"></i>导出明文 JSON
        </s-btn>
        <input
          ref="fileInputRef"
          type="file"
          accept=".json,application/json,text/plain"
          class="hidden"
          @change="handleFileSelected"
        />
      </div>

      <!-- 加密备份口令（留空自动复用当前同步口令） -->
      <div class="flex items-center gap-2 flex-wrap">
        <n-input
          v-model:value="backupPassphrase"
          type="password"
          show-password-on="click"
          size="small"
          class="flex-1 min-w-[200px]"
          placeholder="加密备份/解密口令（留空自动使用当前同步口令，至少 10 位字母+数字）"
        />
      </div>

      <!-- 本地同步快照一键回滚（每次覆盖/合并前自动保存最近 5 份） -->
      <div
        v-if="cloudSyncStore.localBackups.length > 0"
        class="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2"
      >
        <div class="flex items-center justify-between">
          <span class="text-xs font-extrabold text-slate-700 dark:text-slate-200">
            <i class="ri-history-line mr-1 text-amber-500"></i>
            本地安全快照（最近 {{ cloudSyncStore.localBackups.length }} 份 · 支持一键回滚）
          </span>
        </div>
        <div class="space-y-1.5">
          <div
            v-for="bak in cloudSyncStore.localBackups"
            :key="bak.id"
            class="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/70 dark:border-slate-700/60"
          >
            <div class="min-w-0">
              <div class="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                {{ formatBackupReason(bak.reason) }} · v{{ bak.revision }}
              </div>
              <div class="text-[11px] text-slate-500 dark:text-slate-400">
                {{ formatConflictTime(bak.createdAt) }} · 喜欢 {{ bak.favoritesCount }} 首 · 历史 {{ bak.songsCount }} 首
              </div>
            </div>
            <button
              type="button"
              class="px-3 py-1 rounded-full text-[11px] font-bold bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 flex-shrink-0 transition-colors"
              @click="handleRollbackBackup(bak.id)"
            >
              一键回滚
            </button>
          </div>
        </div>
      </div>

      <div v-if="showPasteBox" class="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <span class="text-xs font-bold text-slate-600 dark:text-slate-300">恢复模式</span>
          <div class="inline-flex rounded-full bg-slate-100 dark:bg-slate-800 p-0.5 text-[11px]">
            <button
              type="button"
              class="px-2.5 py-1 rounded-full font-bold transition-colors"
              :class="
                importMode === 'merge'
                  ? 'bg-white dark:bg-slate-700 text-amber-600 dark:text-amber-300 shadow-sm'
                  : 'text-slate-500'
              "
              @click="importMode = 'merge'"
            >
              智能合并（不覆盖现有）
            </button>
            <button
              type="button"
              class="px-2.5 py-1 rounded-full font-bold transition-colors"
              :class="
                importMode === 'replace'
                  ? 'bg-white dark:bg-slate-700 text-rose-600 dark:text-rose-300 shadow-sm'
                  : 'text-slate-500'
              "
              @click="importMode = 'replace'"
            >
              覆盖恢复
            </button>
          </div>
        </div>
        <n-input
          v-model:value="pastedJson"
          type="textarea"
          :rows="4"
          placeholder="把从旧手机复制的备份内容粘贴到这里..."
        />
        <s-btn variant="primary" :disabled="!pastedJson.trim()" @click="handleImportPasted">
          确认恢复数据
        </s-btn>
      </div>
    </div>

    <!-- ==================== 4. 自动同步与同步内容开关 ==================== -->
    <setting-section v-if="showCommonSections" title="同步内容与自动策略">
      <setting-item
        inline
        title="打开 App 自动双向同步"
        description="每次启动自动同步其他设备的新记录（静默无打扰）"
      >
        <n-switch v-model:value="config.autoSyncOnLaunch" @update:value="handleConfigChange">
          <template #checked>开</template>
          <template #unchecked>关</template>
        </n-switch>
      </setting-item>

      <setting-item
        inline
        title="听歌后自动后台备份"
        description="切歌后自动增量同步最新记录（45 秒节流，省电省流量）"
      >
        <n-switch v-model:value="config.autoSyncOnPlay" @update:value="handleConfigChange">
          <template #checked>开</template>
          <template #unchecked>关</template>
        </n-switch>
      </setting-item>

      <setting-item inline title="同步播放历史" description="歌曲、歌单、专辑与播客最近播放">
        <n-switch v-model:value="config.syncHistory" @update:value="handleConfigChange">
          <template #checked>开</template>
          <template #unchecked>关</template>
        </n-switch>
      </setting-item>

      <setting-item inline title="同步「我喜欢」红心列表" description="本地收藏与不喜欢列表">
        <n-switch v-model:value="config.syncFavorites" @update:value="handleConfigChange">
          <template #checked>开</template>
          <template #unchecked>关</template>
        </n-switch>
      </setting-item>

      <setting-item
        inline
        title="同步听歌时长统计"
        description="累计时长、每日柱状图、听歌作息与歌手排行"
      >
        <n-switch v-model:value="config.syncListeningStats" @update:value="handleConfigChange">
          <template #checked>开</template>
          <template #unchecked>关</template>
        </n-switch>
      </setting-item>
    </setting-section>

    <!-- ==================== 5. 默认折叠：极客高级同步（WebDAV / GitHub / 自定义节点） ==================== -->
    <div
      v-if="showAdvancedSections"
      class="rounded-[20px] bg-white dark:bg-[#131316] border border-slate-200/90 dark:border-white/[0.08] shadow-[0_2px_12px_rgba(15,23,42,0.04)] overflow-hidden"
    >
      <button
        type="button"
        class="w-full px-4 py-3.5 flex items-center justify-between gap-2 text-left hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors"
        @click="showAdvanced = !showAdvanced"
      >
        <div class="flex items-center gap-2 min-w-0">
          <i class="ri-tools-line text-slate-500 dark:text-slate-400"></i>
          <div>
            <div class="text-xs font-extrabold text-slate-700 dark:text-slate-200">
              极客进阶同步（WebDAV / GitHub 私有云 / 自建节点）
            </div>
            <div class="text-[11px] text-slate-400 mt-0.5">
              普通用户无需配置这里，用顶部的「一键口令云同步」即可
            </div>
          </div>
        </div>
        <i
          class="ri-arrow-down-s-line text-lg text-slate-400 transition-transform duration-200 flex-shrink-0"
          :class="{ 'rotate-180': showAdvanced }"
        ></i>
      </button>

      <div
        v-if="showAdvanced"
        class="px-4 pb-4 pt-2 border-t border-slate-100 dark:border-slate-800 space-y-4"
      >
        <div class="grid grid-cols-3 gap-1.5 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800/90">
          <button
            v-for="tab in advancedTabs"
            :key="tab.id"
            type="button"
            class="py-1.5 px-2 rounded-xl text-xs font-bold transition-all"
            :class="
              activeAdvancedTab === tab.id
                ? 'bg-white dark:bg-slate-700 text-amber-600 dark:text-amber-300 shadow-sm'
                : 'text-slate-600 dark:text-slate-300'
            "
            @click="activeAdvancedTab = tab.id"
          >
            {{ tab.label }}
          </button>
        </div>

        <!-- 进阶子面板 A：自定义 Supabase 免费节点 -->
        <div v-if="activeAdvancedTab === 'supabase'" class="space-y-3">
          <p class="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            可填写你自己部署的 Supabase 免费云节点（留空则使用内置默认节点）。建表脚本见开源仓库
            <code class="font-mono">sync-server/supabase/schema.sql</code>。
          </p>
          <div>
            <label class="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
              Supabase Project URL
            </label>
            <n-input
              v-model:value="config.quick.customSupabaseUrl"
              placeholder="例如 https://xxxxxxxx.supabase.co"
              clearable
            />
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
              Supabase 公开 anon / publishable key
            </label>
            <n-input
              v-model:value="config.quick.customSupabaseAnonKey"
              type="password"
              show-password-on="click"
              placeholder="填入公开 anon key（切勿填 service_role）"
            />
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <s-btn :disabled="cloudSyncStore.testing" @click="handleSaveAndTest('quick')">
              {{ cloudSyncStore.testing ? '测试中...' : '保存并测试连接' }}
            </s-btn>
          </div>
        </div>

        <!-- 进阶子面板 B：WebDAV -->
        <div v-else-if="activeAdvancedTab === 'webdav'" class="space-y-3">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-xs text-slate-500">快捷预设：</span>
            <button
              v-for="preset in webdavPresets"
              :key="preset.name"
              type="button"
              class="px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors"
              :class="
                config.webdav.serverUrl.startsWith(preset.url)
                  ? 'bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-500/20 dark:border-amber-400/40 dark:text-amber-300'
                  : 'bg-slate-50 border-slate-200 text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300'
              "
              @click="applyWebdavPreset(preset.url)"
            >
              {{ preset.name }}
            </button>
          </div>
          <n-input
            v-model:value="config.webdav.serverUrl"
            placeholder="WebDAV 地址（如 https://dav.jianguoyun.com/dav/）"
            clearable
          />
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            <n-input v-model:value="config.webdav.username" placeholder="账号 / 邮箱" clearable />
            <n-input
              v-model:value="config.webdav.password"
              type="password"
              show-password-on="click"
              placeholder="第三方应用密码"
            />
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            <n-input v-model:value="config.webdav.folderPath" placeholder="/XiaoPangNaiwaMusic" />
            <n-input v-model:value="config.webdav.fileName" placeholder="sync-data-v1.json" />
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <s-btn :disabled="cloudSyncStore.testing" @click="handleSaveAndTest('webdav')">
              测试连接
            </s-btn>
            <s-btn
              variant="primary"
              :disabled="cloudSyncStore.syncing"
              @click="handleSaveAndSync('webdav')"
            >
              切换为 WebDAV 并同步
            </s-btn>
          </div>
        </div>

        <!-- 进阶子面板 C：GitHub Gist -->
        <div v-else class="space-y-3">
          <n-input
            v-model:value="config.github.token"
            type="password"
            show-password-on="click"
            placeholder="GitHub PAT（仅勾选 gist 权限）"
          />
          <p class="text-[11px] leading-relaxed text-amber-700/90 dark:text-amber-300/85 bg-amber-50/70 dark:bg-amber-500/10 border border-amber-200/70 dark:border-amber-400/20 rounded-xl px-3 py-2">
            <i class="ri-shield-keyhole-line mr-1"></i>
            {{
              isNativeShell
                ? '已启用系统硬件加密存储：同步口令、WebDAV 密码与 GitHub PAT 仅加密保存在 Android Keystore / iOS Keychain，绝不写入明文 localStorage。'
                : '安全提示：Web/PWA 端 GitHub PAT、WebDAV 密码与同步口令默认仅存当次页面内存（刷新后需重新输入，不落 localStorage）；建议使用 Fine-grained 且仅勾选 Gists 权限的短期 Token。'
            }}
          </p>
          <n-input
            v-model:value="config.github.gistId"
            placeholder="私有 Gist ID（留空首次自动创建，换机自动发现）"
            clearable
          />
          <div class="flex items-center gap-2 flex-wrap">
            <s-btn :disabled="cloudSyncStore.testing" @click="handleSaveAndTest('github')">
              测试连接
            </s-btn>
            <s-btn
              variant="primary"
              :disabled="cloudSyncStore.syncing"
              @click="handleSaveAndSync('github')"
            >
              切换为 GitHub 云并同步
            </s-btn>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== 5.5 同步前变更预览与确认弹窗 ==================== -->
    <n-modal
      :show="Boolean(cloudSyncStore.pendingSyncPreview)"
      preset="card"
      :z-index="12000"
      :bordered="false"
      :mask-closable="true"
      class="max-w-[480px] w-[92vw] rounded-3xl"
      title="同步前变更预览"
      @close="cloudSyncStore.dismissPendingSyncPreview"
      @update:show="(val: boolean) => { if (!val) cloudSyncStore.dismissPendingSyncPreview(); }"
    >
      <div v-if="cloudSyncStore.pendingSyncPreview" class="space-y-3.5">
        <div
          class="rounded-2xl p-3.5 bg-sky-50/90 dark:bg-sky-500/10 border border-sky-200/80 dark:border-sky-400/25 space-y-1.5"
        >
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <span class="text-sm font-extrabold text-sky-900 dark:text-sky-200">
              {{ cloudSyncStore.pendingSyncPreview.preview.summaryText }}
            </span>
            <span
              v-if="cloudSyncStore.pendingSyncPreview.hasConflict"
              class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300"
            >
              检测到双端修改
            </span>
          </div>
          <div class="text-[11px] text-slate-600 dark:text-zinc-400 flex items-center gap-3 flex-wrap">
            <span>
              本机：喜欢 {{ cloudSyncStore.pendingSyncPreview.localSummary.favoritesCount }} · 历史
              {{ cloudSyncStore.pendingSyncPreview.localSummary.songsCount }} · 歌单
              {{ cloudSyncStore.pendingSyncPreview.localSummary.playlistsCount }}
            </span>
            <span v-if="cloudSyncStore.pendingSyncPreview.preview.hasRemote">
              云端：喜欢 {{ cloudSyncStore.pendingSyncPreview.remoteSummary.favoritesCount }} · 历史
              {{ cloudSyncStore.pendingSyncPreview.remoteSummary.songsCount }} · 歌单
              {{ cloudSyncStore.pendingSyncPreview.remoteSummary.playlistsCount }}
            </span>
          </div>
        </div>

        <!-- 可展开差异列表 -->
        <div
          class="rounded-2xl border border-slate-200/80 dark:border-white/[0.08] bg-slate-50/70 dark:bg-[#1C1C22]/70 overflow-hidden"
        >
          <button
            type="button"
            class="w-full px-3.5 py-2.5 flex items-center justify-between text-xs font-bold text-slate-700 dark:text-zinc-200"
            @click="showPreviewDiff = !showPreviewDiff"
          >
            <span class="flex items-center gap-1.5">
              <i class="ri-git-commit-line text-amber-500"></i>
              <span>查看差异明细</span>
              <span class="text-[11px] font-normal text-slate-500 dark:text-zinc-400">
                （{{ totalPreviewDiffCount }} 项可见变化）
              </span>
            </span>
            <i
              class="ri-arrow-down-s-line text-base text-slate-400 transition-transform duration-200"
              :class="{ 'rotate-180': showPreviewDiff }"
            ></i>
          </button>

          <div
            v-if="showPreviewDiff"
            class="px-3.5 pb-3 pt-2 border-t border-slate-200/70 dark:border-white/[0.06] max-h-56 overflow-y-auto space-y-2.5 text-xs"
          >
            <div v-if="cloudSyncStore.pendingSyncPreview.preview.diffItems.favorites.length > 0" class="space-y-1">
              <div class="text-[11px] font-bold text-rose-600 dark:text-rose-400">
                红心收藏（+{{ cloudSyncStore.pendingSyncPreview.preview.addedFavorites }}）
              </div>
              <div
                v-for="item in cloudSyncStore.pendingSyncPreview.preview.diffItems.favorites"
                :key="`fav_${item.source}_${item.id}`"
                class="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-white dark:bg-[#131316]"
              >
                <div class="min-w-0">
                  <div class="font-semibold text-slate-800 dark:text-zinc-100 truncate">{{ item.title }}</div>
                  <div class="text-[10px] text-slate-500 dark:text-zinc-400 truncate">{{ item.subtitle }}</div>
                </div>
                <span
                  class="px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0"
                  :class="
                    item.source === 'remote'
                      ? 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300'
                      : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
                  "
                >
                  {{ item.source === 'remote' ? '云端' : '本机' }}
                </span>
              </div>
            </div>

            <div v-if="cloudSyncStore.pendingSyncPreview.preview.diffItems.history.length > 0" class="space-y-1">
              <div class="text-[11px] font-bold text-amber-600 dark:text-amber-400">
                播放历史（+{{ cloudSyncStore.pendingSyncPreview.preview.addedHistory }}）
              </div>
              <div
                v-for="item in cloudSyncStore.pendingSyncPreview.preview.diffItems.history"
                :key="`hist_${item.source}_${item.id}`"
                class="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-white dark:bg-[#131316]"
              >
                <div class="min-w-0">
                  <div class="font-semibold text-slate-800 dark:text-zinc-100 truncate">{{ item.title }}</div>
                  <div class="text-[10px] text-slate-500 dark:text-zinc-400 truncate">{{ item.subtitle }}</div>
                </div>
                <span
                  class="px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0"
                  :class="
                    item.source === 'remote'
                      ? 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300'
                      : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
                  "
                >
                  {{ item.source === 'remote' ? '云端' : '本机' }}
                </span>
              </div>
            </div>

            <div v-if="cloudSyncStore.pendingSyncPreview.preview.diffItems.playlists.length > 0" class="space-y-1">
              <div class="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                自建歌单（+{{ cloudSyncStore.pendingSyncPreview.preview.addedPlaylists }}）
              </div>
              <div
                v-for="item in cloudSyncStore.pendingSyncPreview.preview.diffItems.playlists"
                :key="`pl_${item.source}_${item.id}`"
                class="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-white dark:bg-[#131316]"
              >
                <div class="min-w-0">
                  <div class="font-semibold text-slate-800 dark:text-zinc-100 truncate">{{ item.title }}</div>
                  <div class="text-[10px] text-slate-500 dark:text-zinc-400 truncate">{{ item.subtitle }}</div>
                </div>
                <span
                  class="px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0"
                  :class="
                    item.source === 'remote'
                      ? 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300'
                      : item.source === 'both'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
                  "
                >
                  {{ item.source === 'remote' ? '云端' : item.source === 'both' ? '合并' : '本机' }}
                </span>
              </div>
            </div>

            <div
              v-if="totalPreviewDiffCount === 0"
              class="text-center py-2 text-[11px] text-slate-500 dark:text-zinc-400"
            >
              仅听歌统计或偏好配置有增量更新，同步后将自动保留较新版本
            </div>
          </div>
        </div>

        <!-- 合并策略选择（默认选中推荐智能合并） -->
        <div class="space-y-1.5">
          <button
            type="button"
            class="w-full px-3.5 py-2.5 rounded-2xl border text-left transition-all flex items-center gap-2.5"
            :class="
              selectedPreviewStrategy === 'smart-merge'
                ? 'border-amber-500 bg-amber-50/90 dark:bg-amber-500/15'
                : 'border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#1C1C22]'
            "
            @click="selectedPreviewStrategy = 'smart-merge'"
          >
            <i
              class="text-base"
              :class="
                selectedPreviewStrategy === 'smart-merge'
                  ? 'ri-checkbox-circle-fill text-amber-500'
                  : 'ri-checkbox-blank-circle-line text-slate-400'
              "
            ></i>
            <div class="min-w-0 flex-1">
              <div class="text-xs font-extrabold text-slate-900 dark:text-white">
                智能合并（推荐）
              </div>
              <div class="text-[11px] text-slate-500 dark:text-zinc-400">
                保留双方全部喜欢、历史与歌单并去重，同时自动留存本机回滚快照
              </div>
            </div>
          </button>

          <div
            v-if="cloudSyncStore.pendingSyncPreview.preview.hasRemote"
            class="grid grid-cols-2 gap-2"
          >
            <button
              type="button"
              class="px-3 py-2 rounded-2xl border text-left transition-all flex items-center gap-2"
              :class="
                selectedPreviewStrategy === 'use-remote'
                  ? 'border-sky-500 bg-sky-50/90 dark:bg-sky-500/15'
                  : 'border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#1C1C22]'
              "
              @click="selectedPreviewStrategy = 'use-remote'"
            >
              <i
                class="text-sm"
                :class="
                  selectedPreviewStrategy === 'use-remote'
                    ? 'ri-checkbox-circle-fill text-sky-500'
                    : 'ri-checkbox-blank-circle-line text-slate-400'
                "
              ></i>
              <span class="text-xs font-bold text-slate-800 dark:text-zinc-100">以云端为准</span>
            </button>
            <button
              type="button"
              class="px-3 py-2 rounded-2xl border text-left transition-all flex items-center gap-2"
              :class="
                selectedPreviewStrategy === 'overwrite-remote'
                  ? 'border-rose-500 bg-rose-50/90 dark:bg-rose-500/15'
                  : 'border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#1C1C22]'
              "
              @click="selectedPreviewStrategy = 'overwrite-remote'"
            >
              <i
                class="text-sm"
                :class="
                  selectedPreviewStrategy === 'overwrite-remote'
                    ? 'ri-checkbox-circle-fill text-rose-500'
                    : 'ri-checkbox-blank-circle-line text-slate-400'
                "
              ></i>
              <span class="text-xs font-bold text-slate-800 dark:text-zinc-100">以本机覆盖云端</span>
            </button>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 pt-1">
          <s-btn @click="cloudSyncStore.dismissPendingSyncPreview">取消</s-btn>
          <s-btn
            variant="primary"
            :loading="cloudSyncStore.syncing"
            @click="handleConfirmPreviewSync"
          >
            确认同步
          </s-btn>
        </div>
      </div>
    </n-modal>

    <!-- ==================== 6. 多端并发更新冲突三选一弹窗 ==================== -->
    <n-modal
      :show="Boolean(cloudSyncStore.pendingConflict)"
      preset="card"
      :z-index="12000"
      :bordered="false"
      :mask-closable="false"
      class="max-w-[460px] w-[92vw] rounded-3xl"
      title="检测到云端版本冲突"
      @close="cloudSyncStore.dismissPendingConflict"
    >
      <div v-if="cloudSyncStore.pendingConflict" class="space-y-4">
        <p class="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          云端数据已被其他设备更新，同时本机也存在尚未上传的修改。为避免误覆盖丢失歌曲，请选择处理方式（执行前会自动留存本机快照支持回滚）：
        </p>

        <!-- 差异预览条：本机新增 X 首 / 云端新增 Y 首 -->
        <div
          class="rounded-2xl px-3.5 py-2.5 bg-amber-50/90 dark:bg-amber-500/15 border border-amber-200/80 dark:border-amber-400/30 flex items-center justify-between gap-2 flex-wrap text-xs"
        >
          <span class="font-extrabold text-amber-800 dark:text-amber-200">
            本机新增 {{ cloudSyncStore.pendingConflict.diffPreview.localAddedTotal }} 首 / 云端新增
            {{ cloudSyncStore.pendingConflict.diffPreview.remoteAddedTotal }} 首
          </span>
          <span class="text-[11px] text-amber-700/80 dark:text-amber-300/80">
            （喜欢：本机 +{{ cloudSyncStore.pendingConflict.diffPreview.localOnlyFavorites }} · 云端 +{{ cloudSyncStore.pendingConflict.diffPreview.remoteOnlyFavorites }}）
          </span>
        </div>

        <div class="grid grid-cols-2 gap-2.5">
          <div
            class="rounded-2xl p-3 bg-slate-50 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 space-y-1.5"
          >
            <div class="flex items-center justify-between gap-1">
              <span class="text-xs font-extrabold text-slate-800 dark:text-slate-100">本机数据</span>
              <span
                class="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 font-mono text-[10px] font-bold"
              >
                v{{ cloudSyncStore.pendingConflict.localSummary.revision }}
              </span>
            </div>
            <div class="text-[11px] text-slate-500 dark:text-slate-400">
              设备：{{ cloudSyncStore.pendingConflict.localSummary.deviceName }}
            </div>
            <div class="text-[11px] text-slate-500 dark:text-slate-400">
              喜欢 {{ cloudSyncStore.pendingConflict.localSummary.favoritesCount }} 首 · 历史
              {{ cloudSyncStore.pendingConflict.localSummary.songsCount }} 首
            </div>
            <div class="text-[11px] text-slate-400">
              {{ formatConflictTime(cloudSyncStore.pendingConflict.localSummary.updatedAt) }}
            </div>
          </div>

          <div
            class="rounded-2xl p-3 bg-sky-50/70 dark:bg-sky-900/20 border border-sky-200/80 dark:border-sky-500/30 space-y-1.5"
          >
            <div class="flex items-center justify-between gap-1">
              <span class="text-xs font-extrabold text-sky-900 dark:text-sky-100">云端数据</span>
              <span
                class="px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-500/25 text-sky-700 dark:text-sky-300 font-mono text-[10px] font-bold"
              >
                v{{ cloudSyncStore.pendingConflict.remoteSummary.revision }}
              </span>
            </div>
            <div class="text-[11px] text-slate-500 dark:text-slate-400">
              设备：{{ cloudSyncStore.pendingConflict.remoteSummary.deviceName }}
            </div>
            <div class="text-[11px] text-slate-500 dark:text-slate-400">
              喜欢 {{ cloudSyncStore.pendingConflict.remoteSummary.favoritesCount }} 首 · 历史
              {{ cloudSyncStore.pendingConflict.remoteSummary.songsCount }} 首
            </div>
            <div class="text-[11px] text-slate-400">
              {{ formatConflictTime(cloudSyncStore.pendingConflict.remoteSummary.updatedAt) }}
            </div>
          </div>
        </div>

        <div class="space-y-2 pt-1">
          <button
            type="button"
            :disabled="cloudSyncStore.syncing"
            class="w-full py-2.5 px-4 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white font-extrabold text-xs shadow-md transition-all active:scale-[0.98] disabled:opacity-50"
            @click="handleResolveConflict('smart-merge')"
          >
            智能合并（推荐）· 保留双方全部喜欢与历史，配置取较新版本
          </button>
          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              :disabled="cloudSyncStore.syncing"
              class="py-2.5 px-3 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 font-bold text-xs transition-colors disabled:opacity-50"
              @click="handleResolveConflict('use-remote')"
            >
              以云端为准
            </button>
            <button
              type="button"
              :disabled="cloudSyncStore.syncing"
              class="py-2.5 px-3 rounded-2xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-500/15 dark:hover:bg-rose-500/25 text-rose-600 dark:text-rose-300 font-bold text-xs transition-colors disabled:opacity-50"
              @click="handleResolveConflict('overwrite-remote')"
            >
              覆盖云端
            </button>
          </div>
        </div>
      </div>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { useMessage } from 'naive-ui';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import {
  type ConflictResolutionStrategy,
  type SyncProvider,
  useCloudSyncStore
} from '@/store/modules/cloudSync';
import { useFavoriteStore } from '@/store/modules/favorite';
import {
  formatDurationCompact,
  useListeningStatsStore
} from '@/store/modules/listeningStats';
import { usePlayHistoryStore } from '@/store/modules/playHistory';
import { useUserStore } from '@/store/modules/user';
import { invokeAndroidAsync, isAndroid } from '@/utils/androidBridge';
import { formatRelativeSyncTime } from '@/utils/cloudSyncMerge';

import SBtn from '../SBtn.vue';
import SettingItem from '../SettingItem.vue';
import SettingSection from '../SettingSection.vue';

const props = withDefaults(
  defineProps<{
    mode?: 'common' | 'advanced' | 'all';
  }>(),
  { mode: 'all' }
);

const showCommonSections = computed(() => props.mode !== 'advanced');
const showAdvancedSections = computed(() => props.mode !== 'common');

const message = useMessage();
const router = useRouter();
const cloudSyncStore = useCloudSyncStore();
const playHistoryStore = usePlayHistoryStore();
const favoriteStore = useFavoriteStore();
const listeningStatsStore = useListeningStatsStore();
const userStore = useUserStore();
const isNativeShell = isAndroid();

const config = cloudSyncStore.config;
const inputSyncCode = ref('');
const showSyncCode = ref(true);
const editingDeviceName = ref(false);
const deviceNameDraft = ref('');
const backupPassphrase = ref('');
const showAdvanced = ref(props.mode === 'advanced');
const activeAdvancedTab = ref<'supabase' | 'webdav' | 'github'>('supabase');
const importMode = ref<'merge' | 'replace'>('merge');
const showPasteBox = ref(false);
const pastedJson = ref('');
const fileInputRef = ref<HTMLInputElement | null>(null);
const selectedPreviewStrategy = ref<ConflictResolutionStrategy>('smart-merge');
const showPreviewDiff = ref(false);
const nowTick = ref(Date.now());
let tickTimer: number | null = null;

const relativeLastSyncLabel = computed(() => {
  if (!cloudSyncStore.lastSyncAt) return '尚未同步';
  return `上次成功同步：${formatRelativeSyncTime(cloudSyncStore.lastSyncAt, nowTick.value)}`;
});

const totalPreviewDiffCount = computed(() => {
  const d = cloudSyncStore.pendingSyncPreview?.preview?.diffItems;
  if (!d) return 0;
  return (d.favorites?.length || 0) + (d.history?.length || 0) + (d.playlists?.length || 0);
});

const startEditDeviceName = () => {
  deviceNameDraft.value = cloudSyncStore.effectiveDeviceName;
  editingDeviceName.value = true;
};

const saveDeviceNameEdit = () => {
  cloudSyncStore.setDeviceName(deviceNameDraft.value);
  editingDeviceName.value = false;
  message.success(`设备名称已更新为：${cloudSyncStore.effectiveDeviceName}`);
};

const formatBackupReason = (reason: string): string => {
  if (reason === 'before-merge') return '智能合并前快照';
  if (reason === 'before-use-remote') return '云端覆盖前快照';
  if (reason === 'before-overwrite') return '覆盖云端前快照';
  if (reason === 'before-import') return '导入恢复前快照';
  if (reason === 'before-rollback') return '回滚前快照';
  return '本地安全快照';
};

const handleRollbackBackup = async (backupId: string) => {
  const res = await cloudSyncStore.rollbackToBackup(backupId);
  if (res.ok) message.success(res.message);
  else message.error(res.message);
};

const advancedTabs: Array<{ id: 'supabase' | 'webdav' | 'github'; label: string }> = [
  { id: 'supabase', label: '自建口令节点' },
  { id: 'webdav', label: 'WebDAV' },
  { id: 'github', label: 'GitHub 私有云' }
];

const webdavPresets = [
  { name: '坚果云', url: 'https://dav.jianguoyun.com/dav/' },
  { name: 'InfiniCLOUD', url: 'https://jura.teracloud.jp/dav/' },
  { name: 'Alist / 自定义', url: 'https://' }
];

const maskCode = (code: string): string => {
  if (!code || code.length <= 6) return '••••••';
  return `${code.slice(0, 6)}••••${code.slice(-2)}`;
};

const openCustomSupabasePanel = () => {
  showAdvanced.value = true;
  activeAdvancedTab.value = 'supabase';
};

const handleOneTapGenerate = async () => {
  if (!cloudSyncStore.hasQuickSyncEndpoint) {
    message.warning('尚未配置免费云节点，请先在下方「极客进阶 → 自建口令节点」填入 Supabase 地址');
    openCustomSupabasePanel();
    return;
  }
  const res = await cloudSyncStore.enableQuickSyncWithCode();
  if (res.ok) {
    showSyncCode.value = true;
    message.success(`同步口令 ${res.syncCode} 已生成并同步成功！请复制保存好`, {
      duration: 5000
    });
  } else if (res.conflict) {
    showSyncCode.value = true;
    message.warning(res.message);
  } else {
    message.error(res.message);
  }
};

const handleRestoreByCode = async () => {
  if (!cloudSyncStore.hasQuickSyncEndpoint) {
    message.warning('尚未配置免费云节点，请先在下方填入 Supabase 地址');
    openCustomSupabasePanel();
    return;
  }
  const res = await cloudSyncStore.enableQuickSyncWithCode(inputSyncCode.value);
  if (res.ok) {
    inputSyncCode.value = '';
    showSyncCode.value = true;
    message.success(res.message);
  } else if (res.conflict) {
    inputSyncCode.value = '';
    showSyncCode.value = true;
    message.warning(res.message);
  } else {
    message.error(res.message);
  }
};

const handleCopySyncCode = async () => {
  const code = config.quick.syncCode;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    message.success(`口令 ${code} 已复制，可发给自己微信备忘或在新手机粘贴恢复`);
  } catch {
    message.info(`你的同步口令是：${code}`);
  }
};

const handleDisconnectQuickSync = () => {
  cloudSyncStore.disconnectQuickSync();
  message.info('已退出当前同步口令（本机数据已保留）');
};

const applyWebdavPreset = (url: string) => {
  config.webdav.serverUrl = url;
  cloudSyncStore.saveConfig();
};

const handleConfigChange = () => {
  cloudSyncStore.saveConfig();
};

const handleSaveAndTest = async (provider: SyncProvider) => {
  const prevProvider = config.provider;
  config.provider = provider;
  cloudSyncStore.saveConfig();
  const res = await cloudSyncStore.testConnection();
  if (!res.ok && provider !== 'quick') {
    config.provider = prevProvider;
    cloudSyncStore.saveConfig();
  }
  if (res.ok) message.success(res.message);
  else message.error(res.message);
};

const handleSaveAndSync = async (provider: SyncProvider) => {
  config.provider = provider;
  cloudSyncStore.saveConfig();
  await handleSyncNow();
};

const handleSyncNow = async () => {
  selectedPreviewStrategy.value = 'smart-merge';
  showPreviewDiff.value = false;
  const res = await cloudSyncStore.prepareSyncPreview();
  if (res.previewPending) {
    return;
  }
  if (res.ok) message.success(res.message);
  else if (res.conflict) message.warning(res.message);
  else message.error(res.message);
};

const handleConfirmPreviewSync = async () => {
  const res = await cloudSyncStore.confirmPendingSyncPreview(selectedPreviewStrategy.value);
  if (res.ok) message.success(res.message);
  else if (res.conflict) message.warning(res.message);
  else message.error(res.message);
};

const handleResolveConflict = async (strategy: ConflictResolutionStrategy) => {
  const res = await cloudSyncStore.resolvePendingConflict(strategy);
  if (res.ok) message.success(res.message);
  else message.error(res.message);
};

const formatConflictTime = (ts: number): string => {
  if (!ts) return '未知时间';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const saveTextBackupFile = async (filename: string, content: string, successLabel: string) => {
  if (isAndroid()) {
    try {
      const res = await invokeAndroidAsync<{ success?: boolean; path?: string }>(
        'save-text-file',
        { filename, content },
        15000
      );
      if (res?.success) {
        message.success(`${successLabel}已保存到：${res.path || filename}`, { duration: 4500 });
        return;
      }
    } catch {
      // fallback below
    }
  }

  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  message.success(`已导出${successLabel} ${filename}`);
};

const handleExportEncryptedJsonFile = async () => {
  try {
    const res = await cloudSyncStore.exportEncryptedBackupJsonString(backupPassphrase.value);
    if (!res.ok || !res.json) {
      message.warning(res.message);
      return;
    }
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
      now.getDate()
    ).padStart(2, '0')}`;
    const filename = `xiaopang-music-encrypted-backup-${stamp}.json`;
    await saveTextBackupFile(filename, res.json, 'AES-256 加密备份');
  } catch (err: any) {
    message.error(`导出加密备份失败：${err?.message || '未知错误'}`);
  }
};

const handleExportJsonFile = async () => {
  try {
    const jsonStr = await cloudSyncStore.exportBackupJsonString();
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
      now.getDate()
    ).padStart(2, '0')}`;
    const filename = `xiaopang-music-backup-${stamp}.json`;
    await saveTextBackupFile(filename, jsonStr, '备份文件');
  } catch (err: any) {
    message.error(`导出失败：${err?.message || '未知错误'}`);
  }
};

const handleCopyBackupJson = async () => {
  try {
    const jsonStr = await cloudSyncStore.exportBackupJsonString();
    await navigator.clipboard.writeText(jsonStr);
    message.success('备份已复制！直接发到微信「文件传输助手」，新手机粘贴即可一键恢复', {
      duration: 4500
    });
  } catch {
    message.error('复制失败，请点击「导出文件」');
  }
};

const triggerFileImport = async () => {
  if (isAndroid()) {
    try {
      const picked = await invokeAndroidAsync<{ name?: string; content?: string } | null>(
        'pick-text-file',
        { accept: 'application/json' },
        60000
      );
      if (picked && picked.content) {
        const res = await cloudSyncStore.importBackupJsonString(
          picked.content,
          importMode.value,
          backupPassphrase.value
        );
        if (res.ok) message.success(res.message);
        else if (res.needsPassphrase) message.warning(res.message);
        else message.error(res.message);
      }
      return;
    } catch {
      // fallback
    }
  }
  fileInputRef.value?.click();
};

const handleFileSelected = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const res = await cloudSyncStore.importBackupJsonString(
      text,
      importMode.value,
      backupPassphrase.value
    );
    if (res.ok) message.success(res.message);
    else if (res.needsPassphrase) message.warning(res.message);
    else message.error(res.message);
  } catch (err: any) {
    message.error(`读取文件失败：${err?.message || '未知错误'}`);
  } finally {
    input.value = '';
  }
};

const handleImportPasted = async () => {
  const res = await cloudSyncStore.importBackupJsonString(
    pastedJson.value,
    importMode.value,
    backupPassphrase.value
  );
  if (res.ok) {
    message.success(res.message);
    pastedJson.value = '';
    showPasteBox.value = false;
  } else if (res.needsPassphrase) {
    message.warning(res.message);
  } else {
    message.error(res.message);
  }
};

onMounted(() => {
  listeningStatsStore.refreshStats();
  tickTimer = window.setInterval(() => {
    nowTick.value = Date.now();
  }, 30000);
});

onUnmounted(() => {
  if (tickTimer !== null) {
    window.clearInterval(tickTimer);
    tickTimer = null;
  }
});
</script>
