/**
 * Cloudflare Pages Functions 适配器: 将所有路径请求转交核心 handler。
 * 与 Workers 部署共享 src/worker.js 同一份逻辑, 环境变量语义完全一致。
 * [[path]] 为 catch-all 路由: 静态资源 (public/) 优先, 其余路径进本函数。
 */
import handler from "../src/worker.js";

export const onRequest = (context) => handler.fetch(context.request, context.env);
