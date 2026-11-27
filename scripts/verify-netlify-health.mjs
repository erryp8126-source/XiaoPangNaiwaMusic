import { pathToFileURL } from 'node:url';

/**
 * 规范化 Netlify 健康检查地址为标准 /api/health URL，并提取 Origin 头部
 */
export function resolveHealthEndpoint(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) {
    throw new Error('NETLIFY_HEALTH_URL is required');
  }
  const parsed = new URL(trimmed);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Unsupported protocol for health check URL: ${parsed.protocol}`);
  }
  const cleanPath = parsed.pathname.replace(/\/+$/, '');
  if (!cleanPath || cleanPath === '') {
    parsed.pathname = '/api/health';
  } else if (cleanPath === '/api') {
    parsed.pathname = '/api/health';
  } else if (!cleanPath.endsWith('/api/health')) {
    parsed.pathname = cleanPath;
  }
  return {
    healthUrl: parsed.toString(),
    origin: parsed.origin
  };
}

/**
 * 校验 /api/health 返回的 version 与 7 位 commit 指纹是否与当前源码和提交一致
 */
export function validateHealthPayload(payload, expected) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'Health response body is not a JSON object' };
  }
  if (payload.ok !== true) {
    return { ok: false, reason: `Expected ok=true, received ok=${String(payload.ok)}` };
  }

  const expectedVersion = String(expected?.version || '').trim();
  const actualVersion = String(payload.version || '').trim();
  if (!expectedVersion || actualVersion !== expectedVersion) {
    return {
      ok: false,
      reason: `Version mismatch: expected "${expectedVersion}", received "${actualVersion}"`
    };
  }

  const expectedCommit = String(expected?.commit || '').trim().toLowerCase();
  const actualCommit = String(payload.commit || '').trim().toLowerCase();
  if (!expectedCommit || expectedCommit.length !== 7) {
    return {
      ok: false,
      reason: `Expected 7-char short commit hash, received "${expectedCommit}"`
    };
  }
  if (!actualCommit || actualCommit === 'local' || actualCommit !== expectedCommit) {
    return {
      ok: false,
      reason: `Commit mismatch: expected "${expectedCommit}", received "${actualCommit || '(empty)'}"`
    };
  }

  return { ok: true };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCli() {
  const rawHealthUrl = process.env.NETLIFY_HEALTH_URL || '';
  const expectedVersion = String(process.env.EXPECTED_VERSION || '').trim();
  const rawSha = String(process.env.EXPECTED_COMMIT || process.env.GITHUB_SHA || '').trim();
  const expectedCommit = rawSha.slice(0, 7);
  const apiSecret = String(process.env.APP_API_SECRET || '').trim();
  const maxAttempts = Math.max(1, Number(process.env.HEALTH_MAX_ATTEMPTS || 12) || 12);
  const retryDelayMs = Math.max(500, Number(process.env.HEALTH_RETRY_DELAY_MS || 10000) || 10000);

  if (!rawHealthUrl) {
    console.error('[netlify-health-gate] Missing NETLIFY_HEALTH_URL');
    process.exit(1);
  }
  if (!expectedVersion) {
    console.error('[netlify-health-gate] Missing EXPECTED_VERSION');
    process.exit(1);
  }
  if (expectedCommit.length !== 7) {
    console.error(`[netlify-health-gate] Expected 7-char commit SHA, got "${expectedCommit}"`);
    process.exit(1);
  }

  const { healthUrl, origin } = resolveHealthEndpoint(rawHealthUrl);
  const headers = {
    Origin: origin,
    Accept: 'application/json',
    'Cache-Control': 'no-cache'
  };
  if (apiSecret) {
    headers['X-App-Api-Key'] = apiSecret;
  }

  let lastReason = 'Unknown error';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(healthUrl, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(15000)
      });
      const text = await res.text();
      if (!res.ok) {
        lastReason = `HTTP ${res.status}: ${text.slice(0, 200)}`;
      } else {
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          lastReason = `Invalid JSON response: ${text.slice(0, 200)}`;
        }
        if (json) {
          const check = validateHealthPayload(json, {
            version: expectedVersion,
            commit: expectedCommit
          });
          if (check.ok) {
            console.log(
              `[netlify-health-gate] PASS (${healthUrl}) -> version=${json.version}, commit=${json.commit}`
            );
            return;
          }
          lastReason = check.reason || 'Payload validation failed';
        }
      }
    } catch (err) {
      lastReason = err?.message || String(err);
    }

    console.log(
      `[netlify-health-gate] Attempt ${attempt}/${maxAttempts} failed (${lastReason})`
    );
    if (attempt < maxAttempts) {
      await sleep(retryDelayMs);
    }
  }

  console.error(
    `[netlify-health-gate] FAIL: ${healthUrl} did not match version=${expectedVersion} & commit=${expectedCommit} (${lastReason})`
  );
  process.exit(1);
}

const isEntrypoint =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  await runCli();
}
