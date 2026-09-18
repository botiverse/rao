# 项目数据迁移到 SQLite：实现交接计划

## 实现状态（2026-09-18）

存储与 UI 迁移已实现，以下正文保留为原始验收计划。

- SQLite schema v1：详情 JSON、稳定 ID/current session、创建/更新时间、创建/删除恢复状态及删除标记。
- 启动导入当前 origin 的旧数据；内容校验、私有备份、事务及按来源/内容去重，保留旧 localStorage 和 JSONL。
- 跨来源采用显式导出/导入：Projects 首页和 Dashboard 提供入口。只迁详情，目标目录必须已有对应 session；不将所有 session 自动转成项目。
- renderer 使用内存缓存；异步保存失败保留草稿，重命名和头像选择等待确认；加载失败可重试。
- 开发版与安装版统一 `<appData>/Rao`，支持 `RAO_USER_DATA` 和 `--user-data-dir`；未获单实例锁不会初始化存储。
- 创建先记录意图再打开 session；删除先记 tombstone 再删 JSONL，未完成操作在重启时恢复。
- `scripts/package.mjs` 固化完整生产依赖解析与本机 Electron 打包；macOS 使用 ad-hoc 签名和匹配的 entitlements，未做公证。
- `pnpm check`：48 项测试通过；真实 Electron 验收脚本见 `scripts/check-app.mjs`。开发 HTTP → 安装 file → 安装重启 → 开发重启验证通过，中文笔记与头像一致，JSONL 字节未变，第二实例退出，OAR 导入与窗口加载成功。
- 安装产物：`release/0.1.0/mac-arm64/Rao.app`，`codesign --verify --deep --strict` 通过。

验收仅使用独立临时目录。确认没有 Rao 实例运行后，已备份并更新 `~/Applications/Rao.app`；未手动修改用户数据。旧安装版不含 SQLite 支持，必须更新后才能读取开发版已迁移的项目。
用户已确认将此前的项目 UI、Dashboard 和 OAR 0.6 等依赖改动与 SQLite 迁移合并为一个提交。

## 目标和范围

将项目名称、note、头像等业务数据从 renderer localStorage 迁入主进程管理的 SQLite。
开发版和安装版使用同一数据目录时，应看到同一批项目和对话。

本次只做存储改造。runtime 切换、交接 Markdown 和交接卡片暂缓。
对话事件继续保留现有 JSONL，不重写、不合并旧日志。
localStorage 可以继续存储面板开关等 UI 偏好，但不再作为项目数据源。

## 当前问题

- `src/renderer/src/projects.ts` 使用 Zustand persist，将项目详情存入 `rao-projects-v2`。
- 开发版页面来源是 `http://localhost:5173`，安装版是 `file://`，两者看不到彼此的 localStorage。
- `listProjects` 只展示存在项目详情的 session，因此 session 文件还在，安装版项目列表却为空。
- 本机已检查到 `~/Library/Application Support/Rao/sessions/index.json` 中有 10 个 session。这不等于有 10 个有效项目，不能直接把所有 session 都转成项目。

## 工作区状态：接手前必读

工作区原本就有大量未提交修改，包含项目 UI、Dashboard、oar 0.6 记录流等。
不要执行 reset/clean 或覆盖这些修改，也不要默认整批提交。
用户要求完成的改动直接 commit/push；但现有修改是否全部一起提交，尚未明确。

SQLite 实现刚开始，**未完成、未跑验证，当前代码可能无法编译**：

- 新增 `src/shared/projects.ts`：共享详情类型、校验和旧 Zustand 数据解析。
- 新增 `src/main/projects/store.ts`：基于 `node:sqlite` 的初版 ProjectStore，含 CRUD、删除标记和导入事务。
- `src/shared/ipc.ts` / `src/preload/index.ts`：新增项目 list/save/importLegacy IPC，open request 可带 project 详情。
- `src/main/ipc/register.ts`：接入 ProjectStore 参数；开始处理项目保存、导入、创建和删除。
- `src/main/index.ts`：初步创建 `<userData>/rao.sqlite` 并在退出时关闭。
- `src/renderer/src/lib/projects.ts`：类型改从 shared 引入。
- renderer 的 Zustand persist 尚未替换；新 IPC 尚未被 UI 使用；测试调用签名尚未更新。

上述代码仅是起点，需按下面方案审查和完善，不能认为存储迁移已经完成。

之前暂停的 runtime 交接修改备份在 `/tmp/rao-paused-handoff`，已从工作区撤下。
开始交接功能之前的工作区快照在 `/tmp/rao-before-handoff`。这些临时目录不是长期备份。

## 1. 确定数据模型和数据目录

使用 Electron 内置 Node 的 `node:sqlite`，避免引入需要按 Electron ABI 重编译的 SQLite addon。
已确认当前命令行 Node 能使用 `DatabaseSync`；仍必须在实际 Electron 和安装包中验证。

建议表结构：

- `projects`：稳定的 project ID、当前 session handle、名称、note、头像、创建/更新时间、删除标记。
- `legacy_imports`：导入来源、导入版本和完成时间。
- schema version：用 `PRAGMA user_version` 或版本表管理后续数据库升级。

初版 ProjectStore 目前只存 `id/details JSON/deleted/updated_at`，没有完整的上述模型；接手者需决定并补全。
如果本次只迁详情，可保留 JSON 列减少改动，但应明确这是阶段一。
不要为尚未实现的 runtime 切换提前建立空 handoffs 功能。

现有项目 ID 可以沿用 Rao handle，避免笔记、头像和对话引用失联；它不同于 runtime 的 native session ID。
未来切换 runtime 时，保持 project ID，更新 current session 关联。

数据库放在固定的 `<userData>/rao.sqlite`。确认开发版/安装版均指向 `Application Support/Rao`，
且显式测试数据目录不能被硬编码覆盖。

启用 WAL、busy timeout 和事务；第二个实例未获得单实例锁时，不应继续初始化或修改存储。

## 2. 主进程管理读写

- renderer 通过 typed IPC 读取和修改项目，不能访问 SQLite 或文件路径。
- 在 IPC 边界验证 project ID、名称、note、头像结构；校验目标项目/session 是否存在。
- 更新成功后再向 renderer 返回持久化结果；禁止把失败显示成“已保存”。
- 创建 session 后保存项目详情；保存失败时清理刚创建的 session，避免不可见孤儿。
- 删除涉及 SQLite 和 JSONL，不能假装具有跨存储事务。定义删除顺序和重试策略。
- 保留删除标记或等效机制，防止旧 localStorage 在下次启动时复活已删除项目。
- 退出时关闭数据库；错误必须可见，不能静默回退到空项目列表。

## 3. 迁移旧数据

迁移原则：**先备份、事务导入、可重试、不覆盖 SQLite 中的新数据、不删除旧数据。**

- 读取旧 Zustand envelope：`{ state: { details: { [handle]: ... } }, version }`。
- 支持旧的 `goal/context` 合成 note，保留名称和头像。
- 只在完整验证后开始导入；整批失败应回滚，不能标记为成功。
- 同一来源重复导入不产生重复项目。
- 已存在或已删除的 SQLite 项目，不被旧快照覆盖或复活。
- 空的安装版 localStorage 不代表其他来源无数据，不能据此宣布迁移完成。

**必须处理跨来源迁移。** 仅让 renderer 导入当前 origin 的 localStorage，解决不了用户从开发版直接转到安装版的问题。
可选实现是一次性导出/导入入口，或受控的 Electron 旧来源迁移流程；不要在 Chromium 正占用时直接修改 LevelDB。
若选择显式导入，应提供清晰的入口和失败重试，而不是要求用户长期来回启动旧开发版。

当前用户数据的辅助材料：

- 旧 Local Storage 备份：`/tmp/rao-storage-backup-HthR37/leveldb`。
- 已确认旧键来源是 `http://localhost:5173`，键名为 `rao-projects-v2`。
- `/tmp/rao-storage-migration` 有临时 classic-level 检查脚本。
- 先前写回 file:// localStorage 的迁移被“Rao 正在运行”检查拦截，未执行成功。
- 临时备份可用于恢复当前用户的项目详情，但不能代替产品化迁移逻辑。
- 备份可能已经过时；正式迁移前重新备份，以最新数据为准，不输出笔记正文到日志。

## 4. renderer 接入

替换 `src/renderer/src/projects.ts` 的 persist：

- Zustand 只保留内存缓存和 loading/error/saving 状态。
- 启动时完成旧数据导入，再读取 SQLite 项目列表。
- 等项目和 session 都加载完，再显示列表；加载失败提供错误和重试。
- 名称、note、头像保存通过 IPC，等待确认后更新缓存。
- 保存失败保留编辑草稿，用户可重试；不能提前关闭重命名窗口或显示 Note saved。
- 防止快速连续保存或加载返回覆盖较新的内容。
- 创建项目要等详情持久化成功后再关闭创建窗口。
- 删除成功后同步更新项目缓存、session 缓存和当前选择。

重点检查：App、NewSession、ProjectContext、ProjectMenu、AvatarPicker 的异步回调。
现有回调很多是同步 void，不能只把 store.update 改成 Promise 而不改调用方。

## 5. 测试和验收

必要自动化测试：

1. 数据库创建、更新、关闭后重开，中文 note 和头像无损。
2. 旧版 note 和 goal/context 数据迁移；重复导入幂等。
3. 不同来源重复导入不会覆盖新数据，删除后不会复活。
4. 损坏输入回滚，无成功标记；修复后可重试。
5. IPC 拒绝非法参数、不存在的项目和不可信 sender。
6. 保存失败 UI 保留草稿、不显示成功；启动失败可重试。
7. 创建/删除部分失败后的恢复行为。
8. 开发版和安装版使用同一数据目录时看到相同项目。

更新现有 IPC 和 React 测试中的 mocks，执行 `pnpm check`。
文档更新为 SQLite 项目元数据 + JSONL 对话事件的实际结构。

## 6. 安装包验证和交付

用户正在用 Rao 开发 Rao，测试时不能重启或覆盖其正在工作的实例。
使用独立测试数据目录验证，再在用户退出后替换安装版本。
命名只用 `Rao.app`，不要 Fixed/Stable 等后缀。

此前打包踩过的问题必须回归：

- electron-builder 漏装 ACP SDK 的 zod peer dependency。
- minimatch 多版本依赖解析错误。
- 替换 app.asar 后 macOS 签名失效，需要重新签名并验证。
- “进程存活”不等于启动成功；未处理异常对话框也能让进程存活。

当前可启动应用是 `~/Applications/Rao.app`，仍是 SQLite 改造前的版本。
临时依赖修复脚本为 `/tmp/rao-package-deps.py`，不是正式构建方案。
应将可复现的打包修复纳入构建流程，不能依赖临时目录。

最终验证应包含：安装包内 node:sqlite 和 oar 导入、实际窗口成功加载、
旧项目显示、修改 note 后退出重开仍保留、开发/安装版本数据一致。

完成验证后，只提交本任务及其明确需要的依赖改动，再 push；不要混入暂停的 runtime 交接代码。
