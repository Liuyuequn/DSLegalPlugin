import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  // 本包为 "type": "module"，固定扩展名会强制 .mjs；关掉后按包类型输出 .js / .d.ts，
  // 与 package.json 的 main / types / exports 声明一致（也是 DSH 官方包的约定）。
  fixedExtension: false,
  /**
   * 把 `lunar-javascript` **内联**进 `lib/index.js`。
   *
   * 本包是**复制构建产物**装进 DSH profile 的（见 AGENTS.md「profile 安装方式」），
   * 不是 `pnpm add` 装的。若保持 external，profile 里就得额外放一份
   * `node_modules/lunar-javascript`——漏了这一步的后果是 host 插件 import 期直接
   * `ERR_MODULE_NOT_FOUND`，插件整体加载失败、面板消失。内联后 core 的这个产物自足。
   *
   * 代价是 `lib/index.js` 从 35KB 涨到约 470KB。这是刻意的取舍：农历换算宁可多占几百 KB，
   * 也不能自己手搓一套近似的历法算错日期。
   */
  noExternal: ['lunar-javascript'],
  dts: true,
  sourcemap: true,
  clean: true,
})
