# 小庞奶娃音乐 · 「一键同步口令」Supabase 免费部署指南（2 分钟完成）

> 完全免费、免买域名、国内直连可用、支持 Android / iOS / Safari 网页版三端零跨域同步。
> 用户数据在手机端使用同步口令进行 **AES-256-GCM 端到端加密**，Supabase 仅保存哈希 ID 与密文。

## 第 1 步：创建免费项目
1. 打开 [https://supabase.com](https://supabase.com)，点击 **Start your project** → 使用 **GitHub 账号一键登录**（无需绑定银行卡）。
2. 点击 **New project**：
   - **Name**: `xiaopang-music-sync`
   - **Database Password**: 随便生成一个强密码保存好
   - **Region**: 强烈推荐选 **Northeast Asia (Tokyo)** 或 **Southeast Asia (Singapore)**（国内访问最快）
   - **Plan**: 保持免费的 **Free ($0/month)**
3. 等待约 1 分钟项目初始化完成。

## 第 2 步：建表与创建安全同步接口
1. 在左侧菜单点击 **SQL Editor** → **New query**。
2. 复制本目录下 [schema.sql](./schema.sql) 的全部 SQL 内容粘贴进去，点击右下角 **Run**。
3. 看到 `Success. No rows returned` 即初始化成功。

## 第 3 步：获取项目 URL 和公开 Key
1. 在左侧菜单点击 **Project Settings（齿轮图标）** → **API**（或新版界面 **Data API** / **API Keys**）。
2. 复制以下两项：
   - **Project URL**：形如 `https://abcdefghijklmno.supabase.co`
   - **anon / publishable public key**：形如 `eyJhbGciOiJIUzI1NiIs...` 或 `sb_publishable_...`（注意：千万不要复制 `service_role` / `secret` key！）
3. 填入 `upstream/src/renderer/config/quickSyncConfig.ts` 中的 `BUILTIN_SUPABASE_URL` 与 `BUILTIN_SUPABASE_ANON_KEY`，重新构建即可让所有普通用户**零配置一键使用同步口令**！

## 第 4 步（可选）：防休眠自动保活
Supabase 免费版如果连续 7 天没有任何请求会自动休眠。在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中添加：
- `SUPABASE_SYNC_URL`：你的 Project URL
- `SUPABASE_SYNC_ANON_KEY`：你的 anon public key

仓库内的 `.github/workflows/keep-sync-alive.yml` 会每 3 天自动调用一次 `ping_sync`，保持服务永久在线。
