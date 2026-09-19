const EXCERPT_FIELDS = ["introduction", "features", "usage", "caveats"];

export function groupReports(entries, { query = "", favoritesOnly = false } = {}) {
  const groups = new Map();
  const search = query.trim().toLocaleLowerCase();
  for (const entry of [...entries].sort((a, b) => b.savedAt.localeCompare(a.savedAt) || a.id.localeCompare(b.id))) {
    const key = `${entry.repository.owner}/${entry.repository.repository_name}`.toLowerCase();
    if (!groups.has(key)) groups.set(key, { key, name: `${entry.repository.owner}/${entry.repository.repository_name}`, entries: [], total: 0 });
    const group = groups.get(key); group.total++;
    if (favoritesOnly && !entry.starred) continue;
    if (search && !`${key} ${entry.repository.name} ${entry.note} ${entry.repository.commit_sha}`.toLocaleLowerCase().includes(search)) continue;
    group.entries.push(entry);
  }
  return [...groups.values()].filter(group => group.entries.length)
    .sort((a, b) => b.entries[0].savedAt.localeCompare(a.entries[0].savedAt) || a.key.localeCompare(b.key));
}

// Topic retrieval only. A keyword match never asserts platform support or safety.
export function comparisonDimensions(guide) {
  const values = [];
  const seen = new Set();
  for (const field of EXCERPT_FIELDS) for (const item of guide?.[field] || []) {
    if (typeof item.text !== "string" || typeof item.path !== "string" || typeof item.url !== "string") continue;
    const key = `${item.path}:${item.line_start}:${item.text}`;
    if (!seen.has(key)) { values.push(item); seen.add(key); }
  }
  const prose = values.filter(item => item.format !== "code");
  return [
    { id: "systems", zh: "系统支持", en: "Operating systems", excerpts: prose.filter(item => /\b(?:windows|macos|mac os|os x|linux|ubuntu|debian|android|ios|cross-platform)\b|操作系统|跨平台|系统支持|支持.{0,10}系统/i.test(item.text)) },
    { id: "models", zh: "模型与外部服务", en: "Models and external services", excerpts: prose.filter(item => /\b(?:api[ -]?keys?|llms?|openai|deepseek|anthropic|claude|ollama|model providers?|hosted models?|external services?)\b|模型|密钥|外部服务|云端|离线/i.test(item.text)) },
    { id: "setup", zh: "安装与部署", en: "Installation and deployment", excerpts: values.filter(item => /\b(?:install(?:ation)?|setup|deploy(?:ment)?|docker|npm|pnpm|yarn|pip|cargo|requirements?|prerequisites?|node\.js)\b|安装|部署|环境要求|启动|运行环境/i.test(item.text)) },
    { id: "storage", zh: "数据存储", en: "Data storage", excerpts: prose.filter(item => /\b(?:data|files?|notes?|credentials?|keys?)\b.{0,65}\b(?:stor(?:e[ds]?|age)|sav(?:e[ds]?|ing)|persist(?:ed|ence)?|local(?:ly)?|cloud|encrypt(?:ed|ion)?)\b|\b(?:local(?:ly)?|cloud|encrypted|sqlite|database|storage|persistence)\b|数据|数据库|存储|保存在|保存到|本地保存|云同步|加密/i.test(item.text)) },
  ];
}

export function matchingTranslation(original, translated) {
  if (!translated || original.format === "code") return null;
  for (const field of EXCERPT_FIELDS) {
    const items = translated[field] || [];
    const match = items.find(item => item.path === original.path && item.line_start === original.line_start && item.line_end === original.line_end && item.url === original.url);
    if (match?.format !== "code" && typeof match?.text === "string" && match.text !== original.text) return match.text;
  }
  return null;
}
