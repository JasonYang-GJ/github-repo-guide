const SYMBOL_KIND: Readonly<Record<string, string>> = {
  function: "函数",
  method: "方法",
  class: "类",
  interface: "接口",
  type: "类型",
  module: "模块",
  variable: "变量",
  constant: "常量",
  other: "符号",
};

const EXACT_TEXT: Readonly<Record<string, string>> = {
  "The target repository was analyzed statically and never executed.":
    "本次只对目标仓库做静态分析，没有运行其代码。",
  "Runtime behavior, performance, and deployment behavior remain unverified.":
    "运行时行为、性能和部署效果仍未验证。",
  "What happens when the package runs?": "这个项目实际运行时会发生什么？",
  "What happens when the repository software runs?": "这个仓库里的软件实际运行时会发生什么？",
  "Which external services are used at runtime?": "这个项目运行时会使用哪些外部服务？",
  "Repository code execution is outside the security boundary.":
    "运行目标仓库代码不在本次安全范围内。",
  "A separately authorized runtime evaluation in an isolated environment.":
    "需要另行授权，并在隔离环境中做运行验证。",
  "Novelty was not compared with other repositories.":
    "本次没有与其他仓库比较内容新颖度。",
  "Relationships outside the retained module set are not represented.":
    "未保留模块之间的关系不会出现在当前报告中。",
  "No package.json was detected, so the repository used bounded generic text analysis.":
    "未检测到 package.json，因此本次使用了有限的通用文本分析。",
  "Multiple peer package.json files were detected, so no subproject was chosen arbitrarily and the repository used bounded generic text analysis.":
    "检测到多个同层 package.json，因此系统没有擅自选择某个子项目，而是使用有限的通用文本分析。",
  "Non-JavaScript/TypeScript files are shown as modules, but their symbols and cross-file call graph are not parsed by the current host analyzer.":
    "非 JavaScript/TypeScript 文件会作为模块列出，但当前本机分析器不会解析它们的符号和跨文件调用关系。",
  "A selected orientation file does not prove runtime behavior or a complete architecture.":
    "选中的项目说明或配置文件不能证明运行时行为，也不能证明完整架构。",
};

export function zhText(text: string): string {
  const exact = EXACT_TEXT[text];
  if (exact !== undefined) return exact;

  let match = /^Source module (.+) exists at the resolved commit\.$/.exec(text);
  if (match !== null) return `固定提交中存在源码模块 ${match[1]}。`;

  match = /^(function|method|class|interface|type|module|variable|constant|other) (.+) is declared in (.+)\.$/.exec(text);
  if (match !== null) {
    return `${SYMBOL_KIND[match[1] ?? ""] ?? "符号"} ${match[2]} 声明在 ${match[3]} 中。`;
  }

  match = /^Declares (.+)\.$/.exec(text);
  if (match !== null) return `声明 ${match[1]}。`;

  match = /^Contains the selected source file (.+)\.$/.exec(text);
  if (match !== null) return `包含选中的源码文件 ${match[1]}。`;

  match = /^(.+) imports (.+) through (.+)\.$/.exec(text);
  if (match !== null) return `${match[1]} 通过 ${match[3]} 导入 ${match[2]}。`;

  match = /^(.+) in (.+) contains a direct static call to (.+) in (.+)\.$/.exec(text);
  if (match !== null) {
    return `${match[2]} 中的 ${match[1]} 包含对 ${match[4]} 中 ${match[3]} 的直接静态调用。`;
  }

  match = /^In (.+) at (.+), a local branch throws when (.+)\.$/.exec(text);
  if (match !== null) {
    return `${match[2]} 中的 ${match[1]} 在条件 ${match[3]} 成立时会进入抛错分支。`;
  }

  match = /^The repository tree contains (TypeScript|JavaScript) source at (.+)\.$/.exec(text);
  if (match !== null) return `仓库树在 ${match[2]} 包含 ${match[1]} 源码。`;

  match = /^(.+) is declared in (.+) dependencies\.$/.exec(text);
  if (match !== null) return `${match[1]} 被声明为 ${match[2]} 的运行依赖。`;

  match = /^(.+) declares package type (.+)\.$/.exec(text);
  if (match !== null) return `${match[1]} 声明了包类型 ${match[2]}。`;

  match = /^package\.json describes (.+) as "(.+)"\.$/.exec(text);
  if (match !== null) return `package.json 将 ${match[1]} 描述为“${match[2]}”。`;

  match = /^package\.json names the package "(.+)"\.$/.exec(text);
  if (match !== null) return `package.json 中的包名为“${match[1]}”。`;

  match = /^package\.json declares export (.+)\.$/.exec(text);
  if (match !== null) return `package.json 声明了导出项 ${match[1]}。`;

  match = /^package\.json declares ESM entry (.+)\.$/.exec(text);
  if (match !== null) return `package.json 声明了 ESM 入口 ${match[1]}。`;

  match = /^(.+) declares CLI command (.+) at (.+)\.$/.exec(text);
  if (match !== null) return `${match[1]} 声明了 CLI 命令 ${match[2]}，入口为 ${match[3]}。`;

  match = /^(.+) declares a JSON Schema document at (.+)\.$/.exec(text);
  if (match !== null) return `${match[1]} 在 ${match[2]} 声明了 JSON Schema 文档。`;

  match = /^(.+) is the selected conventional package entry point\.$/.exec(text);
  if (match !== null) return `${match[1]} 是本次选中的常规包入口。`;

  match = /^Only (\d+) core modules were retained for readability\.$/.exec(text);
  if (match !== null) return `为了便于阅读，只保留了 ${match[1]} 个核心模块。`;

  return text;
}

export function zhStatus(status: string): string {
  return ({
    verified: "已核验",
    documentation: "项目文档",
    inferred: "推断",
    unknown: "未知",
  } as Readonly<Record<string, string>>)[status] ?? status;
}

export function zhSourceKind(sourceKind: string): string {
  return ({
    source_code: "源代码",
    manifest: "项目配置",
    configuration: "配置文件",
    documentation: "项目文档",
    repository_tree: "仓库文件树",
    analysis_reasoning: "分析推理",
  } as Readonly<Record<string, string>>)[sourceKind] ?? sourceKind;
}

export function zhRelationshipType(type: string): string {
  return ({
    imports: "导入",
    calls: "调用",
    reads: "读取",
    writes: "写入",
    configures: "配置",
    publishes: "发布",
    consumes: "消费",
    persists: "持久化",
    returns: "返回",
    contains: "包含",
    other: "其他",
    unknown: "未知",
  } as Readonly<Record<string, string>>)[type] ?? type;
}

export function zhAngleCategory(category: string): string {
  return category === "architecture_insight"
    ? "架构解读"
    : category === "educational_value"
      ? "理解价值"
      : category;
}

export function zhGateName(id: string): string {
  return ({
    schema_validity: "数据格式",
    evidence_paths: "证据路径",
    verified_claims: "已核验结论",
    claim_semantics: "结论边界",
    relationship_nodes: "模块关系",
    angle_references: "选题引用",
    confidence_ceiling: "置信度上限",
    script_grounding: "口播稿证据",
    mermaid_grounding: "架构图证据",
    instruction_isolation: "指令隔离",
    output_binding: "提交版本绑定",
  } as Readonly<Record<string, string>>)[id] ?? id;
}
