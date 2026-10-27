/* ==========================================================================
   hacds.com — Cloudflare Worker 反向代理
   --------------------------------------------------------------------------
   为什么需要它：
     后端三个服务都是 Plain HTTP 且没有 CORS 头，而官网是 HTTPS。
     浏览器会以「混合内容」和「CORS」双重原因拦截请求。

   这个 Worker 做三件事：
     1. 提供 HTTPS 入口（Cloudflare 自动签证书）
     2. 补上 CORS 头
     3. 把请求转发到后端的 Plain HTTP 服务

   部署：
     1. 在 Cloudflare Dashboard 建一个 Worker
     2. 粘贴本文件
     3. 在 Settings → Variables 里配置 NODE_ORIGIN / INDEXER_ORIGIN
     4. 绑定自定义域名 api.hacds.com
   ========================================================================== */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    // 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      const r = route(url, env);
      if (r.error) {
        // M-8：构建服务未配置时给出可读原因，而不是把请求打到节点换一个 404
        if (r.error === 'build_service_unconfigured') {
          return json({
            error: 'build_service_unconfigured',
            message: '交易构建服务尚未部署。请在 Wallet 中配置 BUILD_ORIGIN 指向 hacds_build_server。',
          }, 502, cors);
        }
        return json({ error: 'unknown_route', path: url.pathname }, 404, cors);
      }
      const { origin, path } = r;
      if (!origin) {
        return json({ error: 'unknown_route', path: url.pathname }, 404, cors);
      }

      // 构造转发请求
      const target = origin.replace(/\/$/, '') + path;
      const init = {
        method: request.method,
        headers: {
          // 只透传必要头，避免把 Cloudflare 的 CF-* 头带给后端
          'Content-Type': request.headers.get('Content-Type') || 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'hacds.com-worker/1.0',
        },
        // GET/HEAD 不带 body
        body: (request.method === 'GET' || request.method === 'HEAD')
          ? undefined
          : await request.text(),
      };

      const res = await fetch(target, init);
      const body = await res.text();

      return new Response(body, {
        status: res.status,
        headers: {
          ...cors,
          'Content-Type': res.headers.get('Content-Type') || 'application/json',
          'Cache-Control': cacheHeader(url.pathname),
        },
      });
    } catch (e) {
      return json({ error: 'upstream_failed', message: String(e) }, 502, cors);
    }
  },
};

/* ---------- 路由 ---------- */

function route(url, env) {
  const p = url.pathname;
  const NODE = env.NODE_ORIGIN;
  const IDX = env.INDEXER_ORIGIN;

  // 交易构建（后端 txbuild 服务）
  //
  // ⚠ M-8：原实现 `env.BUILD_ORIGIN || NODE` 在未配置时会把请求转发给
  //   Hacash **节点**，而节点没有 /api/build 路由 → 404，且错误信息与
  //   "服务未部署" 完全无关，很难排查。
  //   现在未配置就明确报错（502 + 可读原因），由下面的 handler 处理。
  if (p === '/api/build') {
    if (!env.BUILD_ORIGIN) return { error: 'build_service_unconfigured' };
    return { origin: env.BUILD_ORIGIN, path: '/api/build' };
  }

  // 索引器
  // 索引器：清算台名单 + 积分覆盖率监控
  if (p === '/api/watchlist') {
    return { origin: IDX, path: '/watchlist' };
  }
  if (p === '/api/snapshot') {
    return { origin: IDX, path: '/snapshot' };
  }
  // 运维监控：合约内部积分 vs 真实链上余额（见索引器 /backing）
  if (p === '/api/backing') {
    return { origin: IDX, path: '/backing' };
  }

  // HACD 详情（由索引器或节点提供）
  if (p === '/api/diamond/details') {
    return { origin: IDX, path: '/api/diamond/details' };
  }

  // 其余全部转发给节点
  return { origin: NODE, path: p + (url.search || '') };
}

/* ---------- CORS ---------- */

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';

  // 允许的域名：主站 + 本地开发
  const allowed = (env.ALLOWED_ORIGINS || 'https://hacds.com,https://www.hacds.com')
    .split(',').map(s => s.trim());

  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const allow = (allowed.includes(origin) || isLocal) ? origin : allowed[0];

  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

/* ---------- 缓存 ---------- */

function cacheHeader(path) {
  // 区块高度、余额这类实时数据不缓存
  if (/height|balance|transaction|sandboxcall|pool_summary/.test(path)) {
    return 'no-store';
  }
  // HACD 列表变化慢，缓存 60 秒减轻后端压力
  if (/diamond/.test(path)) return 'public, max-age=60';
  return 'no-store';
}

/* ---------- 工具 ---------- */

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
