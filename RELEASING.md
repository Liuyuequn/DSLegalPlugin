# 发布流程（维护者）

本仓库是 **pnpm monorepo，但只发布一个包**：`packages/app` → npm 上的 **`dsh-legal-schedule`**。
`core` / `host` / `client` 是内部包（`private`，从不发布），它们的代码在构建时被**内联**进 `app` 的产物。

---

## 0. 发布前必须成立的三条不变量

1. **`dsh-legal-schedule` 的 `dependencies` 必须为空。** 三个内部包只出现在 `devDependencies`。否则 `pnpm publish` 会把 `workspace:*` 改写成 `@dslegal/core@0.0.0` 这类不存在的版本，**用户安装必然失败**。
2. **两半产物自足**：`lib/index.js` 的外部依赖只允许 `node:*`；`lib/client.js` 只允许 `react`、`react/jsx-runtime`。
3. **`react` 必须在 `peerDependencies`**（peer 默认 external）。放进 devDependencies 会让打包器**把 React 内联**进浏览器产物（体积 +100 KB 且不报错）。

前两条由 `packages/app/test/plugin.test.ts` 的 11 项守卫钉住；第 3 条由"浏览器面只 require react"那条断言间接钉住。**发布前跑一次测试，别凭记忆。**

---

## 1. 一次性准备

```powershell
# ① 先确认 registry 是官方源（是镜像就发布不了，见 2.5）
npm config get registry          # 必须是 https://registry.npmjs.org/

# ② 登录（首次；本机走浏览器授权，见 2.5）
npm login
npm whoami                       # 应打印 npm 用户名；报 ENEEDAUTH 说明还没登录

# ③ 确认要发布的包名没被别人占
npm view dsh-legal-schedule version 2>$null; if ($LASTEXITCODE -ne 0) { "名字可用" }
```

仓库地址已写进 `packages/app/package.json` 的 `repository` / `homepage` / `bugs`。若仓库改名或转移，**先改这三处再发布**（npm 页面的链接与 provenance 都依赖它）。

---

## 2. 每次发布

```powershell
cd packages\app

# ① 改版本号（语义化：新功能次版本 +1；兼容性修复修订号 +1）
#    只改这一个包，其余三个内部包保持 0.0.0 不动
npm version 0.1.1 --no-git-tag-version

# ② 回到仓库根，全量验证
cd ..\..
corepack pnpm typecheck
corepack pnpm test

# ③ 构建
corepack pnpm --filter dsh-legal-schedule build

# ④ 干跑：看清将要发布的内容（sourcemap 不应出现）
cd packages\app
corepack pnpm exec npm pack --dry-run

# ⑤ 发布
corepack pnpm exec npm publish --access public
```

**检查 ④ 的输出**，包内应只有五项：

```
README.md          DESIGN.md 不会被带上（不在 files 里，npm 只自动带 README / LICENSE）
cordis.patch.yml
lib/client.js
lib/index.js
package.json
```

`lib/index.js.map` 约 1.6 MB，**必须不在包里**（`files: ["lib/*.js", ...]` 已排除）。若它出现，说明 `files` 被改坏了。

---

## 2.5 发布时的两步验证（**实测路径，别再绕路**）

npm 要求**发布必须有第二因子**。本机实测（npm 12 / Windows）的可行路径是**浏览器授权**，**不需要**任何算码工具：

```powershell
npm publish --access public
# 终端会出现：
#   Authenticate your account at:
#   https://www.npmjs.com/auth/cli/<一串码>
#   Press ENTER to open in the browser...
```

**直接按回车** → 浏览器打开授权页 → 登录并点授权 → 终端打印 `+ dsh-legal-schedule@0.1.0`。

### 三条必须记住的

1. **看到 `Enter OTP:` 或 `Press ENTER to open in the browser...`，第一动作是"按回车"**，不是去找/造一个验证码生成器。2026-09-13 我在这上面绕了远路：先查浏览器的一次性密码功能（Edge 153 没有），又写了个 Node TOTP 工具——而正确做法只是按一下回车。**先穷尽"按一下"的可能，再考虑"造工具"。**
2. **`--otp=xxxxxx` 只在你有 TOTP 验证器时才有意义**，且必须是**当前有效的 6 位**（写成 7 位会被忽略、转而进入交互式索要）。走浏览器授权时**完全不需要**这个参数。
3. **恢复码（recovery codes）必须保存到验证器设备之外的地方**。它是"浏览器授权失效 / 换机器"时**唯一**能找回账号的东西，每个只能用一次。查看与重新生成：`npmjs.com/settings/<用户名>/profile` → **Modify 2FA** → **Manage Recovery Codes**。npm 官方明确：**同时失去第二因子与恢复码，账号可能无法找回。**

### 发布前必须确认的环境（一次性）

```powershell
npm config get registry      # 必须是 https://registry.npmjs.org/
```

**若显示 `registry.npmmirror.com`（淘宝镜像）就必须先改**——镜像是只读的，**不接受发布**，在那上面 `npm login` / `npm publish` 都不会成功。改法见仓库历史或：

```powershell
npm config delete registry --location=user   # 删掉用户层覆盖，回落到官方源
```

> 顺带实测：官方源在国内比镜像慢约 0.5 秒/次元数据请求，但**完全可用**（`lunar-javascript` 元数据 869ms vs 镜像 311ms；真装一个包 6 秒）。嫌慢时用**单条命令**临时指定镜像 `pnpm install --registry=https://registry.npmmirror.com`，**不要把镜像写回配置文件**。

---

## 3. 发布后

```powershell
# 验证线上包内容与本地一致（下载 tarball 检查）
npm view dsh-legal-schedule version dist.tarball
corepack pnpm exec npm pack dsh-legal-schedule@<新版本> --pack-destination $env:TEMP
```

再**给自己的 profile 升级一次**，确认用户视角能装上：

```powershell
cd $env:USERPROFILE\.dsh\profiles\web
dsh plugin add dsh-legal-schedule@<新版本>
# 重启 dsh，确认「法程」浮标在、面板有数据
```

**打 git tag 并推送**（让 GitHub 上能看到版本对应关系）：

```powershell
cd <仓库根>
git add -A
git commit -m "release: dsh-legal-schedule@<新版本>"
git tag dsh-legal-schedule@<新版本>
git push --follow-tags
```

---

## 4. 版本兼容性要跟着改的地方

DSH 平台的接口仍可能变动（`0.1.5-rc.2` 就取消了 `@deepseek-ai/dsh-client-runtime` 与 `dsh-client-ui-slots`，直接导致浏览器半边不再加载）。改动以下任一处时，**README 的「环境要求」与本节都要同步**：

| 位置 | 含义 |
| --- | --- |
| `dsh.client.inject` | 我们依赖 `@deepseek-ai/dsh-client-ui-layout`（它提供 `shell.overlay` 插槽）。平台若改名 / 取消它，必须改这里 |
| `dsh.client.platform: "web"` | 只支持 web profile |
| `lib/client.js` 里 `require` 的模块 | shell 提供的共享模块清单变了，要跟着改 |
| `README.md` 的「环境要求 → DSH 版本」 | 用户唯一的兼容性依据 |

**已知的平台行为**（升级 DSH 后若"浮标消失且控制台无报错"，先查这些）：

- `dsh.client.inject` 声明了一个**不存在的平台包** → boot graph 那一行永远等不到依赖，整半客户端不加载、**无任何报错**。
- 插件面 `inject` 不含 `'slots'` → `apply` 在 `slots` 就绪前跑完并静默 `return`，**同样无报错**。
- 包名以 `/client` 结尾 → `stripClientSuffix` 误削，报 `not a row in the boot graph`。

---

## 5. 发布前的人工核对（机器测不了的）

- [ ] 仓库里**没有真实案名、当事人姓名、案件目录结构、界面截图、本机绝对路径**（本仓库是 public）。`sandbox/` 与 `maintenance/` 已被 `.gitignore` 排除，但提交前仍应 `git diff --cached` 扫一眼。
- [ ] `LICENSE` 的署名年份与姓名正确。
- [ ] `README.md` 的安装步骤与实际行为一致（尤其 `dsh.profile.bundles` 那一步）。
- [ ] 若这次改了用户可见行为，`README.md` 的功能 / 限制小节同步更新。
- [ ] `CHANGELOG`（若有）已更新；没有则至少让 git tag 说明版本。
- [ ] **发布后**：`git push --follow-tags` 真的推上去了 —— npm 页面上的 `README` 与 `repository` 链接都指向 GitHub，**仓库没推 = 用户点过去看到旧文档**（2026-09-13 首次发布就是这个状态）。
- [ ] **账号侧**：npm 的**恢复码已保存**到验证器设备之外的地方（见 2.5）。这是账号层面唯一不可再生的一步。

---

## 6. 撤销与回滚

npm **不允许重新发布同一个版本号**，只能：

```powershell
# 发布后 72 小时内可彻底撤销（之后只能废弃）
corepack pnpm exec npm unpublish dsh-legal-schedule@<坏版本>
# 或标记为废弃（推荐：让已装的人看到提示）
corepack pnpm exec npm deprecate dsh-legal-schedule@<坏版本> "该版本有问题，请升级到 x.y.z"
```

用户侧回滚 = 装回上一个版本 + 重启 DSH。数据文件不受影响（插件只读写用户自己的工作日志）。
