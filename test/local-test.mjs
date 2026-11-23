/**
 * 本地真实验证: 不部署 Worker, 直接调用 fetch handler,
 * 转发请求真实打到 api.telegram.org (只用 getMe/getUpdates 只读接口)。
 *
 * 用法: node test/local-test.mjs <BOT_TOKEN>
 */

import http from "node:http";
import { pathToFileURL } from "node:url";

import handler from "../src/worker.js";

const TOKEN = process.argv[2];
if (!TOKEN) {
  console.error("用法: node test/local-test.mjs <BOT_TOKEN>");
  process.exit(1);
}

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}: ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

await check("纯转发: getMe 经 handler 真实到达 Telegram", async () => {
  const req = new Request(`http://localhost/bot${TOKEN}/getMe`);
  const resp = await handler.fetch(req, {});
  const data = await resp.json();
  assert(resp.status === 200, `HTTP ${resp.status}`);
  assert(data.ok === true, `body ok=${data.ok}`);
  assert(data.result.is_bot === true, "result.is_bot != true");
});

await check("纯转发: 带查询串与 POST JSON (getUpdates)", async () => {
  const req = new Request(`http://localhost/bot${TOKEN}/getUpdates?timeout=0`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ limit: 1 }),
  });
  const resp = await handler.fetch(req, {});
  const data = await resp.json();
  assert(resp.status === 200 && data.ok === true, `HTTP ${resp.status} ok=${data.ok}`);
});

await check("白名单: 未登记 token 返回 Telegram 风格 403 JSON", async () => {
  const req = new Request(`http://localhost/bot${TOKEN}/getMe`);
  const resp = await handler.fetch(req, { WHITELIST_ENABLED: "true", ALLOWED_TOKENS: "111111:OTHER" });
  const data = await resp.json();
  assert(resp.status === 403, `HTTP ${resp.status}`);
  assert(data.ok === false && /not allowed/.test(data.description), JSON.stringify(data));
});

await check("白名单: 仅数字 ID 也放行", async () => {
  const numericId = TOKEN.split(":")[0];
  const req = new Request(`http://localhost/bot${TOKEN}/getMe`);
  const resp = await handler.fetch(req, { WHITELIST_ENABLED: "true", ALLOWED_TOKENS: ` ${numericId} ` });
  const data = await resp.json();
  assert(resp.status === 200 && data.ok === true, `HTTP ${resp.status} ${JSON.stringify(data)}`);
});

await check("白名单: file 下载路径同样校验", async () => {
  const req = new Request(`http://localhost/file/bot${TOKEN}/photos/1.jpg`);
  const resp = await handler.fetch(req, { WHITELIST_ENABLED: "true", ALLOWED_TOKENS: "111111:OTHER" });
  const data = await resp.json();
  assert(resp.status === 403 && /not allowed/.test(data.description), JSON.stringify(data));
});

await check("密钥路径: 前缀不符返回 403, 不触达上游", async () => {
  const req = new Request(`http://localhost/bot${TOKEN}/getMe`);
  const resp = await handler.fetch(req, { SECRET_PATH: "s3cret" });
  const data = await resp.json();
  assert(resp.status === 403 && /invalid proxy path/.test(data.description), JSON.stringify(data));
});

await check("密钥路径: 带前缀时剥离前缀正常转发", async () => {
  const req = new Request(`http://localhost/s3cret/bot${TOKEN}/getMe`);
  const resp = await handler.fetch(req, { SECRET_PATH: "s3cret" });
  const data = await resp.json();
  assert(resp.status === 200 && data.ok === true, `HTTP ${resp.status} ${JSON.stringify(data)}`);
});

await check("双重限制同时生效", async () => {
  const req = new Request(`http://localhost/s3cret/bot${TOKEN}/getMe`);
  const resp = await handler.fetch(req, { SECRET_PATH: "s3cret", WHITELIST_ENABLED: "true", ALLOWED_TOKENS: "111111:OTHER" });
  const data = await resp.json();
  assert(resp.status === 403 && /not allowed/.test(data.description), JSON.stringify(data));
});

await check("无效 token 经转发得到 Telegram 真实 401 JSON (而非代理拦截)", async () => {
  const req = new Request("http://localhost/bot111111:FAKE/getMe");
  const resp = await handler.fetch(req, {});
  const data = await resp.json();
  assert(resp.status === 401 && data.ok === false && /Unauthorized/.test(data.description),
    `HTTP ${resp.status} ${JSON.stringify(data)}`);
});

await check("开关: 只配名单不开 WHITELIST_ENABLED 时不拦截", async () => {
  const req = new Request(`http://localhost/bot${TOKEN}/getMe`);
  const resp = await handler.fetch(req, { ALLOWED_TOKENS: "111111:OTHER" });
  const data = await resp.json();
  assert(resp.status === 200 && data.ok === true, `HTTP ${resp.status} ${JSON.stringify(data)}`);
});

await check("开关: WHITELIST_ENABLED=true (大小写不敏感) 开启拦截", async () => {
  const req = new Request(`http://localhost/bot${TOKEN}/getMe`);
  const resp = await handler.fetch(req, { WHITELIST_ENABLED: "True", ALLOWED_TOKENS: "111111:OTHER" });
  assert(resp.status === 403, `HTTP ${resp.status}`);
});

await check("开关: WHITELIST_ENABLED=1 等价开启", async () => {
  const req = new Request(`http://localhost/bot${TOKEN}/getMe`);
  const resp = await handler.fetch(req, { WHITELIST_ENABLED: "1", ALLOWED_TOKENS: "111111:OTHER" });
  assert(resp.status === 403, `HTTP ${resp.status}`);
});

await check("开关: 开启但名单为空时不拦截 (避免锁死)", async () => {
  const req = new Request(`http://localhost/bot${TOKEN}/getMe`);
  const resp = await handler.fetch(req, { WHITELIST_ENABLED: "true", ALLOWED_TOKENS: " , " });
  const data = await resp.json();
  assert(resp.status === 200 && data.ok === true, `HTTP ${resp.status} ${JSON.stringify(data)}`);
});

await check("开关: 关闭 (false) 时即使有名单也不拦截", async () => {
  const req = new Request(`http://localhost/bot${TOKEN}/getMe`);
  const resp = await handler.fetch(req, { WHITELIST_ENABLED: "false", ALLOWED_TOKENS: "111111:OTHER" });
  const data = await resp.json();
  assert(resp.status === 200 && data.ok === true, `HTTP ${resp.status} ${JSON.stringify(data)}`);
});

/** 起一个本地 mock 上游, 返回请求的路径与请求体, 用于 TG_API 覆盖测试 */
async function withMockUpstream(fn) {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, echo_path: req.url, echo_body: body }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

await check("TG_API: 上游地址可经环境变量覆盖", async () => {
  await withMockUpstream(async (base) => {
    const req = new Request(`http://localhost/bot${TOKEN}/getMe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"x":1}',
    });
    const resp = await handler.fetch(req, { TG_API: base });
    const data = await resp.json();
    assert(resp.status === 200 && data.ok === true, `HTTP ${resp.status} ${JSON.stringify(data)}`);
    assert(data.echo_path === `/bot${TOKEN}/getMe`, `path=${data.echo_path}`);
    assert(data.echo_body === '{"x":1}', `body=${data.echo_body}`);
  });
});

await check("TG_API: 尾部斜杠自动归一化", async () => {
  await withMockUpstream(async (base) => {
    const req = new Request(`http://localhost/bot${TOKEN}/getMe`);
    const resp = await handler.fetch(req, { TG_API: `${base}/` });
    const data = await resp.json();
    assert(resp.status === 200 && data.echo_path === `/bot${TOKEN}/getMe`,
      `HTTP ${resp.status} path=${data.echo_path}`);
  });
});

await check("Pages Functions 适配器: onRequest 转交核心 handler", async () => {
  const mod = await import(pathToFileURL("functions/[[path]].js"));
  const resp = await mod.onRequest({
    request: new Request(`http://localhost/bot${TOKEN}/getMe`),
    env: {},
  });
  const data = await resp.json();
  assert(resp.status === 200 && data.ok === true, `HTTP ${resp.status} ${JSON.stringify(data)}`);
});

process.exit(failed ? 1 : 0);
