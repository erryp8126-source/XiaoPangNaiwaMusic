<template>
  <div class="space-y-4">
    <!-- ==================== 1. 主推小白入口：一键专属同步口令 ==================== -->
    <div
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
            <div class="text-xs text-white/85 truncate max-w-full">
              <template v-if="cloudSyncStore.lastSyncAt">
                上次同步：{{ formatTime(cloudSyncStore.lastSyncAt) }}
              </template>
              <template v-else>已就绪，点击右侧立即同步</template>
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
                :disabled="cloudSyncStore.syncing"
                class="px-4 py-2 rounded-full text-xs font-extrabold bg-white text-blue-700 hover:bg-sky-50 transition-all active:scale-95 flex items-center gap-1.5 shadow-md"
                @click="handleSyncNow"
              >
                <i
                  class="text-sm"
                  :class="
                    cloudSyncStore.syncing ? 'ri-loader-4-line animate-spin' : 'ri-refresh-line'
                  "
                ></i>
                {{ cloudSyncStore.syncing ? '同步中...' : '立即同步' }}
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
      class="rounded-[20px] p-4 bg-white dark:bg-[#192231] border border-slate-200/90 dark:border-slate-700/80 shadow-[0_2px_12px_rgba(15,23,42,0.05)] flex items-center justify-between gap-3 flex-wrap"
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
      class="rounded-[20px] p-4 bg-white dark:bg-[#192231] border border-slate-200/90 dark:border-slate-700/80 shadow-[0_2px_12px_rgba(15,23,42,0.05)] space-y-3"
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
        <s-btn variant="primary" @click="handleCopyBackupJson">
          <i class="ri-wechat-line mr-1"></i>复制备份发微信
        </s-btn>
        <s-btn @click="showPasteBox = !showPasteBox">
          <i class="ri-clipboard-line mr-1"></i>{{ showPasteBox ? '收起粘贴框' : '粘贴一键恢复' }}
        </s-btn>
        <s-btn @click="handleExportJsonFile">
          <i class="ri-download-2-line mr-1"></i>导出文件
        </s-btn>
        <s-btn @click="triggerFileImport">
          <i class="ri-upload-2-line mr-1"></i>选文件恢复
        </s-btn>
        <input
          ref="fileInputRef"
          type="file"
          accept=".json,application/json,text/plain"
          class="hidden"
          @change="handleFileSelected"
        />
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
    <setting-section title="同步内容与自动策略">
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
      class="rounded-[20px] bg-white dark:bg-[#192231] border border-slate-200/90 dark:border-slate-700/80 shadow-[0_2px_12px_rgba(15,23,42,0.04)] overflow-hidden"
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
  </div>
</template>

<script setup lang="ts">
import { useMessage } from 'naive-ui';
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { type SyncProvider, useCloudSyncStore } from '@/store/modules/cloudSync';
import { useFavoriteStore } from '@/store/modules/favorite';
import {
  formatDurationCompact,
  useListeningStatsStore
} from '@/store/modules/listeningStats';
import { usePlayHistoryStore } from '@/store/modules/playHistory';
import { useUserStore } from '@/store/modules/user';
import { invokeAndroidAsync, isAndroid } from '@/utils/androidBridge';

import SBtn from '../SBtn.vue';
import SettingItem from '../SettingItem.vue';
import SettingSection from '../SettingSection.vue';

const message = useMessage();
const router = useRouter();
const cloudSyncStore = useCloudSyncStore();
const playHistoryStore = usePlayHistoryStore();
const favoriteStore = useFavoriteStore();
const listeningStatsStore = useListeningStatsStore();
const userStore = useUserStore();

const config = cloudSyncStore.config;
const inputSyncCode = ref('');
const showSyncCode = ref(true);
const showAdvanced = ref(false);
const activeAdvancedTab = ref<'supabase' | 'webdav' | 'github'>('supabase');
const importMode = ref<'merge' | 'replace'>('merge');
const showPasteBox = ref(false);
const pastedJson = ref('');
const fileInputRef = ref<HTMLInputElement | null>(null);

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
  const res = await cloudSyncStore.syncNow(false);
  if (res.ok) message.success(res.message);
  else message.error(res.message);
};

const handleExportJsonFile = async () => {
  try {
    const jsonStr = await cloudSyncStore.exportBackupJsonString();
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
      now.getDate()
    ).padStart(2, '0')}`;
    const filename = `xiaopang-music-backup-${stamp}.json`;

    if (isAndroid()) {
      try {
        const res = await invokeAndroidAsync<{ success?: boolean; path?: string }>(
          'save-text-file',
          { filename, content: jsonStr },
          15000
        );
        if (res?.success) {
          message.success(`备份已保存到：${res.path || filename}`, { duration: 4500 });
          return;
        }
      } catch {
        // fallback below
      }
    }

    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    message.success(`已导出备份文件 ${filename}`);
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
        const res = await cloudSyncStore.importBackupJsonString(picked.content, importMode.value);
        if (res.ok) message.success(res.message);
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
    const res = await cloudSyncStore.importBackupJsonString(text, importMode.value);
    if (res.ok) message.success(res.message);
    else message.error(res.message);
  } catch (err: any) {
    message.error(`读取文件失败：${err?.message || '未知错误'}`);
  } finally {
    input.value = '';
  }
};

const handleImportPasted = async () => {
  const res = await cloudSyncStore.importBackupJsonString(pastedJson.value, importMode.value);
  if (res.ok) {
    message.success(res.message);
    pastedJson.value = '';
    showPasteBox.value = false;
  } else {
    message.error(res.message);
  }
};

const formatTime = (ts: number): string => {
  if (!ts) return '';
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return '刚刚';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

onMounted(() => {
  listeningStatsStore.refreshStats();
});
</script>
