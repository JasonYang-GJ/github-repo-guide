export type AnalysisLocale = "zh-CN" | "en";

export function isAnalysisLocale(value: unknown): value is AnalysisLocale {
  return value === "zh-CN" || value === "en";
}

export function localized(
  locale: AnalysisLocale,
  chinese: string,
  english: string,
): string {
  return locale === "zh-CN" ? chinese : english;
}
