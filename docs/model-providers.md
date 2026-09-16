# 自定义供应商与模型配置

当前 Web 页面只有两个分析模式：**免费确定性分析 / AI 分析**。不再按品牌预设一长串选项；由使用者管理自己的供应商和模型。

## 像其他客户端一样添加供应商

1. 选择“AI 分析”，点击“管理供应商”。
2. 左侧点击“＋ 添加供应商”。
3. 填写名称、Base URL（API 基础地址）、自己的 API Key，选择 API 格式。
4. 在“模型列表”填写真实模型 ID；点击“＋ 添加模型”可继续添加其他模型。
5. 点击“添加供应商”。回到分析页面，选择供应商和模型，阅读目的地址与费用提示、勾选确认后再分析。

支持编辑连接、增加/移除模型、确认后删除供应商。删除只移除本机浏览器中的连接配置和本页密钥，不会注销服务商账户。当前有界配置容量为 20 个连接、每个连接 30 个模型。

## 按协议兼容，不限制品牌

| API 格式 | 请求路径 | 身份验证 | 适用条件 |
| --- | --- | --- | --- |
| OpenAI Chat Completions | Base URL + `/chat/completions` | Bearer API Key | 服务商提供兼容聊天接口 |
| Anthropic Messages | Base URL + `/messages`；根域名自动补 `/v1/messages` | `x-api-key`，`anthropic-version` | 服务商提供兼容 Messages 接口 |

例如 Kimi、自建中转、其他未列出的品牌，只要提供以上格式之一，都可以填写自己的地址和模型，不需要开发者预先添加品牌。这里接入的是模型 API，不是安装或运行 Claude Code 等客户端程序。没有 API 地址/密钥、仅浏览器登录授权的产品不能直接接入。

模型和地址请从所用服务商的官方控制台/文档复制。不要把聊天网页地址、管理后台地址当作 API 地址，也不要把模型显示昵称当作模型 ID。API Key 要来自该地址对应的服务；第三方中转的可信程度需要使用者自行确认。

### Base URL 怎么填？

- 填 API 的基础地址，例如 `https://api.example.com/v1`；其中 example.com 只是说明占位，不是真实服务。
- 保留服务商要求的路径前缀，例如 `/compatible-mode/v1` 或 `/api/paas/v4`。
- 不要再附加 `/chat/completions`、`/messages` 或 `/responses`，程序会按格式添加生成路径。
- 不允许把密钥放进 URL 的用户名、密码、查询参数或片段。密钥只填 API Key 密码框。
- 仅支持公网 HTTPS 端点，不支持本机/局域网 HTTP、云元数据地址、自签名证书、重定向入口或任意代理脚本。DNS 解析出现私有/保留地址会阻止调用。

### 兼容性选项

OpenAI 兼容格式可以选择输出上限参数 `max_tokens` 或 `max_completion_tokens`；官方 OpenAI 使用后者更合适。默认发送 `response_format: json_object`；如果兼容服务不支持该参数，可关闭“发送 JSON 模式参数”。关闭后仍会要求模型输出 JSON，并在本地严格验证，绝不会把任意文本直接当成有效报告。

Anthropic 使用独立的 Messages 请求、系统字段和响应解析，不会冒充 OpenAI 格式。遇到截断、拒绝或工具调用停止原因，不当作完整报告。此版本不请求工具，也不执行模型返回的操作。

两种格式都不自动猜品牌专有参数。依赖特殊思考参数、仅支持 Responses / Gemini 原生协议、云厂商签名或 OAuth 的接口可能需要后续适配；不是“任意 URL、任意模型都保证成功”。当前报告每阶段输出上限 2500 tokens，不适合需要大量隐藏思考预算而无法在此上限完成的模型。可改用适合短结构化输出的模型。

## 配置会保存吗？密钥会保存吗？

- **非敏感连接配置会保存**：供应商名称、Base URL、协议、模型列表和兼容性选项，只保存在当前浏览器的 localStorage。不要在这些字段填秘密；不同浏览器、不同本机端口之间不自动共享。
- **API Key 不持久保存**：仅保存在当前页面内存中，按连接分别保存；刷新或关闭页面后需要重填。程序不写入 localStorage/sessionStorage、项目文件、日志或报告。
- 切换供应商会切换到该连接自己在本页保存的密钥，不借用其他连接的密钥。
- 修改 Base URL 或 API 格式时，立即清掉该连接旧密钥；改完后需重新填写。这防止把原平台的密钥误发给新地址。
- 改模型、密钥或连接后，会撤销原先的费用确认。语言切换不产生模型请求。
- 自定义连接不自动读取任何本机环境模型密钥，留空会明确提示需要填写。因此用户填自定义端点时不会动用维护者的账户。

旧版本固定预设 API 仍为历史客户端保留，但新网页不再展示这些品牌列表，也不使用它们的环境密钥回退。

## 检查配置与费用

“检查配置”只验证名称、地址格式、协议和模型 ID。不向供应商发送密钥，不调用模型，也不会声称密钥、余额或模型权限已验证。真正开始分析时会先检查公网地址，再发送仓库文本和密钥；需显式确认。

AI 报告包含项目解释和阅读角度两个生成阶段，每阶段最多一次模型请求，不自动追加付费重试。模型接口超时、限流、拒绝或输出不完整时，会复用已读取的快照交付标明回退的免费基础报告。失败前的模型请求可能已计费，免费回退不等于退费。

若仓库不可访问、没有可信依据或本地质量验证失败，不伪造成功报告。最终账单以服务商为准，未知 token 用量不代表确定零费用。

## 上传 GitHub 后谁付钱？

上传源代码不等于分享维护者账户，也不等于部署在线网站。别人下载后在自己电脑运行 `npm ci --ignore-scripts`、`npm run web`，由他们添加自己的供应商和密钥：

- 免费模式：不使用模型、不需要模型密钥，仍需联网读取 GitHub。
- AI 模式：由该使用者的 API Key 所属账户付模型费用。
- GitHub Token 仅负责仓库访问，与模型密钥无关。

不要将本机服务端口直接公开；当前没有多用户身份验证、隔离、限流及公共服务计费治理。发布代码前仍需检查当前文件和 Git 历史中的密钥、私人资料及许可证。

## 已验证与未验证

已经以模拟模型响应验证两种协议、完整报告、密钥隔离、配置检查、错误回退与安全边界；浏览器验证供应商/模型增删改、语言切换和无密钥持久化。未使用真实账户执行付费测试，不能承诺每个自定义供应商、模型或网络都可用。

自定义请求使用直接 TLS 连接：校验所有 DNS 结果，固定已验证的公网地址，仍校验证书对应的原域名；拒绝重定向，限制超时和响应大小。不自动使用 HTTP_PROXY / HTTPS_PROXY，以免代理重新解析后绕过地址保护；仅能通过代理访问的网络需要单独设计受控代理支持。

协议依据：[OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[JSON 模式](https://developers.openai.com/api/docs/guides/structured-outputs)、[Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create)、[Anthropic 停止原因](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons)。

## English quick start

Choose Free or AI analysis. In AI mode open Manage providers, add a name, public
HTTPS Base URL, your API key, API format and one or more model IDs. Save, choose a
connection/model and confirm its destination and charges before analyzing.

Connections are user-managed, not restricted to a vendor catalogue. The app
supports OpenAI-compatible Chat Completions and Anthropic Messages, not arbitrary
protocols or running coding agents. Settings persist in this browser; keys are
page-memory only and must be re-entered after reload. Endpoint/format edits clear
old keys. Custom connections never borrow environment keys. Configuration checks
make no vendor request or inference and do not validate keys/balance. No live paid
acceptance was performed. Public hosting and private-network model endpoints are
outside this local release's security boundary.
