import type {
  ModelProvider,
  ModelResult,
  StructuredGenerationRequest,
} from "./provider.js";

function stringInput(input: Readonly<Record<string, unknown>>, key: string): string {
  const value = input[key];
  return typeof value === "string" && value.length > 0 ? value : "Unknown project";
}

function numberInput(input: Readonly<Record<string, unknown>>, key: string): number {
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export class DeterministicModelProvider implements ModelProvider {
  readonly id = "deterministic";

  async generateStructured<T>(
    request: StructuredGenerationRequest,
  ): Promise<ModelResult<T>> {
    const projectName = stringInput(request.untrustedRepositorySignals, "projectName");
    const english = /\bEnglish\b/.test(request.systemInstructions);
    let value: unknown;

    if (request.stage === "brief") {
      const description = stringInput(request.untrustedRepositorySignals, "description");
      const analyzedScope = stringInput(request.untrustedRepositorySignals, "analyzedScope");
      const moduleCount = numberInput(request.untrustedRepositorySignals, "moduleCount");
      const relationshipCount = numberInput(request.untrustedRepositorySignals, "relationshipCount");
      value = {
        oneSentence: description,
        summary: english
          ? `${description} This code-level analysis covers ${analyzedScope}, with ${moduleCount} source modules and ${relationshipCount} verifiable local import relationships identified statically.`
          : `${description} 本次代码级分析覆盖 ${analyzedScope}，静态识别了 ${moduleCount} 个源码模块和 ${relationshipCount} 条可核验的本地导入关系。`,
        problem: "",
        targetUsers: [],
      };
    } else if (request.stage === "angles") {
      const relationshipCount = numberInput(
        request.untrustedRepositorySignals,
        "relationshipCount",
      );
      value = {
        title:
          relationshipCount > 0
            ? english
              ? `How the modules in ${projectName} connect`
              : `${projectName} 的模块如何连接`
            : english
              ? `What can currently be verified about ${projectName}`
              : `${projectName} 目前能够核验什么`,
        hook: english
          ? "Start from a fixed commit and follow only evidence-backed conclusions."
          : "从固定提交出发，只跟随有证据支持的结论。",
        whyInteresting:
          relationshipCount > 0
            ? english
              ? "The local import graph provides a compact explanation path that can be checked again."
              : "本地导入图给出了一条紧凑、可重复核对的解释路径。"
            : english
              ? "When no architecture relationship can be verified, the analysis leaves the gap visible instead of inventing a complete story."
              : "即使没有可验证的架构关系，分析也不会为了完整而编造结论。",
      };
    } else {
      value = {
        opening: english
          ? `First pin ${projectName} to one exact commit, then explain how it is structured.`
          : `先把 ${projectName} 固定到一个明确提交，再谈它是怎么工作的。`,
        closing: english
          ? "If the evidence does not cover a conclusion, leave it unknown instead of filling the gap with a polished story."
          : "如果证据没有覆盖某个结论，就把它留作未知，而不是补成一个听起来完整的故事。",
      };
    }

    return {
      value: value as T,
      provider: "deterministic",
      model: "deterministic-v1",
      usage: { inputTokens: 0, outputTokens: 0 },
      networkCalls: 0,
      paid: false,
      context: {
        promptStage: request.stage,
        highestReadScope: request.repositoryReadReceipt.highestScope,
        filesConsidered: request.repositoryReadReceipt.filesConsidered,
        filesRead: request.repositoryReadReceipt.filesRead,
        filesPassed: [],
        repositoryCharactersPassed: 0,
        promptCharacters: 0,
        repairActions: [],
        schemaValidated: true,
        endpoint: "none",
      },
    };
  }
}
