# tgbot-proxy

🌐 部署在 Cloudflare Workers 上的 **Telegram Bot API 反向代理**，让国内等无法直连 `api.telegram.org` 的环境正常使用 Telegram Bot。

纯转发设计：请求原样透传到 Telegram API，**支持任意 Bot**（区别于绑定单一 token 白名单的反代）。可选启用 Token 白名单 / 密钥路径两种访问控制。

## 为什么需要它

Telegram Bot API 的鉴权 Token 直接拼在 URL 路径里（`/bot<token>/方法名`），任何支持**自定义 API 地址**的 Telegram Bot 客户端 / SDK 都能直接使用本 Worker：

- Bot 框架或 SDK：传给 `baseApiUrl` / `api_base` / `apiBase` / `API 基础地址` 等等价参数
- 手写 HTTP 调用：把 `https://api.telegram.org` 替换为 Worker 地址即可，路径与参数不变

即：`https://api.telegram.org/bot<token>/getMe` → `https://<你的worker域名>/bot<token>/getMe`。

## 部署

核心逻辑只有一份（[`src/worker.js`](src/worker.js)），Workers 与 Pages 两种部署方式行为完全一致，任选其一。

### 方式一：Workers（推荐）

**Dashboard 粘贴（最快）**

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create Worker**，名字随意（如 `tgbot-proxy`）
2. 点击 **Deploy** 后进入 **Edit code**，把 [`src/worker.js`](src/worker.js) 内容整段粘贴覆盖，再次 **Deploy**
3. （可选）绑定自定义域名：Worker → **Settings** → **Domains & Routes** → **Add** → **Custom domain**

完成。Worker 地址形如 `https://tgbot-proxy.<你的子域>.workers.dev`。

**Wrangler CLI**

```bash
npm i -g wrangler
wrangler login
wrangler deploy
```

### 方式二：Pages

适合偏好 Git 工作流、或想在同域名下附带静态页的场景：

**Git 集成**：Pages → Create application → Connect to Git 选中本仓库 → Framework preset 选 `None`，Build command 留空，Build output directory 填 `public` → Save and Deploy。仓库根的 [`functions/[[path]].js`](functions/[[path]].js) 会自动作为全路径 API 处理器，[`public/index.html`](public/index.html) 为占位主页。

**Wrangler CLI**：仓库根执行

```bash
wrangler pages deploy public
```

Pages 的环境变量在 Pages 项目 → **Settings** → **Environment variables** 中设置，语义与 Workers 一致。

## 访问控制（可选，建议至少启用一种）

Worker 默认对所有人开放转发。公开的转发代理可能被他人滥用刷请求、消耗你的 CF 免费额度，**建议至少启用一种限制**。

变量统一在 Worker → **Settings** → **Variables and Secrets**（Pages 项目为 Settings → **Environment variables**，或 `wrangler.toml` 的 `[vars]`）中设置。

**白名单（Token 校验）**——⚠️ 需要下面两个变量**同时配置**才会生效：

| 变量 | 说明 |
| --- | --- |
| `WHITELIST_ENABLED` | **总开关**：填 `true` / `1` / `on` / `yes` **任选其一**（四种写法完全等价，大小写不敏感）即开启；填 `false` / `0` / `off` / `no`、留空或删除变量则关闭。名单可长期保留，随时切换模式 |
| `ALLOWED_TOKENS` | Bot Token 白名单，逗号分隔；支持完整 Token 或仅数字 ID，如 `123456:AAAxxx, 789012` |

> ⚠️ **只开开关、名单为空 = 仍然对所有人生效**（防锁死设计：避免误配把自己也锁在门外）。判断白名单是否真正生效，唯一可靠的方式是配置后用假 token 验证：
>
> ```bash
> curl https://<你的worker地址>/bot111111:FAKE/getMe
> ```
>
> 返回 `{"ok":false,"error_code":403,"description":"Forbidden: bot token not allowed"}` 即已锁上。

**密钥路径**——单独生效，可与白名单叠加（双因子）：

| 变量 | 说明 |
| --- | --- |
| `SECRET_PATH` | 密钥路径前缀，如 `my-secret-path`；启用后访问地址变为 `https://<worker>/my-secret-path/bot<token>/<方法>`（前缀转发前剥离，对上游透明） |

**上游定制**：

| 变量 | 说明 |
| --- | --- |
| `TG_API` | 上游 Bot API 地址，默认 `https://api.telegram.org`；可指向自建 [telegram-bot-api-server](https://github.com/tdlib/telegram-bot-api) 等兼容服务 |

未通过校验时按 Telegram API 的 JSON 错误格式返回 `{"ok":false,"error_code":403,...}`，客户端日志可正常解析。

## 本地测试

不部署也能真实验证转发逻辑（直接调用 handler，请求真实打到 Telegram，只用只读接口）：

```bash
node test/local-test.mjs <你的BOT_TOKEN>
```

## 验证部署

```bash
curl https://<你的worker地址>/bot<TOKEN>/getMe
```

返回 `{"ok":true,"result":{...}}` 即部署成功。

## 许可证

[MIT](LICENSE)
