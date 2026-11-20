export const DEFAULT_AGENT_PROMPT = "以下是需要分析的日志文件路径：{filePath}\n\n请围绕我的问题分析该日志，只提取与问题相关的内容，忽略无关信息。不要主动读取其他日志文件，但我在问题中明确要求查看的文件（如源码、配置等）除外。结论优先，细节随后。\n\n我的问题：";

export const FILE_PATH_PLACEHOLDER = "{filePath}";

export function renderAgentPrompt(template: string, filePath: string) {
  return template.split(FILE_PATH_PLACEHOLDER).join(filePath);
}
