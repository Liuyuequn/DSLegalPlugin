/**
 * @dslegal/core —— DSLegalPlugin 领域核心。
 *
 * 纯逻辑、可独立发布与复用；唯一的运行时依赖是 `lunar-javascript`（农历 / 节气 /
 * 法定节假日，见 `almanac.ts`），不碰文件系统、不碰 DSH 平台。
 * 数据契约见 `maintenance/2. DSLegalPlugin 数据约定规范.md`。
 */

export * from './model.js'
export * from './convention.js'
export * from './parse.js'
export * from './format.js'
export * from './write.js'
export * from './query.js'
export * from './almanac.js'
