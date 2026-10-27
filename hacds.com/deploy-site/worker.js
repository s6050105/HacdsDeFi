/* ==========================================================================
   hacds.com 静态站 Worker
   --------------------------------------------------------------------------
   静态资源由 assets 绑定返回，这个脚本负责三件事：

     1. HTTP → HTTPS 301
     2. www.hacds.com → hacds.com 301（避免重复内容）
     3. 给静态响应补安全头

   为什么不用 Cloudflare 的「Always Use HTTPS」：
     那是 zone 级设置，需要 `zone_settings:edit` 权限。wrangler 的
     OAuth token 只有 `zone:read`，调 API 返回 10000 Authentication error。
     放在 Worker 里效果相同，而且跟着代码走、可审计、可 diff。

   ⚠ 关键：wrangler.jsonc 里必须有 `"run_worker_first": true`。
     否则静态资源会**直接命中** assets、绕过这个 Worker —— 表现是
     页面能开、`_headers` 生效，但重定向完全不触发。
     这个坑实测踩过一次（2026-10-28）。

   部署：
     cd deploy-site && wrangler deploy --cwd .
   ========================================================================== */

const CANONICAL_HOST = 'hacds.com';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ① HTTP → HTTPS（DeFi 站点，用户要签名交易，明文必须掐掉）
    if (url.protocol === 'http:') {
      url.protocol = 'https:';
      url.host = CANONICAL_HOST;
      return Response.redirect(url.toString(), 301);
    }

    // ② www → 主域
    if (url.host !== CANONICAL_HOST) {
      url.host = CANONICAL_HOST;
      return Response.redirect(url.toString(), 301);
    }

    // ③ 静态资源
    const res = await env.ASSETS.fetch(request);

    // ④ 补安全头（保留 assets 已给的头，只覆盖需要的那几个）
    const out = new Response(res.body, res);
    const h = out.headers;

    h.set('X-Content-Type-Options', 'nosniff');
    h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    h.set('X-Frame-Options', 'SAMEORIGIN');
    h.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
    h.set('Cross-Origin-Opener-Policy', 'same-origin');

    return out;
  },
};
