# 大局选将（Taikyoku Draft）—— lishogi 移植说明

这是 [chess-shogi](https://github.com/xing0325/chess-shogi) 里「大局选将」模式在 lishogi 上的移植版本。规则、BP 顺序、布阵约束和棋子数据都跟 chess-shogi 的 TS 实现完全一致，并用差分测试逐局对拍。规则的完整说明和设计依据见 chess-shogi 仓库里的 `docs/TAIKYOKU_DRAFT.md`。

> 一句话规则：每局从 205 种大局将棋棋子中随机抽 24 种组成卡池，双方按 20 步 BP 顺序（6 禁 4 选 4 禁 6 选）各选 5 种。阵容是王将（固定，不参与 BP）加上选出的 5 枚，双方从先手开始轮流布阵，每次一枚，6 枚都放进己方底部两行。王将必须第一个布，任何棋子都不能布在开局就直接攻击对方王将的位置。布阵完成后直接进入 lishogi 原生对局页，用 5×5 棋盘对局，吃掉对方王将即胜，没有打入。

## 涉及的仓库

改动分布在四个仓库，都在 `taikyoku-draft` 分支上。它们需要并排放在同一个父目录下，因为 lishogi 通过本地路径引用另外三个。

| 仓库 | 基线 | 改动 |
|---|---|---|
| scalashogi | 13.2.1 → 本地版本 `13.3.0-taikyoku` | 新增 `Taikyokudraft` 变体（id 8，key `taikyokudraft`）：参数化的大局棋子 Role、Scala 版走法引擎 `TaikyokuEngine`（狮子两步、居喰、钩行、跳越吃子等）、选将状态机 `TaikyokuDraft`、SFEN 的 `[token]` 多字母记号、KIF 汉字棋名、带中间格着法的三字节二进制编码 |
| shogiops | 0.21.0（提交 52483e0） | 新增 `taikyokudraft` 规则：棋子数据、TS 走法引擎、SFEN/记谱支持；compat 里新增 shogiground 用的狮子类第一步、第二步落点辅助函数；带中间格且升变的着法统一用字符对编码 |
| shogiground | 41763de | `src/sfen.ts`：`inferDimensions` 和 `sfenToBoard` 把 `[running-pup]` 这类方括号记号当作一个棋子 |
| lishogi | 5394fc3 | 新模块 `modules/taikyoku`（选将房间、计时与超时自动操作、开局）、`controllers.Taikyoku`、`views.taikyoku`、前端 `ui/misc/src/build/taikyoku.ts` 及样式；对局页 `ui/round/src/ctrl.ts` 支持两步着法；所有 5×5 布局样式加入 `v-taikyokudraft`；变体名称、图标、棋子样式引入；`bin/taikyoku-piece-css.mjs` 生成 350 种棋子（含 144 种升变态）的汉字棋子样式 |

lila-ws 不需要修改。

## 页面与接口

| 路由 | 作用 |
|---|---|
| `GET /taikyoku` | 选将首页：规则简介、建房表单（棋钟 1/3/5/10/15 分钟，加秒 0/2/3/5/10 秒，每步限时 20/30/45/60 秒）、等待中的房间列表 |
| `POST /taikyoku/new` | 建房（需登录），跳转到房间页 |
| `GET /taikyoku/:id` | 房间页：阶段大字与半屏光、双方禁选栏、卡池（每张卡带 7×7 走法图和升变目标）、驹台布阵棋盘 |
| `GET /taikyoku/:id/state` | 房间状态 JSON，前端每秒轮询一次 |
| `POST /taikyoku/:id/join` | 第二名玩家加入，先后手随机分配 |
| `POST /taikyoku/:id/act` | 提交一次禁用、选择或布阵；服务端用 scalashogi 的状态机校验 |

每步超时由服务端自动处理：禁用阶段跳过，选择阶段随机挑一个，布阵阶段随机落一个合法格。BP 和布阵结束后，服务端用最终局面作为初始 SFEN 创建一盘普通的 lishogi 对局（休闲、带棋钟），双方页面会自动跳转到各自视角的对局页。

## 房间页交互

| 环节 | 做法 |
| --- | --- |
| 阶段提示 | 页面正中大字：禁用阶段为红色、选择阶段为绿色、布阵阶段为金色；每次换阶段播放入场动画，禁用阶段额外抖动一下，文字上有扫光 |
| 轮到谁 | 先手（蓝方）面板在左、后手（红方）面板在右；轮到哪方，屏幕对应的半边亮起蓝光或红光并缓慢呼吸 |
| 禁用 / 选择 | 点卡片选中，再按屏幕底部悬浮条上的「禁用 X」或「选择 X」锁定；也可以双击卡片直接锁定；禁用步可点「不禁用」 |
| 布阵 | 用 shogiground 的驹台：己方待布的棋子在驹台上，像打入一样拖到己方底部两行，或点一下再点格子；第一步必须先布王将（驹台上的王将会发光），暂时不能布的棋子变灰 |
| 走法查看 | 鼠标悬停卡片、驹台或棋盘上的棋子，右侧面板显示走法图和升变后的走法图 |

实现要点：卡池只在内容变化时重建 DOM，选中与悬停只切换类名，否则双击和拖动会被轮询刷新打断；shogiground 缓存了驹台棋子的位置，而布阵时驹台布局会变化，所以每次按下前都清一次缓存。

## 本地运行

以下步骤假设四个仓库并排克隆在同一目录，并且都切到 `taikyoku-draft` 分支。

```bash
# 1. scalashogi：发布到本地 ivy，lishogi 的 project/Dependencies.scala 依赖 13.3.0-taikyoku
cd scalashogi && sbt test publishLocal && cd ..

# 2. shogiops 和 shogiground：编译出 lishogi 引用的产物（dist/ 与 esm/）
cd shogiops && pnpm install && pnpm run compile && cd ..
cd shogiground && pnpm install && ./node_modules/.bin/tsc && cd ..

# 3. lishogi：pnpm-workspace.yaml 的 overrides 把 shogiops / shogiground 链接到上面两个目录
cd lishogi
pnpm install
pnpm ui:build          # 棋子套装 ryoko_2kanji 随 ui/@build/pieces 一起生成到 public/piece 与 public/piece-css
sbt "run 9663"         # 另需 MongoDB、Redis 和 lila-ws，与官方开发环境相同
```

`pnpm-lock.yaml` 已经按这两个本地链接重新解析过，所以 `pnpm install --frozen-lockfile` 能通过。如果要换回 npm 上的正式版本，删掉 `pnpm-workspace.yaml` 里的两条 overrides 再重新安装即可。

注意 lila-ws 会校验 socket 连接的登录用户是否就是对局里的玩家，所以 lila 和 lila-ws 必须能共享 `lila2` 会话 cookie：要么部署在同一个父域名下（和 lishogi.org 一样），要么像沙箱预览那样用反向代理放在同一个源下，带 `Upgrade: websocket` 的请求转给 lila-ws，其余转给 lila。

## 验证

| 层 | 内容 | 结果 |
|---|---|---|
| scalashogi | 与 TS 引擎的走法差分测试（大量随机局面，含狮子、居喰、钩行、跳越吃子与升变）、选将状态机差分测试（逐步对拍 TS 状态机）、字符对编码唯一性、全量原有测试 | 全部通过 |
| shogiops | 同一批差分夹具、SFEN 往返、字符对向量与 Scala 端一致、全量原有测试 | 全部通过 |
| shogiground | 方括号 SFEN 解析往返；标准将棋 9×9 和中将棋 12×12 的尺寸推断不变 | 通过 |
| 端到端 | 两个浏览器（1600 与 1366 宽，另截 390 宽手机图）各注册一个账号 → 建房 → 加入 → 20 步 BP（点卡片+锁定、双击直接锁定、不禁用各覆盖）→ 12 次布阵（一半鼠标从驹台拖放，一半点驹台再点格子）→ 自动开局 → 在对局页用鼠标走 6 步，服务端棋谱正确记录，页面无 JS 错误 | 通过 |

## 已知限制

这次只移植了「选将 + 对局」这条主线。以下部分没有做，或者只是能跑而没有专门适配：

1. **选将阶段用 HTTP 每秒轮询，没有走 lila-ws 的 socket。** 对两个人的房间来说完全够用；如果以后要支持观战或大量并发，应该在 lila-ws 里加一条 socket 路由。
2. **复盘分析、研究、棋局编辑器、谜题都没有适配这个变体。** lila-ws 在分析板上计算着法时用的是它自己依赖的 scalashogi 12.x，不认识变体 8；要支持需要把 lila-ws 也升级到 13.3.0-taikyoku。
3. **没有电脑对手。** Fairy-Stockfish 和 YaneuraOu 都表达不了这些棋子，需要另写引擎。
4. **只有休闲对局，不计分。** 这个变体还没有对应的独立等级分类型。
5. **界面文字是中英双语，跟随页面语言切换，但没有接入 lishogi 的 Crowdin 翻译体系。**
6. **棋子只有一套 ryoko_2kanji**（仿 lishogi 中将棋 ryoko_1kanji 画风的双字棋子，用 Noto Serif CJK 生成），不受用户在设置里选的棋子主题影响。
