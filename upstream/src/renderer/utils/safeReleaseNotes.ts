/**
 * 安全更新日志解析器：将 Markdown / 纯文本 Release Notes 拆分为纯文本结构化节点，
 * 彻底剥离任何 HTML 标签、内联事件（onerror/onload）、<script>/<iframe> 与 javascript:/data: URL，
 * 配合 Vue {{ ... }} 文本插值彻底根绝 v-html XSS 风险。
 */

export interface SafeReleaseNoteBlock {
  type: 'heading' | 'bullet' | 'paragraph';
  text: string;
  level?: number;
}

const DANGEROUS_SCHEME_RE = /^\s*(javascript|vbscript|data):/i;

export function sanitizeInlineReleaseText(input: string): string {
  if (!input) return '';

  let text = String(input);

  // 移除成对危险标签及其内容
  text = text.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, '');
  text = text.replace(/<svg[\s\S]*?>[\s\S]*?<\/svg>/gi, '');

  // 将 Markdown 图片 ![alt](url) 收敛为 alt 文本
  text = text.replace(/!\[([^\]]*)\]\(([^)]*)\)/g, (_m, alt) => String(alt || '').trim());

  // 处理 Markdown 链接 [label](url)：阻断 javascript:/vbscript:/data: 协议，仅保留安全链接或纯文本
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, rawUrl) => {
    const cleanLabel = String(label || '').trim();
    const cleanUrl = String(rawUrl || '').trim();
    if (!cleanUrl || DANGEROUS_SCHEME_RE.test(cleanUrl)) {
      return cleanLabel;
    }
    if (/^https?:\/\//i.test(cleanUrl)) {
      return cleanLabel === cleanUrl ? cleanLabel : `${cleanLabel} (${cleanUrl})`;
    }
    return cleanLabel;
  });

  // 剥离所有残留 HTML 标签（含未闭合尖括号形式如 <img src=x onerror=alert(1)>）
  text = text.replace(/<\/?[a-zA-Z][^>]*>?/g, '');
  // 清除裸露的危险 URI 协议片段
  text = text.replace(/\b(?:javascript|vbscript|data)\s*:/gi, '');

  // 剥离常见 Markdown 行内强调标记，保持可读性
  text = text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1');

  return text.trim();
}

export function parseSafeReleaseNotes(raw?: string | null): SafeReleaseNoteBlock[] {
  if (!raw || typeof raw !== 'string') return [];

  const blocks: SafeReleaseNoteBlock[] = [];
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // 分割线跳过
    if (/^[-*_]{3,}$/.test(trimmed)) continue;

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const clean = sanitizeInlineReleaseText(headingMatch[2]);
      if (clean) {
        blocks.push({
          type: 'heading',
          level: headingMatch[1].length,
          text: clean
        });
      }
      continue;
    }

    const bulletMatch = trimmed.match(/^(?:[-*+]|\d+\.)\s+(.+)$/);
    if (bulletMatch) {
      const clean = sanitizeInlineReleaseText(bulletMatch[1]);
      if (clean) {
        blocks.push({
          type: 'bullet',
          text: clean
        });
      }
      continue;
    }

    const clean = sanitizeInlineReleaseText(trimmed);
    if (clean) {
      blocks.push({
        type: 'paragraph',
        text: clean
      });
    }
  }

  return blocks;
}
