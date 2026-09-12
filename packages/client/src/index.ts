/**
 * `@dslegal/client-ui` 的 host 侧半边（P1 骨架）。
 *
 * DSH 中一个 client 插件包同时包含两半：
 * - `lib/index.js` —— host 侧（Node），可注册服务、解析配置；
 * - `lib/client.js` —— client 侧（浏览器），把 UI 注册进插槽（Slots）。
 *
 * P4 之前两者均无实际逻辑。
 */

import type { Context } from '@deepseek-ai/cordis'

export const name = 'dslegal-client'

export function apply(_ctx: Context): void {
  // P1 骨架：不注册任何服务或副作用。
}
