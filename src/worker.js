/**
 * Telegram Bot API 反代 (Cloudflare Workers / Pages 共用核心)
 *
 * 将请求原样转发到 Telegram Bot API, 用于国内等无法直连 Telegram 的环境。
 * 默认放行所有 Bot Token (纯转发); 可通过环境变量开启访问控制与定制上游:
 *
 *   WHITELIST_ENABLED  Token 白名单总开关, 填 "true"/"1"/"on"/"yes" 任选其一
 *                      (完全等价, 大小写不敏感) 视为开启, 其余均视为关闭;
 *                      名单 ALLOWED_TOKENS 可长期保留, 开关随时切换白名单模式。
 *   ALLOWED_TOKENS     Bot Token 白名单 (逗号分隔完整 Token 或仅数字 ID)。
 *   SECRET_PATH        密钥路径前缀; 未设置 = 不启用。
 *                      启用后访问地址变为 https://<worker>/{SECRET_PATH}/bot<token>/<method>,
 *                      前缀在转发前剥离, 对上游 API 透明。
 *   TG_API             上游 Bot API 地址; 默认 https://api.telegram.org,
 *                      可指向自建 bot-api-server 等兼容服务。
 *
 * 白名单与密钥路径可同时启用 (先校验路径前缀, 再校验 Token)。
 * 未通过校验时按 Telegram API 的 JSON 错误格式返回, 客户端可统一解析。
 */

const TG_API_DEFAULT = "https://api.telegram.org";

/** 按 Telegram API 错误格式构造 JSON 响应 */
function tgError(status, description) {
  return new Response(JSON.stringify({ ok: false, error_code: status, description }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** 解析环境变量为去空白后的非空列表 */
function parseList(value) {
  return (value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 开关型环境变量解析: "true"/"1"/"on"/"yes" (大小写不敏感) 视为开启 */
function switchEnabled(value) {
  return /^(true|1|on|yes)$/i.test((value || "").trim());
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let path = url.pathname;

    // 1) 密钥路径前缀 (可选)
    const secretPath = (env.SECRET_PATH || "").replace(/^\/+|\/+$/g, "");
    if (secretPath) {
      const prefix = `/${secretPath}/`;
      if (!path.startsWith(prefix)) {
        return tgError(403, "Forbidden: invalid proxy path");
      }
      path = path.slice(prefix.length - 1); // 保留前导 "/" (转发给上游的路径)
    }

    // 2) Bot Token 白名单 (WHITELIST_ENABLED 开启且名单非空时生效)
    //    匹配 /bot<token>/ 与文件下载路径 /file/bot<token>/ 两种形态
    const whitelist = switchEnabled(env.WHITELIST_ENABLED)
      ? parseList(env.ALLOWED_TOKENS)
      : [];
    if (whitelist.length) {
      const m = path.match(/^\/(?:file\/)?bot([^/]+)\//);
      const token = m ? m[1] : "";
      const numericId = token.split(":")[0];
      if (!token || !(whitelist.includes(token) || whitelist.includes(numericId))) {
        return tgError(403, "Forbidden: bot token not allowed");
      }
    }

    // 3) 原样转发: 方法、头、请求体、查询串全部保留 (new Request(url, request) 继承全部)
    const tgApi = (env.TG_API || TG_API_DEFAULT).replace(/\/+$/, "");
    const upstream = tgApi + path + url.search;
    try {
      return await fetch(new Request(upstream, request));
    } catch (e) {
      return tgError(502, `Bad Gateway: upstream fetch failed (${e.message})`);
    }
  },
};
