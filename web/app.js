import { createProviderManager } from "./provider-manager.js";
import { createLocalTranslation } from "./local-translation.js";
import { createLibrary } from "./library.js";

const COPY = {
  "zh-CN": {
    translationUnsupported: "当前浏览器无法自动显示中文。请使用最新版桌面 Chrome，或配置 AI 深入解读。",
    translationPairUnsupported: "当前浏览器无法将这份内容显示为中文。",
    translationLanguageInvalid: "无法识别内容语言，暂时不能显示中文。",
    translationEmpty: "没有可显示的正文。", translationTooLong: "正文过长，暂时无法自动显示中文。",
    translationTimeout: "显示中文超时，请再次点击顶部“中文”重试。",
    translationFailed: "暂时无法显示中文，请再次点击顶部“中文”重试；未调用付费 API。",
    modeComparison: "两种方式有什么区别？费用怎么算？",
    basicModeTitle: "基础分析", basicModeDetail: "按固定规则整理文档、代码结构和来源。不使用大模型，没有赠送或消耗的模型额度；阅读时会按顶部语言在本机自动翻译。",
    aiModeTitle: "AI 深入解读", aiModeDetail: "在相同读取范围内补充项目用途、适合人群和模块解释，按所选语言生成解读。由你填写的 API Key 所属账户计费；更详细不代表更准确。",
    githubCostNote: "两种方式都需要联网读取 GitHub，可能遇到访问次数限制，也会使用本机资源。GitHub 访问限额与模型 API 余额是两回事。",
    guideOriginal: "仓库原文与引用", configureAiAnalysis: "配置 AI 深入解读",
    accessSettings: "GitHub 访问设置", accessSettingsNote: "匿名访问 · 遇到限额时再调整",
    resumeReport: "继续阅读上一份报告", backToSettings: "返回分析设置", saveReport: "保存报告",
    reportIntroduction: "查看项目简介", navLimits: "分析限制", providerSettings: "模型供应商设置",
    clearEvidenceFilter: "清除筛选，查看全部证据",
    waitingNote: "耗时取决于仓库大小和网络情况。请保持页面打开，不用重复提交。",
    scopeHeading: "不会运行仓库代码",
    scopeBody: "只读取文本，不克隆仓库、不安装依赖，也不执行脚本或测试。仓库内容不会被当作操作指令。",
    privacyHeading: "密钥由你保管",
    privacyBody: "供应商配置保存在当前浏览器；API 密钥由 Windows 当前用户加密保存在这台电脑，不写入报告或日志，也不会在页面回显完整内容。",
    costHeading: "AI 分析单独计费",
    costBody: "使用 AI 时，仓库文本会发送给所选供应商，由你的 API 账户付费。模型生成失败时回退到免费报告，不自动付费重试。",
    pageTitle: "仓库解读 — GitHub 项目分析",
    resultTitle: "{name} — 仓库解读",
    skipToWorkbench: "跳到分析工作台", homeLabel: "仓库解读首页",
    brandName: "仓库解读", brandTagline: "GitHub 项目分析",
    pageNavigation: "页面导航", navMethod: "报告说明", navBoundary: "使用须知", versionLocal: "V0.2 本地版",
    heroEyebrow: "GitHub 项目分析", heroLineOne: "了解一个项目，", heroLineTwo: "从这里开始",
    heroIntro: "贴入公开仓库地址，查看项目用途、上手方法和代码结构。报告附有来源，方便你回到原文继续读。",
    repositoryLabel: "公开 GitHub 仓库地址", analyzeButton: "开始分析", analyzingButton: "正在分析",
    connectionEyebrow: "本次分析", connectionHeading: "分析设置",
    credentialPrivacy: "初次使用保持默认即可，无需填写密钥。",
    githubReadLegend: "仓库访问", githubReadIntro: "公开仓库可直接读取。遇到 GitHub 访问限额时，可填入自己的 Token（访问凭证）。",
    accessModeLabel: "访问方式", anonymousOption: "匿名访问（无需 Token）", tokenOption: "使用自己的 GitHub Token",
    clearButton: "清空", testCurrentMode: "测试当前方式", checkingConnection: "正在检查本机连接配置…",
    reportModeLegend: "报告方式", analysisModeLabel: "分析模式", deterministicOption: "基础分析（免费，无需 API）",
    deepseekOption: "DeepSeek 智能分析（消耗额度）", deepseekPlaceholder: "sk-…（留空可用本机已配置密钥）",
    testButton: "测试", paidConsent: "我知道仓库文本会发送给 DeepSeek，并消耗所用账户的 API 余额。",
    deepseekIdle: "只有选择 DeepSeek 时才会调用模型；连接测试不会生成内容。",
    credentialLifecycle: "密钥保存说明", browserMemory: "密钥由 Windows 当前用户加密", oneLocalRequest: "完整密钥不回显", discardAfterRequest: "可在供应商记录中删除",
    fillExample: "试填一个示例", traceLabel: "报告内容说明", traceHeading: "报告里有什么", localLabel: "含来源",
    tracePin: "项目介绍", tracePinNote: "做什么、适合谁、怎样开始使用", traceExtract: "代码结构", traceExtractNote: "主要模块，以及能确认的依赖关系",
    traceVerify: "来源引用", traceVerifyNote: "查看对应的文件和代码位置", traceOrganize: "可下载的报告", traceOrganizeNote: "保存说明、结构图和分析数据",
    traceFailureNote: "免费模式整理文档和代码信息；AI 模式在此基础上补充解读，需要配置自己的模型供应商。",
    analyzingEyebrow: "正在分析", analyzingHeading: "正在读取仓库", analyzingMessage: "正在整理文档、代码和引用。完成检查后，报告会显示在这里。", secondsUnit: "秒",
    errorHeading: "未能完成分析", retryButton: "返回检查设置", allGatesPassed: "报告检查已通过", qualityGate: "报告检查", passed: "通过",
    fallbackHeading: "AI 分析未完成，以下为免费报告", resultNavigation: "分析结果导航", navOverview: "概览", navArchitecture: "架构", navEvidence: "证据", navContent: "延伸阅读", navDownloads: "下载",
    overviewEyebrow: "项目概览", overviewHeading: "它做什么", problemHeading: "解决的问题", audienceHeading: "适合谁", technologyHeading: "技术组成",
    architectureEyebrow: "架构关系", architectureHeading: "模块如何连接", architectureGuide: "阅读方式：A → B 表示 A 在代码中导入或直接调用 B。这里只优先展示跨文件连接；同一文件内部的小调用合并到统计里。", viewMermaid: "查看 Mermaid 原始图",
    evidenceEyebrow: "证据清单", evidenceHeading: "结论从哪里来", filterEvidence: "筛选证据", evidencePlaceholder: "输入文件名、结论或证据 ID", evidenceEmpty: "没有与这个关键词匹配的证据。", showMoreEvidence: "显示更多证据",
    contentEyebrow: "深入了解", contentHeading: "可以进一步看的地方", contentExplainer: "以下内容来自本次读取的源码，可作为继续阅读的线索。",
    guideBasis: "文档与仓库信息 · 不代表已验证运行效果", guideInterpretation: "AI 详细解读 · 需结合原文核对", guideFeatures: "主要功能与特点", guideUsage: "怎样开始使用", guideCaveats: "使用前注意", guideDocumented: "仓库原文", guideInferred: "AI 辅助判断 · 尚未验证", guideMissing: "所选文档未提供明确说明，请进一步查看仓库。",
    guideCode: "文档示例 · 工具未执行，使用前请核对原文和环境",
    limitsEyebrow: "阅读提醒", limitsHeading: "本次分析的限制", limitationsHeading: "分析限制", unknownsHeading: "待验证问题",
    artifactsEyebrow: "下载", artifactsHeading: "保存分析结果", downloadJson: "下载当前结果 JSON", analysisSummaryLabel: "分析摘要", repositoryAside: "仓库",
    filesSeen: "已发现文件", filesRead: "实际读取", evidenceRecords: "证据记录", coreModules: "核心模块", analysisDuration: "分析耗时", analysisModeMetric: "分析模式", modelUsage: "模型 API 用量", repositoryExecution: "仓库执行", criticalGates: "检查记录",
    methodEyebrow: "报告说明", methodLineOne: "这份报告", methodLineTwo: "是怎么来的",
    methodReadLabel: "01", methodReadHeading: "读取仓库", methodReadBody: "记录本次提交版本，读取 README、配置和部分源码。大仓库不一定会读完。",
    methodBindLabel: "02", methodBindHeading: "整理来源", methodBindBody: "将代码事实对应到文件和代码位置。文档介绍与 AI 解读会分别标注。",
    methodVerifyLabel: "03", methodVerifyHeading: "检查结果", methodVerifyBody: "核对报告格式、引用和代码关系。检查通过不代表项目已运行或 AI 解读完全正确。",
    methodDeliverLabel: "04", methodDeliverHeading: "生成报告", methodDeliverBody: "在页面阅读，也可下载 Markdown 说明、JSON 数据和 Mermaid 结构图。",
    boundaryEyebrow: "使用须知", boundaryHeading: "分析前，了解这几点", boundaryBody: "目前只支持公开 GitHub 仓库。报告用于了解项目，不代替安装测试或安全审计。",
    footerBrand: "仓库解读 · V0.2 本地版", footerSafety: "仅支持公开 GitHub 仓库",
  },
  en: {
    translationUnsupported: "This browser cannot display the content in English automatically. Use the latest desktop Chrome or configure an AI explanation.",
    translationPairUnsupported: "This browser cannot display this content in English.",
    translationLanguageInvalid: "The content language could not be identified, so English cannot be shown yet.",
    translationEmpty: "There is no content to display.", translationTooLong: "This content is too long to display in English automatically.",
    translationTimeout: "Displaying English timed out. Click EN at the top to try again.",
    translationFailed: "English cannot be displayed right now. Click EN at the top to try again; no paid API was used.",
    modeComparison: "Compare modes and costs",
    basicModeTitle: "Basic analysis", basicModeDetail: "Uses fixed rules to organize documentation, code structure and sources. No AI model and no model credits granted or used; reading is translated on-device when the top language requires it.",
    aiModeTitle: "AI in-depth explanation", aiModeDetail: "Adds purpose, audience and module explanations from the same selected files, using the chosen language. Your API key's account is billed. More detail does not guarantee greater accuracy.",
    githubCostNote: "Both modes read GitHub over the network, may hit access rate limits, and use local resources. GitHub access limits are separate from your model API balance.",
    guideOriginal: "Repository text and sources", configureAiAnalysis: "Configure AI explanation",
    accessSettings: "GitHub access settings", accessSettingsNote: "Anonymous · adjust if rate-limited",
    resumeReport: "Continue reading the last report", backToSettings: "Back to settings", saveReport: "Save report",
    reportIntroduction: "View project introduction", navLimits: "Limitations", providerSettings: "Model provider settings",
    clearEvidenceFilter: "Clear filter and show all evidence",
    waitingNote: "Time depends on repository size and your connection. Keep this page open; no need to submit again.",
    scopeHeading: "Repository code is not run",
    scopeBody: "The tool reads text without cloning, installing dependencies or running scripts and tests. Repository text is not treated as instructions.",
    privacyHeading: "You manage your keys",
    privacyBody: "Provider settings stay in this browser. API keys are protected for the current Windows user on this computer, never written to reports or logs, and never returned in full to the page.",
    costHeading: "AI usage has its own cost",
    costBody: "AI analysis sends repository text to your selected provider and bills your API account. Failed model generation falls back to a free report with no paid retry.",
    pageTitle: "Repository Guide — GitHub project analysis",
    resultTitle: "{name} — Repository Guide",
    skipToWorkbench: "Skip to analysis workbench", homeLabel: "Repository Guide home",
    brandName: "Repository Guide", brandTagline: "GitHub project analysis",
    pageNavigation: "Page navigation", navMethod: "About the report", navBoundary: "Before you start", versionLocal: "V0.2 Local",
    heroEyebrow: "GitHub project analysis", heroLineOne: "A closer look", heroLineTwo: "at your next repository",
    heroIntro: "Paste a public repository URL to explore its purpose, setup and code structure. Follow the source references when you want to read more.",
    repositoryLabel: "Public GitHub repository URL", analyzeButton: "Analyze repository", analyzingButton: "Analyzing",
    connectionEyebrow: "This analysis", connectionHeading: "Analysis settings",
    credentialPrivacy: "New here? The defaults work without an API key.",
    githubReadLegend: "Repository access", githubReadIntro: "Public repositories need no credentials. If you reach GitHub's access limit, you can use your own token.",
    accessModeLabel: "Access mode", anonymousOption: "Anonymous access (no token)", tokenOption: "Use my GitHub token",
    clearButton: "Clear", testCurrentMode: "Test access", checkingConnection: "Checking local connection settings…",
    reportModeLegend: "Report options", analysisModeLabel: "Analysis mode", deterministicOption: "Basic analysis (free, no API)",
    deepseekOption: "DeepSeek smart analysis (uses balance)", deepseekPlaceholder: "sk-… (leave blank to use a configured local key)",
    testButton: "Test", paidConsent: "I understand that repository text will be sent to DeepSeek and use the selected account's API balance.",
    deepseekIdle: "The model is called only when DeepSeek is selected; connection tests do not generate content.",
    credentialLifecycle: "Saved key handling", browserMemory: "Protected for this Windows user", oneLocalRequest: "Full keys are never displayed", discardAfterRequest: "Delete from the provider record",
    fillExample: "Try an example", traceLabel: "Report contents", traceHeading: "Inside the report", localLabel: "With sources",
    tracePin: "Project overview", tracePinNote: "Purpose, audience and getting started", traceExtract: "Code structure", traceExtractNote: "Main modules and confirmed dependencies",
    traceVerify: "Source references", traceVerifyNote: "Relevant files and code locations", traceOrganize: "Downloadable files", traceOrganizeNote: "Keep the report, diagrams and data",
    traceFailureNote: "Free mode organizes documentation and code information. AI mode adds interpretation using your own model provider.",
    analyzingEyebrow: "Analyzing", analyzingHeading: "Reading the repository", analyzingMessage: "Collecting documentation, code and references. Your report will appear here after the checks finish.", secondsUnit: "seconds",
    errorHeading: "Analysis could not finish", retryButton: "Review settings", allGatesPassed: "Report checks passed", qualityGate: "Report checks", passed: "Passed",
    fallbackHeading: "AI analysis stopped; showing the free report", resultNavigation: "Analysis result navigation", navOverview: "Overview", navArchitecture: "Architecture", navEvidence: "Evidence", navContent: "Further reading", navDownloads: "Downloads",
    overviewEyebrow: "Project overview", overviewHeading: "What it does", problemHeading: "Problem", audienceHeading: "Audience", technologyHeading: "Technology",
    architectureEyebrow: "Architecture relationships", architectureHeading: "How modules connect", architectureGuide: "How to read this: A → B means A imports or directly calls B in the code. Cross-file connections are shown first; small same-file calls are summarized instead of flooding the page.", viewMermaid: "View raw Mermaid diagram",
    evidenceEyebrow: "Evidence list", evidenceHeading: "Where conclusions come from", filterEvidence: "Filter evidence", evidencePlaceholder: "Enter a file, conclusion, or evidence ID", evidenceEmpty: "No evidence matches this filter.", showMoreEvidence: "Show more evidence",
    contentEyebrow: "Explore further", contentHeading: "Where to look next", contentExplainer: "These reading suggestions are based on the source files included in this analysis.",
    guideBasis: "Documentation and repository metadata · Runtime outcomes not verified", guideInterpretation: "AI interpretation · Check against the sources", guideFeatures: "Main capabilities", guideUsage: "Getting started", guideCaveats: "Before using it", guideDocumented: "Repository source", guideInferred: "AI interpretation · Not verified", guideMissing: "Not explicitly explained in the selected documentation. Consult the repository for more information.",
    guideCode: "Documentation example · Not executed; check the source and environment first",
    limitsEyebrow: "Reading notes", limitsHeading: "Limits of this analysis", limitationsHeading: "Limitations", unknownsHeading: "Questions to verify",
    artifactsEyebrow: "Downloads", artifactsHeading: "Save the report", downloadJson: "Download current result JSON", analysisSummaryLabel: "Analysis summary", repositoryAside: "Repository",
    filesSeen: "Files seen", filesRead: "Files read", evidenceRecords: "Evidence records", coreModules: "Core modules", analysisDuration: "Duration", analysisModeMetric: "Analysis mode", modelUsage: "Model API usage", repositoryExecution: "Repository execution", criticalGates: "Check results",
    methodEyebrow: "About the report", methodLineOne: "How the report ", methodLineTwo: "is put together",
    methodReadLabel: "01", methodReadHeading: "Read the repository", methodReadBody: "Record the commit and read the README, configuration and selected source files. Large repositories may not be read in full.",
    methodBindLabel: "02", methodBindHeading: "Attach sources", methodBindBody: "Link code facts to files and locations. Documentation and AI interpretation are labelled separately.",
    methodVerifyLabel: "03", methodVerifyHeading: "Check the results", methodVerifyBody: "Check report format, references and code relationships. Passing does not verify runtime behavior or guarantee AI accuracy.",
    methodDeliverLabel: "04", methodDeliverHeading: "Create the report", methodDeliverBody: "Read it here or download Markdown notes, JSON data and Mermaid diagrams.",
    boundaryEyebrow: "Before you start", boundaryHeading: "Scope, privacy and costs", boundaryBody: "Only public GitHub repositories are supported. The report helps you explore a project; it is not a runtime test or security audit.",
    footerBrand: "Repository Guide · V0.2 Local", footerSafety: "Public GitHub repositories only",
  },
};

const RUNTIME_COPY = {
  "zh-CN": {
    genericFailure: "分析未完成，请查看具体原因后重试。",
    modeDeepSeek: "当前：DeepSeek 智能分析。会按当前语言生成报告并消耗账户余额；若生成中断，将自动交付免费基础报告，不追加付费重试。",
    modeDeterministic: "基础分析免费，但 GitHub 读取仍受访问次数限制。不使用模型，不运行仓库代码。",
    githubTokenEnvironment: "Token 模式：可填写自己的 Token；留空时使用本机已配置 Token。",
    githubTokenRequired: "Token 模式：请填写自己的 GitHub Token。",
    githubAnonymousLocked: "当前不使用 GitHub Token。",
    deepseekEnvironment: "本机已配置 DeepSeek Key；输入框留空时自动使用。连接测试不会生成内容。",
    deepseekRequired: "本机未配置 DeepSeek Key；选择智能分析时请临时填写自己的 Key。",
    localStatusUnavailable: "暂时无法读取本机连接状态。",
    testing: "测试中", testingConnection: "正在检查连接；不会生成内容…", connectionFailed: "连接测试失败。", browserCannotConnect: "浏览器无法连接本地服务。",
    githubConnectedLimited: "GitHub {mode}连接成功，但读取额度已用完{reset}。", githubConnected: "GitHub {mode}连接正常；{quota}{reset}。",
    authenticated: "已认证", anonymous: "匿名", quotaUnavailable: "额度信息不可用", quotaRemaining: "剩余 {remaining}/{limit}", resetAt: "，{time} 刷新",
    deepseekBalance: "DeepSeek Key 有效；可用余额 {balance}。本次测试未调用模型。", providerConfirmed: "由服务方确认", balanceUnavailable: "DeepSeek Key 有效，但当前余额不可用于模型调用。",
    noModules: "当前读取范围内没有识别出核心模块。", verifiedStructure: "已核验结构", aiInterpretation: "AI 辅助解释 · 需结合证据阅读",
    noRelationships: "当前证据没有形成可验证的跨模块关系。", relationArrow: "— {type} →", relationshipMore: "页面先展示 {shown} 条跨模块关系；完整 {total} 条关系可在 Mermaid 与下载产物中查看。",
    crossModuleCount: "跨模块 {count}", importCount: "导入 {count}", callCount: "调用 {count}", internalCount: "同文件调用已折叠 {count}", relationshipCount: "共 {count} 条跨模块关系",
    evidenceCount: "{shown}/{total} 条证据", evidenceShowing: "当前展示 {shown}/{total} 条；完整证据可下载。",
    unconfirmed: "未从当前证据确认", noAngles: "本次读取的源码中，暂未找到有足够依据的延伸阅读内容。", angleRank: "选题 {rank} · {category}", durationSeconds: "{seconds} 秒",
    noLimitations: "当前没有额外限制记录。", noUnknowns: "当前范围内没有额外待验证问题。", artifactDirectory: "本地产物目录：{path}", gatePass: "通过", gateFail: "未通过",
    resultKicker: "项目分析报告", fallbackResultKicker: "项目分析报告 · 免费模式", deterministicFree: "基础分析（无模型 API）", paidModel: "{model}（付费）", tokenUsage: "{input} 入 / {output} 出", noPaidTokens: "未调用模型 API",
    fallbackProvider: "确定性基础报告（DeepSeek 已回退）", fallbackUsage: "{input} 入 / {output} 出（失败前，可能计费）", stageBrief: "项目说明", stageAngles: "选题角度", stageContent: "成稿内容", stageUnknown: "模型生成",
    fallbackMessage: "DeepSeek 在{stage}阶段没有返回完整结果。本页已改用确定性分析，未采用半截模型内容，也没有追加付费重试。出错阶段记录到 {calls} 次请求，此前已完成的阶段也可能计费。",
    genericModeHeading: "本次使用通用文本模式", genericModeMessage: "本次按通用方式读取 README、配置和部分源码。非 JavaScript/TypeScript 文件仅做文本分析，不提供其函数和跨文件调用关系。",
    invalidUrl: "请输入形如 https://github.com/owner/repository 的公开仓库地址，不要附加分支、查询参数或文件路径。", consentRequired: "使用 DeepSeek 会消耗所用账户余额，请先勾选费用确认。", localServerUnavailable: "浏览器无法连接本地分析服务。请确认 npm run web 仍在运行。",
    clearedGithubEnvironment: "已清空输入；Token 模式下将使用本机 GitHub Token。", clearedGithubAnonymous: "已清空输入；如无 Token，请改回匿名访问。", clearedDeepSeekEnvironment: "已清空输入；选择 DeepSeek 时可使用本机已配置 Key。", clearedDeepSeekRequired: "已清空输入；使用 DeepSeek 前需要填写自己的 Key。",
    copied: "已复制", copyFailed: "复制失败，请手动选择正文",
  },
  en: {
    genericFailure: "Analysis could not finish. Review the details before trying again.",
    modeDeepSeek: "Current: DeepSeek smart analysis. The report uses the selected language and the account balance; if generation stops, a free base report is delivered without a paid retry.",
    modeDeterministic: "Basic analysis is free, but GitHub access is still rate-limited. No model calls or repository code execution.",
    githubTokenEnvironment: "Token mode: enter your own token or leave it blank to use the locally configured token.",
    githubTokenRequired: "Token mode: enter your GitHub token.",
    githubAnonymousLocked: "No GitHub token is being used.",
    deepseekEnvironment: "A local DeepSeek key is configured; leave the field blank to use it. Connection tests do not generate content.",
    deepseekRequired: "No local DeepSeek key is configured; enter your own key for smart analysis.",
    localStatusUnavailable: "Local connection status is temporarily unavailable.",
    testing: "Testing", testingConnection: "Checking the connection; no content will be generated…", connectionFailed: "Connection test failed.", browserCannotConnect: "The browser cannot reach the local service.",
    githubConnectedLimited: "GitHub {mode} connection succeeded, but the read quota is exhausted{reset}.", githubConnected: "GitHub {mode} connection is healthy; {quota}{reset}.",
    authenticated: "authenticated", anonymous: "anonymous", quotaUnavailable: "quota unavailable", quotaRemaining: "{remaining}/{limit} remaining", resetAt: ", resets {time}",
    deepseekBalance: "DeepSeek key is valid; available balance: {balance}. This test did not call a model.", providerConfirmed: "confirmed by provider", balanceUnavailable: "The DeepSeek key is valid, but the current balance is unavailable for model calls.",
    noModules: "No core module was identified in the selected read scope.", verifiedStructure: "Verified structure", aiInterpretation: "AI-assisted explanation · read with the evidence",
    noRelationships: "The current evidence contains no verifiable cross-module relationship.", relationArrow: "— {type} →", relationshipMore: "The page shows {shown} cross-module relationships first; all {total} relationships remain in Mermaid and the downloadable artifacts.",
    crossModuleCount: "Cross-module {count}", importCount: "Imports {count}", callCount: "Calls {count}", internalCount: "Same-file calls folded {count}", relationshipCount: "{count} cross-module relationships",
    evidenceCount: "{shown}/{total} evidence records", evidenceShowing: "Showing {shown}/{total}; complete evidence is downloadable.",
    unconfirmed: "Not confirmed by current evidence", noAngles: "The selected source files did not provide enough evidence for further reading suggestions.", angleRank: "Topic {rank} · {category}", durationSeconds: "{seconds} seconds",
    noLimitations: "No additional limitation was recorded.", noUnknowns: "No additional verification question was recorded in this scope.", artifactDirectory: "Local artifact directory: {path}", gatePass: "Passed", gateFail: "Failed",
    resultKicker: "Repository report", fallbackResultKicker: "Repository report · Free mode", deterministicFree: "Basic analysis (no model API)", paidModel: "{model} (paid)", tokenUsage: "{input} in / {output} out", noPaidTokens: "No model API calls",
    fallbackProvider: "Deterministic base report (DeepSeek fallback)", fallbackUsage: "{input} in / {output} out (before failure; may be billed)", stageBrief: "project overview", stageAngles: "content angles", stageContent: "spoken explainer", stageUnknown: "model generation",
    fallbackMessage: "DeepSeek did not return a complete result during {stage}. This page uses deterministic analysis, discards partial model content, and adds no paid retry. The failed stage recorded {calls} request(s); earlier completed stages may also have been billed.",
    genericModeHeading: "This run used generic text mode", genericModeMessage: "This run read the README, configuration and selected source as text. Function and cross-file call analysis is not available for non-JavaScript/TypeScript files.",
    invalidUrl: "Enter a public repository URL in the form https://github.com/owner/repository, without a branch, query, or file path.", consentRequired: "DeepSeek uses the selected account balance. Confirm paid model usage first.", localServerUnavailable: "The browser cannot reach the local analysis service. Confirm that npm run web is still running.",
    clearedGithubEnvironment: "Input cleared; token mode will use the locally configured GitHub token.", clearedGithubAnonymous: "Input cleared; switch to anonymous access if no token is available.", clearedDeepSeekEnvironment: "Input cleared; DeepSeek can use the locally configured key.", clearedDeepSeekRequired: "Input cleared; enter your own key before using DeepSeek.",
    copied: "Copied", copyFailed: "Copy failed; select the text manually",
  },
};

function initialLocale() {
  try {
    const saved = window.localStorage.getItem("repo-evidence-locale");
    if (saved === "zh-CN" || saved === "en") return saved;
  } catch {}
  return navigator.language?.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

let currentLocale = initialLocale();

function t(key, replacements = {}) {
  let value = COPY[currentLocale][key]
    ?? RUNTIME_COPY[currentLocale][key]
    ?? COPY["zh-CN"][key]
    ?? RUNTIME_COPY["zh-CN"][key]
    ?? key;
  for (const [name, replacement] of Object.entries(replacements)) {
    value = value.replaceAll(`{${name}}`, String(replacement));
  }
  return value;
}

const form = document.querySelector("#analyze-form");
const repositoryInput = document.querySelector("#repository-url");
const analyzeButton = document.querySelector("#analyze-button");
const exampleButton = document.querySelector("#example-button");
const runState = document.querySelector("#run-state");
const elapsedTime = document.querySelector("#elapsed-time");
const errorPanel = document.querySelector("#error-panel");
const errorCode = document.querySelector("#error-code");
const errorMessage = document.querySelector("#error-message");
const retryButton = document.querySelector("#retry-button");
const resultShell = document.querySelector("#result-shell");
const fallbackNotice = document.querySelector("#fallback-notice");
const genericModeNotice = document.querySelector("#generic-mode-notice");
const evidenceFilter = document.querySelector("#evidence-filter");
const githubAccessMode = document.querySelector("#github-access-mode");
const githubTokenControls = document.querySelector("#github-token-controls");
const githubTokenInput = document.querySelector("#github-token");
const providerSelect = document.querySelector("#provider-select");
const deepseekControls = document.querySelector("#ai-controls");
const paidModelConsent = document.querySelector("#paid-model-consent");
const githubStatus = document.querySelector("#github-status");
const modeSummary = document.querySelector("#mode-summary");
let providerManager;

function modelText(zh, en) { return currentLocale === "en" ? en : zh; }
function modelLabel(id = providerSelect.value) {
  return ({ deepseek: "DeepSeek", openai: "OpenAI", zhipu: "智谱 GLM", qwen: "Qwen (Beijing)", "qwen-intl": "Qwen (Singapore)", "custom-openai-chat": "AI (Chat Completions)", "custom-anthropic-messages": "AI (Anthropic Messages)" })[id.replace(/-api$/, "")] || id;
}

const ERROR_COPY_EN = {
  REPOSITORY_URL_INVALID: "Enter a canonical public GitHub repository URL.",
  PAID_MODEL_CONSENT_REQUIRED: "Confirm paid model usage before analysis.",
  MODEL_API_KEY_REQUIRED: "Enter your API key for the selected provider or configure its local environment variable.",
  MODEL_API_KEY_INVALID: "The selected API key is invalid or expired.",
  MODEL_NOT_AVAILABLE: "Check the model ID and the API key's access permissions.",
  MODEL_RATE_LIMIT: "The provider is rate-limiting requests. Try later.",
  MODEL_CONNECTION_FAILED: "Provider verification failed. Check network, key permissions and model availability. No content generation was requested.",
  INVALID_MODEL_NAME: "Enter a model ID, not a URL or API key.",
  INVALID_MODEL_CONNECTION: "Check the provider name, public HTTPS base URL, API format and model ID.",
  MODEL_ENDPOINT_BLOCKED: "Local, private and reserved addresses cannot receive model keys. Use a public HTTPS service.",
  MODEL_DNS_FAILED: "Cannot resolve the model server. Check its base URL and network.",
  DEEPSEEK_API_KEY_REQUIRED: "Enter a DeepSeek API key or configure one locally.",
  DEEPSEEK_API_KEY_INVALID: "The DeepSeek API key is invalid or expired.",
  DEEPSEEK_BALANCE_EMPTY: "The DeepSeek account does not have enough available balance.",
  DEEPSEEK_RATE_LIMIT: "DeepSeek is rate-limiting requests. Try again later.",
  GITHUB_TOKEN_INVALID: "The GitHub token is invalid or expired. Clear it and use anonymous access, or enter a new token.",
  GITHUB_RATE_LIMIT: "The GitHub read quota is exhausted. Try later or use a GitHub token.",
  REPOSITORY_NOT_AVAILABLE: "The repository does not exist, is private, or cannot currently be accessed.",
  ANALYSIS_BUSY: "Another repository is being analyzed. Wait for it to finish.",
  ANALYSIS_FAILED: "The analysis did not pass every required gate.",
};

let elapsedTimer = null;
let currentResult = null;
let currentEvidence = [];
let evidenceLimit = 12;
let capabilities = null;
let translationView = null;
let library = null;

function setText(selector, value) {
  const target = document.querySelector(selector);
  if (target) target.textContent = String(value ?? "");
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function clear(element) {
  element.replaceChildren();
}

function refreshDeepSeekStatus() {
  providerManager?.render();
}

function applyLocale(locale, persist = true) {
  currentLocale = locale === "en" ? "en" : "zh-CN";
  document.documentElement.lang = currentLocale;
  for (const element of document.querySelectorAll("[data-i18n]")) {
    element.textContent = t(element.dataset.i18n);
  }
  for (const element of document.querySelectorAll("[data-i18n-placeholder]")) {
    element.setAttribute("placeholder", t(element.dataset.i18nPlaceholder));
  }
  for (const element of document.querySelectorAll("[data-i18n-aria-label]")) {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
  }
  for (const button of document.querySelectorAll("#language-switch [data-locale]")) {
    button.setAttribute("aria-pressed", String(button.dataset.locale === currentLocale));
  }
  if (persist) {
    try { window.localStorage.setItem("repo-evidence-locale", currentLocale); } catch {}
  }
  document.title = currentResult
    ? t("resultTitle", { name: currentResult.repository.name })
    : t("pageTitle");
  providerChanged();
  githubModeChanged();
  if (capabilities) refreshDeepSeekStatus();
  if (currentResult) renderResult(currentResult, false);
  library?.render();
}

function showLoading() {
  translationView?.cancel();
  setReportView(false, false);
  errorPanel.hidden = true;
  resultShell.hidden = true;
  runState.hidden = false;
  analyzeButton.disabled = true;
  document.querySelector("#resume-report").disabled = true;
  form.setAttribute("aria-busy", "true");
  setText("#analyze-button [data-i18n='analyzeButton']", t("analyzingButton"));
  const started = Date.now();
  elapsedTime.textContent = "0";
  elapsedTimer = window.setInterval(() => {
    elapsedTime.textContent = String(Math.floor((Date.now() - started) / 1000));
  }, 1000);
  scrollToElement(runState);
}

function stopLoading() {
  if (elapsedTimer !== null) window.clearInterval(elapsedTimer);
  elapsedTimer = null;
  runState.hidden = true;
  analyzeButton.disabled = false;
  document.querySelector("#resume-report").disabled = false;
  form.removeAttribute("aria-busy");
  setText("#analyze-button [data-i18n='analyzeButton']", t("analyzeButton"));
}

function showError(code, message) {
  stopLoading();
  setReportView(false, false);
  resultShell.hidden = true;
  errorPanel.hidden = false;
  errorCode.textContent = code || "ANALYSIS_FAILED";
  errorMessage.textContent =
    currentLocale === "en" && ERROR_COPY_EN[code]
      ? ERROR_COPY_EN[code]
      : message || t("genericFailure");
  if (code?.startsWith("GITHUB_")) document.querySelector("#access-settings").open = true;
  scrollToElement(errorPanel);
}

function setConnectionStatus(target, message, state = "") {
  target.textContent = message;
  if (state) target.dataset.state = state;
  else target.removeAttribute("data-state");
}

function providerChanged(reset = false) {
  if (reset === true) paidModelConsent.checked = false;
  const usesDeepSeek = providerSelect.value !== "deterministic";
  const selected = providerManager?.selected();
  const destination = selected ? `${selected.configuration.name} · ${selected.configuration.baseUrl} · ${selected.configuration.model}` : modelText("尚未配置供应商", "No provider configured");
  deepseekControls.hidden = !usesDeepSeek;
  setText("#mode-help", usesDeepSeek
    ? modelText("按所选语言补充解读，并保留引用用于核对。使用你自己的 API 账户额度或余额，需要先配置供应商和密钥。", "Adds explanations in the selected language and preserves citations for checking. Uses your own API account credits or balance. Configure a provider and key first.")
    : modelText("无需模型密钥，也没有模型额度。按规则整理原文；阅读时会按顶部语言在本机自动翻译，不产生模型 API 费用。", "No model key or model credits. Organizes source text using fixed rules; reading is translated on-device for the top language without model API charges."));
  modeSummary.textContent = usesDeepSeek
    ? modelText("AI 模式使用你配置的模型，费用由你的 API 账户承担。模型生成失败时显示免费报告，不自动付费重试。", "Current: AI analysis with your own provider and key. Provider errors fall back to a free base report without paid retries.")
    : t("modeDeterministic");
  setText("#ai-mode-option", modelText("AI 深入解读（使用自己的 API）", "AI in-depth explanation (your API)"));
  setText("#custom-paid-consent", modelText(`我信任此端点：${destination}。同意向它发送仓库文本与 API Key，并承担模型费用。`, `I trust ${destination}. Send repository text and my API key to this endpoint; I accept the model charges.`));
}

function githubModeChanged() {
  const usesToken = githubAccessMode.value === "token";
  setText("#access-settings-note", usesToken ? modelText("当前使用自己的 Token", "Using your own token") : t("accessSettingsNote"));
  githubTokenControls.hidden = !usesToken;
  githubTokenInput.disabled = !usesToken;
  setConnectionStatus(
    githubStatus,
    usesToken
      ? capabilities?.github?.environment_credential_available
        ? t("githubTokenEnvironment")
        : t("githubTokenRequired")
      : t("githubAnonymousLocked"),
  );
  if (!usesToken && errorCode.textContent === "GITHUB_TOKEN_INVALID") {
    errorPanel.hidden = true;
  }
}

async function loadCapabilities() {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) return;
    capabilities = await response.json();
    githubModeChanged();
    providerChanged();
    refreshDeepSeekStatus();
  } catch {
    setConnectionStatus(githubStatus, t("localStatusUnavailable"), "fail");
  }
}

async function testConnection(kind, credential, target, button, mode) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = t("testing");
  setConnectionStatus(target, t("testingConnection"));
  try {
    const body = credential ? { kind, credential } : { kind };
    if (kind === "github") body.mode = mode;
    const response = await fetch("/api/connections/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      const safeMessage =
        currentLocale === "en" && ERROR_COPY_EN[data.error?.code]
          ? ERROR_COPY_EN[data.error.code]
          : data.error?.message || t("connectionFailed");
      setConnectionStatus(target, safeMessage, "fail");
      return;
    }
    if (kind === "github") {
      const mode = data.authentication === "authenticated" ? t("authenticated") : t("anonymous");
      const quota =
        data.remaining === null || data.limit === null
          ? t("quotaUnavailable")
          : t("quotaRemaining", { remaining: data.remaining, limit: data.limit });
      const reset = data.reset_at
        ? t("resetAt", { time: new Date(data.reset_at).toLocaleString(currentLocale) })
        : "";
      setConnectionStatus(
        target,
        data.remaining === 0
          ? t("githubConnectedLimited", { mode, reset })
          : t("githubConnected", { mode, quota, reset }),
        data.remaining === 0 ? "fail" : "pass",
      );
    } else if (data.status === "CONFIGURATION_ONLY") {
      setConnectionStatus(target, modelText("配置格式已检查；没有连接服务商、没有调用模型。这不代表密钥有效或余额充足，实际分析时才能确认。", "Configuration checked locally only; no provider connection or inference. Key validity and balance are not verified and will be checked during analysis."));
    } else if (kind === "openai") {
      setConnectionStatus(target, modelText("OpenAI 密钥及模型信息访问通过；未生成内容。余额、模型生成权限和 JSON 输出能力未验证。", "OpenAI authentication and model metadata access passed. No generation; balance, generation permissions and JSON capability remain unverified."), "pass");
    } else {
      const balances = (data.balances || [])
        .map((item) => `${item.total_balance} ${item.currency}`)
        .join(" / ");
      setConnectionStatus(
        target,
        data.balance_available
          ? t("deepseekBalance", { balance: balances || t("providerConfirmed") })
          : t("balanceUnavailable"),
        data.balance_available ? "pass" : "fail",
      );
    }
  } catch {
    setConnectionStatus(target, t("browserCannotConnect"), "fail");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
    if (kind !== "github") providerChanged();
  }
}

function renderTags(target, values) {
  clear(target);
  const entries = values && values.length ? values : [t("unconfirmed")];
  for (const value of entries) target.append(makeElement("span", "tag", value));
}

function renderModules(data) {
  const target = document.querySelector("#module-map");
  clear(target);
  if (!data.modules.length) {
    target.append(makeElement("p", "empty-message", t("noModules")));
    return;
  }
  for (const module of data.modules) {
    const card = makeElement("article", "module-card");
    card.append(makeElement("h4", "", module.short_name || module.name));
    card.append(
      makeElement(
        "span",
        `module-source ${module.explanation_source === "model_interpretation" ? "model" : "verified"}`,
        module.explanation_source === "model_interpretation"
          ? t("aiInterpretation")
          : t("verifiedStructure"),
      ),
    );
    card.append(makeElement("p", "", module.explanation || module.responsibility));
    card.append(makeElement("code", "", module.source_paths.join(" · ")));
    target.append(card);
  }
}

function renderRelationships(data) {
  const target = document.querySelector("#relationship-list");
  const summary = document.querySelector("#relationship-summary");
  clear(target);
  clear(summary);
  const moduleNames = new Map(
    data.modules.map((module) => [module.id, module.short_name || module.name]),
  );
  const stats = data.relationship_summary;
  for (const label of [
    t("crossModuleCount", { count: stats.cross_module }),
    t("importCount", { count: stats.imports }),
    t("callCount", { count: stats.calls }),
    t("internalCount", { count: stats.internal_calls }),
  ]) {
    summary.append(makeElement("span", "relationship-chip", label));
  }
  if (!data.relationships.length) {
    target.append(makeElement("p", "empty-message", t("noRelationships")));
    return;
  }
  const visibleRelationships = data.relationships.slice(0, 16);
  for (const relation of visibleRelationships) {
    const row = makeElement("div", "relationship-row");
    row.append(makeElement("span", "", moduleNames.get(relation.from_module_id) || relation.from_module_id));
    row.append(
      makeElement(
        "span",
        "",
        t("relationArrow", { type: relation.relationship_type.toUpperCase() }),
      ),
    );
    row.append(makeElement("span", "", moduleNames.get(relation.to_module_id) || relation.to_module_id));
    row.title = relation.description;
    target.append(row);
  }
  if (data.relationships.length > visibleRelationships.length) {
    target.append(
      makeElement(
        "p",
        "empty-message",
        t("relationshipMore", {
          shown: visibleRelationships.length,
          total: data.relationships_total,
        }),
      ),
    );
  }
}

function renderEvidence(filterValue = "") {
  const target = document.querySelector("#evidence-list");
  const empty = document.querySelector("#evidence-empty");
  const showing = document.querySelector("#evidence-showing");
  const moreButton = document.querySelector("#evidence-more");
  const filter = filterValue.trim().toLocaleLowerCase();
  const matching = currentEvidence.filter((record) =>
    [record.id, record.claim, record.location, record.source_kind]
      .join(" ")
      .toLocaleLowerCase()
      .includes(filter),
  );
  const visible = matching.slice(0, filter ? 40 : evidenceLimit);
  clear(target);
  for (const record of visible) {
    const row = makeElement("article", "evidence-row");
    const meta = makeElement("div", "evidence-meta");
    meta.append(makeElement("code", "", record.id));
    meta.append(makeElement("span", "evidence-status", record.status.toUpperCase()));
    const body = makeElement("div", "");
    body.append(makeElement("p", "evidence-claim", record.claim));
    body.append(makeElement("div", "evidence-location", record.location));
    row.append(meta, body);
    target.append(row);
  }
  empty.hidden = matching.length !== 0;
  document.querySelector("#clear-evidence-filter").hidden = !filter;
  showing.textContent = t("evidenceShowing", {
    shown: visible.length,
    total: matching.length,
  });
  moreButton.hidden = Boolean(filter) || visible.length >= matching.length;
}

function renderAngles(data) {
  const target = document.querySelector("#angle-list");
  clear(target);
  if (!data.angles.length) {
    target.append(
      makeElement(
        "p",
        "empty-message",
        t("noAngles"),
      ),
    );
    return;
  }
  for (const angle of data.angles) {
    const card = makeElement("article", "angle-card");
    card.append(
      makeElement("span", "", t("angleRank", { rank: angle.rank ?? "—", category: angle.category })),
    );
    card.append(makeElement("h4", "", angle.title));
    card.append(makeElement("p", "", angle.why_interesting || angle.hook));
    target.append(card);
  }
}

function guidePresentation(data) {
  const hasModel = Boolean(data.project_guide?.model_interpretation?.summary?.trim());
  return { hasModel };
}

let displayedGuideResult = null;
function renderGuide(data) {
  const guide = data.project_guide;
  const model = guide?.model_interpretation;
  const presentation = guidePresentation(data);
  document.querySelector("#configure-ai-analysis").hidden = presentation.hasModel;
  if (displayedGuideResult !== data) {
    document.querySelector("#guide-original").open = !presentation.hasModel;
    displayedGuideResult = data;
  }
  setText("#project-sentence", guide?.introduction[0]?.text || data.overview.one_sentence);
  setText("#project-summary", guide?.summary || data.overview.summary);
  document.querySelector("#guide-interpretation").hidden = !presentation.hasModel;
  setText("#guide-model-summary", model?.summary || "");
  setText("#project-problem", model?.problem || guide?.problem || t("unconfirmed"));
  setText("#problem-basis", model?.problem ? t("guideInferred") : guide?.problem ? t("guideDocumented") : "");
  const audience = model?.audience?.length ? model.audience : guide?.audience || [];
  setText("#audience-basis", model?.audience?.length ? t("guideInferred") : audience.length ? t("guideDocumented") : "");
  renderTags(document.querySelector("#target-users"), audience.length ? audience : [t("unconfirmed")]);
  const sourceLink = (excerpt) => {
    const link = makeElement("a", "guide-source", `${excerpt.path}:${excerpt.line_start}–${excerpt.line_end}`);
    link.href = excerpt.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  };
  const sources = document.querySelector("#guide-sources");
  clear(sources);
  for (const excerpt of (guide?.introduction || []).slice(0, 3)) sources.append(sourceLink(excerpt));
  for (const key of ["features", "usage", "caveats"]) {
    const target = document.querySelector(`#guide-${key}`);
    clear(target);
    const excerpts = guide?.[key] || [];
    if (!excerpts.length) target.append(makeElement("li", "guide-missing", t("guideMissing")));
    for (const excerpt of excerpts) {
      const item = makeElement("li", "");
      if (excerpt.format === "code") {
        item.append(makeElement("p", "guide-label", t("guideCode")));
        const block = makeElement("pre", "guide-code");
        block.append(makeElement("code", "", excerpt.text));
        item.append(block);
      } else item.append(makeElement("p", "", excerpt.text));
      item.append(sourceLink(excerpt));
      target.append(item);
    }
  }
  setText("#guide-coverage", guide?.coverage || "");
}

function renderBoundaries(data) {
  const limitations = document.querySelector("#limitations-list");
  const unknowns = document.querySelector("#unknowns-list");
  clear(limitations);
  clear(unknowns);
  const limitationItems = data.limitations.length
    ? data.limitations
    : [{ description: t("noLimitations"), impact: "" }];
  for (const item of limitationItems) {
    limitations.append(makeElement("li", "", `${item.description} ${item.impact}`.trim()));
  }
  const unknownItems = data.unknowns.length
    ? data.unknowns
    : [{ question: t("noUnknowns") }];
  for (const item of unknownItems) unknowns.append(makeElement("li", "", item.question));
}

function renderDownloads(data) {
  setText("#artifact-directory", t("artifactDirectory", { path: data.artifacts.directory }));
  const target = document.querySelector("#download-list");
  clear(target);
  for (const item of data.artifacts.downloads) {
    const link = makeElement("a", "download-link", item.name);
    link.href = item.url;
    link.download = item.name;
    target.append(link);
  }
}

function renderGates(data) {
  const target = document.querySelector("#gate-list");
  clear(target);
  for (const gate of data.quality_gates) {
    const item = makeElement("li", "");
    item.append(makeElement("span", "", gate.id));
    item.append(makeElement("b", "", gate.passed ? t("gatePass") : t("gateFail")));
    target.append(item);
  }
}

function renderResult(data, scroll = true) {
  currentResult = data;
  currentEvidence = data.evidence;
  evidenceLimit = 12;
  evidenceFilter.value = "";
  errorPanel.hidden = true;
  resultShell.hidden = !document.body.classList.contains("reading-report");
  document.querySelector("#resume-report").hidden = false;
  document.title = t("resultTitle", { name: data.repository.name });

  setText("#project-name", data.repository.name);
  renderGuide(data);
  translationView?.show(data, currentLocale);
  setText("#commit-short", data.repository.commit_short);
  setText(
    "#relationship-count",
    t("relationshipCount", {
      count: data.relationship_summary.cross_module,
    }),
  );
  setText(
    "#evidence-count",
    t("evidenceCount", { shown: data.evidence_shown, total: data.evidence_total }),
  );
  setText("#mermaid-source", data.architecture_mermaid);
  setText("#files-seen", data.analysis.files_seen);
  setText("#files-read", data.analysis.files_read);
  setText("#evidence-total", data.evidence_total);
  setText("#module-total", data.modules.length);
  setText(
    "#duration",
    t("durationSeconds", { seconds: (data.analysis.duration_ms / 1000).toFixed(1) }),
  );
  genericModeNotice.hidden = data.analysis.repository_mode !== "generic_text";
  const fallback = data.analysis.fallback;
  if (fallback?.used) {
    const stageNames = {
      brief: t("stageBrief"),
      angles: t("stageAngles"),
      content: t("stageContent"),
    };
    const stageName = stageNames[fallback.failed_stage] || t("stageUnknown");
    fallbackNotice.hidden = false;
    setText("#result-kicker", t("fallbackResultKicker"));
    setText("#fallback-stage", `${stageName} · ${fallback.failure_code}`);
    setText(
      "#fallback-message",
      t("fallbackMessage", { stage: stageName, calls: fallback.network_calls }).replace("DeepSeek", modelLabel(fallback.from_provider)),
    );
    setText("#provider-used", t("fallbackProvider").replace("DeepSeek", modelLabel(fallback.from_provider)));
    setText(
      "#model-usage",
      t("fallbackUsage", {
        input: fallback.input_tokens,
        output: fallback.output_tokens,
      }),
    );
  } else {
    fallbackNotice.hidden = true;
    setText("#result-kicker", t("resultKicker"));
    setText(
      "#provider-used",
      data.analysis.paid
        ? t("paidModel", { model: data.analysis.model })
        : t("deterministicFree"),
    );
    setText(
      "#model-usage",
      data.analysis.paid
        ? t("tokenUsage", {
            input: data.analysis.input_tokens,
            output: data.analysis.output_tokens,
          })
        : t("noPaidTokens"),
    );
  }

  const repositoryLink = document.querySelector("#repository-link");
  repositoryLink.textContent = `${data.repository.owner}/${data.repository.repository_name}`;
  repositoryLink.href = data.repository.url;
  setText("#commit-full", data.repository.commit_sha);

  renderTags(document.querySelector("#technologies"), data.technologies.map((item) => item.name));
  renderModules(data);
  renderRelationships(data);
  renderEvidence();
  renderAngles(data);
  renderBoundaries(data);
  renderDownloads(data);
  renderGates(data);

  if (scroll) setReportView(true);
}

function scrollToElement(element) {
  element.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
}

function setReportView(reading, focus = true) {
  const showReport = reading && Boolean(currentResult);
  document.body.classList.toggle("reading-report", showReport);
  for (const id of ["workspace", "method", "boundary", "library"]) document.getElementById(id).hidden = showReport;
  resultShell.hidden = !showReport;
  document.querySelector(".skip-link").href = showReport ? "#project-name" : "#workspace";
  if (showReport) errorPanel.hidden = true;
  if (focus) {
    const target = showReport ? document.querySelector("#project-name") : repositoryInput;
    target.focus({ preventScroll: true });
    scrollToElement(showReport ? resultShell : document.querySelector("#workspace"));
  }
  updateReportNavigation();
}

function updateReportNavigation() {
  if (resultShell.hidden) return;
  const links = [...document.querySelectorAll(".result-nav a")];
  let active = links[0];
  for (const link of links) {
    const section = document.querySelector(link.getAttribute("href"));
    if (section.getBoundingClientRect().top <= 140) active = link;
  }
  for (const link of links) {
    if (link === active) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  }
}

let navigationFrame = 0;
window.addEventListener("scroll", () => {
  if (navigationFrame) return;
  navigationFrame = requestAnimationFrame(() => { navigationFrame = 0; updateReportNavigation(); });
}, { passive: true });
document.querySelector("#back-to-settings").addEventListener("click", () => setReportView(false));
document.querySelector("#configure-ai-analysis").addEventListener("click", () => {
  setReportView(false, false);
  providerSelect.value = "custom";
  providerChanged(true);
  document.querySelector("#manage-providers").focus({ preventScroll: true });
  scrollToElement(document.querySelector("#provider-select"));
});
document.querySelector("#resume-report").addEventListener("click", () => setReportView(true));
document.querySelector(".brand").addEventListener("click", (event) => {
  event.preventDefault();
  setReportView(false);
});
document.querySelector("#clear-evidence-filter").addEventListener("click", () => {
  evidenceFilter.value = "";
  renderEvidence();
  evidenceFilter.focus();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (analyzeButton.disabled) return;
  const url = repositoryInput.value.trim();
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(url)) {
    showError("REPOSITORY_URL_INVALID", t("invalidUrl"));
    repositoryInput.focus();
    return;
  }

  const provider = providerSelect.value;
  await providerManager.ready;
  const selectedConnection = providerManager.selected();
  if (provider === "custom" && (!selectedConnection || (!selectedConnection.apiKey.trim() && !selectedConnection.credentialId))) {
    showError("MODEL_API_KEY_REQUIRED", modelText("请先添加供应商、选择模型，并保存这个供应商自己的 API Key。", "Add a provider, select a model and save its API key first."));
    providerManager.open();
    return;
  }
  if (provider !== "deterministic" && !paidModelConsent.checked) {
    showError("PAID_MODEL_CONSENT_REQUIRED", modelText("智能分析会消耗密钥所属账户的余额，请先勾选费用确认。", "Confirm paid model usage first."));
    paidModelConsent.focus();
    return;
  }

  void translationView?.prepare(currentLocale);
  showLoading();
  try {
    const githubAuthMode = githubAccessMode.value === "token" ? "token" : "anonymous";
    const request = { url, provider, githubAuthMode, locale: currentLocale };
    if (githubAuthMode === "token" && githubTokenInput.value.trim()) {
      request.githubToken = githubTokenInput.value.trim();
    }
    if (provider !== "deterministic") {
      if (selectedConnection.apiKey.trim()) request.apiKey = selectedConnection.apiKey.trim();
      else request.credentialId = selectedConnection.credentialId;
      request.paidModelConsent = true;
      request.customProvider = selectedConnection.configuration;
    }
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const data = await response.json();
    if (!response.ok) {
      showError(data.error?.code, data.error?.message);
      return;
    }
    stopLoading();
    renderResult(data);
    await library.refresh();
    if (data.history_warning) {
      library.warning();
      alert(modelText("报告已生成，但未能保存到历史。请先下载报告，再检查磁盘空间与权限。", "Report generated but history could not be saved. Download it now and check disk space and permissions."));
    }
  } catch {
    showError("LOCAL_SERVER_UNAVAILABLE", t("localServerUnavailable"));
  }
});

providerSelect.addEventListener("change", () => providerChanged(true));
githubAccessMode.addEventListener("change", githubModeChanged);

document.querySelector("#test-github").addEventListener("click", (event) =>
  testConnection(
    "github",
    githubAccessMode.value === "token" ? githubTokenInput.value.trim() : "",
    githubStatus,
    event.currentTarget,
    githubAccessMode.value === "token" ? "token" : "anonymous",
  ),
);


document.querySelector("#clear-github").addEventListener("click", () => {
  githubTokenInput.value = "";
  setConnectionStatus(
    githubStatus,
    capabilities?.github?.environment_credential_available
      ? t("clearedGithubEnvironment")
      : t("clearedGithubAnonymous"),
  );
  githubTokenInput.focus();
});


exampleButton.addEventListener("click", () => {
  repositoryInput.value = "https://github.com/tinylibs/tinyspy";
  repositoryInput.focus();
});

retryButton.addEventListener("click", () => {
  errorPanel.hidden = true;
  repositoryInput.focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

evidenceFilter.addEventListener("input", () => renderEvidence(evidenceFilter.value));

document.querySelector("#evidence-more").addEventListener("click", () => {
  evidenceLimit += 20;
  renderEvidence(evidenceFilter.value);
});

document.querySelector("#download-summary").addEventListener("click", () => {
  if (!currentResult) return;
  const readingTranslation = translationView?.current();
  const downloaded = readingTranslation ? { ...currentResult, reading_translation: { ...readingTranslation, fact_checked: false } } : currentResult;
  const blob = new Blob([`${JSON.stringify(downloaded, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${currentResult.repository.owner}-${currentResult.repository.repository_name}-${currentResult.repository.commit_short}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

document.querySelector("#language-switch").addEventListener("click", (event) => {
  const button = event.target.closest("[data-locale]");
  if (!button) return;
  void translationView?.prepare(button.dataset.locale);
  applyLocale(button.dataset.locale);
});

providerManager = createProviderManager({ getLocale: () => currentLocale, onChange: () => providerChanged(true) });
translationView = createLocalTranslation({ document, t });
library = createLibrary({ getLocale: () => currentLocale, openReport: data => renderResult(data) });
document.querySelector("#open-library").addEventListener("click", () => {
  setReportView(false, false);
  document.querySelector("#library-search").focus({ preventScroll: true });
  scrollToElement(document.querySelector("#library"));
});
applyLocale(currentLocale, false);
providerManager.render();
loadCapabilities();
