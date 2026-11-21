/**
 * 小庞奶娃音乐 - 「一键同步口令」默认云端配置（Supabase 免费版）
 *
 * 填入 Supabase 的 Project URL 与公开 anon/publishable key 后，
 * 所有普通用户打开「云同步」即可直接 1 键生成同步口令使用，无需填写任何服务器参数。
 * （表已开启严格 RLS 隔离，且用户数据在客户端进行 AES-256-GCM 端到端加密。）
 */
export const BUILTIN_QUICK_SYNC_CONFIG = {
  supabaseUrl: 'https://pylqgtrhbrbabxrdtkyq.supabase.co',
  supabaseAnonKey: 'sb_publishable_JfxLSDm203l0aasuB8JMmQ_LuPO8N1D'
};

export function hasBuiltinQuickSync(): boolean {
  return Boolean(
    BUILTIN_QUICK_SYNC_CONFIG.supabaseUrl.trim() &&
      BUILTIN_QUICK_SYNC_CONFIG.supabaseAnonKey.trim()
  );
}
