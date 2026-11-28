export interface ReleaseAnnouncementItem {
  title: string;
  detail: string;
}

export interface ReleaseAnnouncementSection {
  id: string;
  title: string;
  icon: string;
  accent: 'amber' | 'sky' | 'emerald' | 'indigo';
  items: ReleaseAnnouncementItem[];
}

export interface ReleaseAnnouncement {
  id: string;
  version: string;
  date: string;
  period: string;
  title: string;
  subtitle: string;
  sections: ReleaseAnnouncementSection[];
}

export const RELEASE_ANNOUNCEMENTS: readonly ReleaseAnnouncement[] = [
  {
    id: '2026-11-27-update',
    version: '1.1.0',
    date: '2026-11-28',
    period: '2026-11-24 ~ 2026-11-28',
    title: '近期体验与稳定性大升级',
    subtitle: '围绕「少打扰、少选择、少失败感」，汇总 2026-11-24 至 2026-11-28 的全部重点改进',
    sections: [
      {
        id: 'playback-sources',
        title: '播放与音源升级',
        icon: 'ri-music-2-fill',
        accent: 'amber',
        items: [
          {
            title: '拦截酷我 11 秒短提示音',
            detail: '提高音频大小拦截门槛至 800KB 并清理疑似试听/提示音，自动触发脏缓存驱逐与重选可用源'
          },
          {
            title: '备用源智能打分防串歌 / Live',
            detail: '综合歌名、歌手、版本标记与时长匹配打分，尽量避开串歌、Live 现场和伴奏错配，并支持代理 / FakeIP 兼容'
          },
          {
            title: '自定义 LX 音源支持',
            detail: '支持在高级设置中导入和管理自定义 LX 音源脚本，按严格 HTTPS 与公网安全策略参与音源解析'
          },
          {
            title: '切歌缓冲加载圈与封面预加载',
            detail: '切歌或重试音源时展示清晰缓冲加载圈，封面图绑定独立键值避免残留旧图，并后台预加载下一首封面'
          },
          {
            title: '播放失败统一收口与一键「搜其他版本」',
            detail: '屏蔽底层错误码并合并连续切源提示；若全部音源不可用，提示条附带「搜其他版本」快捷跳转搜索'
          },
          {
            title: '离线安静模式',
            detail: '断网时不反复弹出网络报错，顶部展示低干扰常驻轻提示，并在列表与队列中区分本地/已缓存与在线不可播曲目'
          }
        ]
      },
      {
        id: 'mobile-system',
        title: '移动端与系统级增强',
        icon: 'ri-smartphone-line',
        accent: 'sky',
        items: [
          {
            title: '锁屏 / 通知栏红心收藏与桌面歌词按钮',
            detail: 'Android 13+ 系统媒体控制卡片直接提供「红心收藏」与「桌面歌词」快捷操作，与客户端状态双向同步'
          },
          {
            title: '音频缓存上限 200MB–2GB 可配',
            detail: '可在设置中自由选择 200MB / 500MB / 1GB / 2GB 缓存上限，兼顾离线收听与机身存储空间'
          },
          {
            title: '横屏自动隐藏桌面歌词开关',
            detail: '默认保持关闭，开启后在切入横屏视频或游戏时自动暂隐悬浮歌词，切回竖屏自动恢复'
          },
          {
            title: '蓝牙耳机 / 车机重连自动续播',
            detail: '支持按需开启蓝牙音频设备重连自动续播，连上耳机或车机即可顺滑接续播放'
          }
        ]
      },
      {
        id: 'ui-ux',
        title: '界面减负与顺手操作',
        icon: 'ri-sparkling-2-fill',
        accent: 'emerald',
        items: [
          {
            title: '深色炭黑主题全面修复',
            detail: '消除异常暗色覆盖样式并统一炭黑卡片层级，改善深色模式下的文字对比度与观感'
          },
          {
            title: '省电模式（减少动态效果）',
            detail: '支持关闭黑胶持续旋转、动态背景光效与重模糊效果以节省电量，并自动尊重系统减少动效设置'
          },
          {
            title: '「我的音乐」统一入口与曲目来源标签',
            detail: '将收藏、已下载、手机音乐、最近播放与歌单聚拢于同一视图，并统一标识本地 / 已下载 / 已缓存 / 在线来源'
          },
          {
            title: '播放队列「播完当前停止」与「仅清空后续」',
            detail: '队列抽屉顶部补充定时播完暂停开关，并支持保留正在播放曲目仅清空后续队列'
          },
          {
            title: '设置页常用 / 高级分层',
            detail: '常用设置保持精简直观；LX 自定义音源、网络代理、桌面歌词细项样式与诊断工具收纳进高级设置'
          },
          {
            title: '云同步状态时间与合并前预览',
            detail: '显示上次成功同步相对时间，同步前展示新增收藏/历史/歌单摘要与可展开差异预览'
          },
          {
            title: '新用户极简 3 步引导',
            detail: '首次打开仅询问偏好主题、云同步与本地扫描（仅 Android），老用户自动跳过不打扰'
          },
          {
            title: '账号切换与退出登录增强',
            detail: '支持更顺滑地切换账号或安全退出登录，并在退出时同步清理原生会话 Cookie'
          },
          {
            title: '网易云快捷登录与 B 站 / QQ 音乐独立绑定',
            detail: '新增手机号短信验证码登录及二维码保存相册 / 一键唤起客户端；支持 B 站扫码与 QQ 音乐扫码或手动 Cookie 独立绑定、收藏夹/歌单导入与音源解析增强，解绑绝不影响网易云主账号'
          },
          {
            title: '跨平台歌单导入（分享链接 / 纯文本）',
            detail: '可在「我的音乐 → 歌单」粘贴汽水 / QQ / 酷狗 / 酷我 / 网易云分享链接或纯文本列表，并发控速防串歌匹配并预览确认，一键生成自建歌单且自动参与云同步'
          }
        ]
      },
      {
        id: 'stability-security',
        title: '稳定性与安全加固',
        icon: 'ri-shield-check-fill',
        accent: 'indigo',
        items: [
          {
            title: '音频缓存损坏自愈',
            detail: '启动检查与播放读取时自动识别并清理异常、过小或损坏缓存文件，避免长期卡死在同一脏缓存'
          },
          {
            title: '关于页一键查看 / 复制崩溃日志',
            detail: '记录最近异常闪退现场并自动脱敏 Cookie 与同步密钥，方便一键复制反馈排查问题'
          },
          {
            title: 'WebView 严格 HTTPS 与混合内容拦截',
            detail: '外部封面及媒体链接统一升级为 HTTPS，Android WebView 收紧为严格禁止 HTTP/HTTPS 混合内容'
          },
          {
            title: 'SSRF、分级限流与发布健康门禁',
            detail: '强化服务端与 LX 请求公网地址/重定向安全校验、云同步接口分级限流，以及生产发布健康检查'
          },
          {
            title: 'HTTP 301 会话核验防误退与冷启动恢复',
            detail: '遇 HTTP 301 先通过防并发会话核验确认有效态，避免网络波动或启动竞态误清空登录态；Android 冷启动优先从安全加密区恢复 Cookie，并完善多平台绑定与外链导入的 SSRF 白名单拦截与日志脱敏'
          }
        ]
      }
    ]
  }
];

export const LATEST_ANNOUNCEMENT: ReleaseAnnouncement = RELEASE_ANNOUNCEMENTS[0];
