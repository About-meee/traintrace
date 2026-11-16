# TRAINTRACE 插件资源

此目录包含可供你自行组合的疲劳值说明技能、图标资源和已脱敏的兼容清单。它不单独创建站点、MCP endpoint、用户身份或 Sites 插件连接。

## 资源内容

- `skills/traintrace-fatigue/SKILL.md`：解释训练记录中的 fatigue 字段。它要求保留原值，并说明该数字是用户完成单项动作后对当时劳累程度的主观记录、没有固定上限；不要把它转成量表或推断恢复状态。
- `.codex-plugin/plugin.json`：仅含显示名称、版本和描述的 Codex 兼容清单。为避免绑定原项目，清单没有 `apps` 配置、私有项目 ID 或站点 URL。
- `assets/traintrace-icon.png`：随包提供的图标素材。目标插件界面是否显示该图标取决于你自己的插件清单与宿主界面。

技能只是说明，不负责访问或查询数据。原站点的只读 `get_training_records` MCP 工具由 Sites 项目提供；本包没有带入原站点的连接配置。

## 在自己的站点上使用

1. 按根目录 [DEPLOY.md](../DEPLOY.md) 用自己的账户建立并配置 Sites 部署。发布前确认服务端认证、每用户数据隔离和数据库迁移。
2. 在自己的 Site 中启用 MCP capability 并发布。Sites 会为该项目生成私有应用/插件连接；安装并验证这一连接，确认其 MCP 服务器和工具属于你自己的 Site。
3. 要把疲劳值说明与自己的 MCP 连接放在同一插件中，可将 `skills/traintrace-fatigue/SKILL.md` 加入自己的插件包，并使用 [OpenAI 插件打包指南](https://developers.openai.com/plugins/build/plugins)或 Plugin Creator 生成连接配置。插件应用绑定应指向你发布自己 Site 后生成的 MCP 应用；保持此绑定在自己的部署配置中，不要复制其他人的绑定。
4. 发布/安装前检查工具范围、账号权限及只读行为。连接后从授权账号查询一小段记录，并与站点记录核对；确认空结果和分页失败会如实表达。

站点作者需要亲自创建并发布其 Site；分享站点和分享插件是不同权限。插件接收者仍需拥有对应站点访问权并完成自己的连接。具体权限可能因个人账户、计划和工作区设置而异，请见 [Sites 插件托管指南](https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites)。

## 清单格式说明

当前资源只包含 `.codex-plugin/plugin.json` 兼容清单；它已经删除原包中的 app 映射、开发者信息和站点网址。**这是元数据兼容文件，不是当前 portable 插件格式的根 `plugin.json`，也不会自动连接 Site。** 如果需要按当前 Agent Plugins portable 格式分发，请建立根级 `plugin.json`，并按官方指南添加你自己站点所需的 OpenAI app 映射。官方当前格式允许在根 manifest 的 `extensions.com.openai.apps` 中引用包内 `.app.json`；该 `.app.json` 必须由你自己的 Site 插件连接生成，不能从此资源推导。

不要把缺少绑定误认为匿名开放，也不要在公开副本中加入个人站点的 URL、项目身份或认证信息。ChatGPT Sites/MCP 的访问仍由你自己的站点和平台授权控制。

## 许可

许可范围见根目录 [LICENSE](../LICENSE) 与 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。第三方素材仍受其上游许可约束。
