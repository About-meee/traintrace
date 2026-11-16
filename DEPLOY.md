# 部署与改造说明

## 适用范围

本包是 TRAINTRACE V3.5 的源码快照，源自一个以 ChatGPT Sites 为目标平台的私有站点。原版本在 Sites 上运行并经用户验收；**本包没有在独立主机或其他云平台上完成部署验收**。它不是跨平台的一键安装程序，也不保证复制后即可上线。

原实现的关键依赖包括：

| 部分 | 当前实现 | 独立部署需要处理的边界 |
|---|---|---|
| 登录与账号身份 | Sites 的 ChatGPT 登录及服务端身份头 | 接入自己的认证与会话系统；每个读写请求都要在服务端验证身份并按账号隔离数据。不得信任客户端自行提交的用户 ID，也不得把未经验证的 `oai-authenticated-user-id` 请求头当作登录凭据。 |
| 数据库 | Cloudflare Worker 环境中的 D1，绑定名为 `DB` | 创建并配置自己的数据库、迁移和备份流程。新建站点不会带入原站点的训练记录。检查 `drizzle/` 迁移后再部署；JSON/CSV 导出不等于 D1 数据库的完整备份或恢复方案。 |
| 应用运行时 | Vinext/Next 风格应用，经 Vite 构建为 Cloudflare Worker | 保留 Worker 入口、兼容配置和所需绑定；换到其他运行时需要适配并重新验证请求处理、存储和环境变量。 |
| GPT 工具 | Sites 同源 `/mcp` 服务及 Sites 发布时生成的私有插件连接 | 在自己的站点上实现并保护 MCP endpoint，再通过 Sites 为自己的项目发布、安装和连接插件。当前导出的技能清单不含 MCP 地址或项目绑定。 |

## 本地查看

需要 Node.js `22.13.0` 或更新版本。以下命令使用项目随附的脚本；它们用于本地依赖安装、预览和构建，不会创建或发布 Sites：

```sh
npm run install:ci
npm run dev
```

要在本地预览中保存和查询记录，先构建，给本地空 D1 应用随附的迁移，再启动 Worker：

```sh
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_unique_frightful_four.sql
npm run start
```

命令中的 `DB` 是 Wrangler 接受的 D1 绑定名，对应本地配置中的数据库名 `site-creator-d1`。如果改了绑定，请使用新配置中的绑定名。参见 [Wrangler D1 命令](https://developers.cloudflare.com/d1/wrangler-commands/#d1-execute)。

本地认证与数据库预览用于开发。它们不等同于 Sites 上真实 ChatGPT 登录、线上 D1、访问策略或 MCP 身份转发的验证。

## 用自己的 ChatGPT Site

1. 下载或克隆本仓库。在具备 Sites 功能的 ChatGPT 或 Codex 会话中，把本仓库的源码目录交给 Sites 或可调用 Sites 的 Agent。请它以该目录的现有 Vinext/Worker 源码为基础，在你的账户或工作区创建新的私有 Sites 项目。不要把其他项目的 URL、项目 ID、数据库或插件绑定复用到自己的部署中。
2. 此包的 `.openai/hosting.json` 只保留 D1 绑定 `DB`、MCP capability 和未使用的 R2 配置，没有 Sites `project_id`。按官方 Sites 工作流，把你创建的项目 ID 配置到**自己的部署副本**，并确认 D1 绑定和 `mcp` capability 与实际站点一致。该 ID 不是本包可复用的认证凭据。
3. 保留 `drizzle/` 中随附的建表迁移。发布时由 Sites 为新项目的 D1 应用迁移。本地 D1 与线上 D1 各自独立，本包不会迁移原站点数据。
4. 让 Sites 工作流构建并打包 Worker（构建入口为 `dist/server/index.js`），保存版本后部署到这个私有项目。从 Sites 返回的链接访问站点，再用合成记录确认登录、访问范围、记录保存与查询符合预期。
5. 若要使用 ChatGPT 读取记录，发布含 MCP 的 Site 后，Sites 会为该项目生成对应的私有插件连接。安装并验证自己的插件；不要把公开源码中的 `plugin/.codex-plugin/plugin.json` 当成 MCP 连接配置。详见 [插件包说明](plugin/README.md)。

具体发布界面、权限与要求会随账户和工作区变化。请按 OpenAI 的[创建与使用 Sites 指南](https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites)及[Sites 插件托管指南](https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites)操作。

## 改用独立托管平台

独立主机部署需要按自己的服务商重新完成以下工作，不能只替换发布命令：

- **认证**：替换 Sites 登录跳转和可信身份头来源。为页面 API 与 MCP 各请求验证服务端会话；从认证提供方取得稳定的账号标识并在查询中强制按账号过滤。不要让工具参数选择用户 ID。
- **D1 与迁移**：选择兼容的数据库或重写数据库层，提供 schema/migration 执行、备份、恢复和迁移演练。不同 Site 的账号 ID 和数据不会自动对应或转移。
- **Worker/runtime**：保留当前 Cloudflare Worker/Vinext 架构，或针对目标运行时重写 Worker 绑定、请求处理及存储适配。检查运行时支持范围、配额、超时和兼容性。
- **MCP**：部署并限制访问自己的 MCP endpoint，明确公开的工具和只读边界，并让目标 ChatGPT 插件连接该服务。原实现使用 Sites 传递的调用者身份；独立服务必须提供可信的替代认证与授权。
- **发布与运营**：自行配置域名、TLS、环境变量、监控、备份、安全更新和隐私说明。不要把本地预览、测试数据或构建成功当成生产环境验收。

这些独立部署步骤没有在本包中进行实测。部署者需要在自己的环境中完成安全、数据隔离、备份恢复、MCP 授权和真实客户端验收。

## 数据、版权与条款

TRAINTRACE 只面向个人学习、非商业创作和自行部署。根目录 [LICENSE](LICENSE) 规定了可用范围及 GitHub 以外再分发的授权要求；第三方部分见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

使用 ChatGPT Sites 时，请自行审查发布内容、素材权利、访问权限以及个人数据的收集和处理方式。不要用该站点处理平台条款禁止的数据或用途。适用条款见 [ChatGPT Sites 条款](https://openai.com/policies/chatgpt-sites-terms/)、[Sites 作者责任](https://help.openai.com/en/articles/20001337-understanding-responsibilities-for-your-chatgpt-sites)、[OpenAI 使用政策](https://openai.com/policies/usage-policies)和[数据保护说明](https://help.openai.com/en/articles/20001340-complying-with-data-protection-laws-for-chatgpt-sites)。条款和功能可能更新，发布前请阅读当前版本。
