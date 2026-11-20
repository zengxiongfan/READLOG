import { ClipboardCopy, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { DEFAULT_AGENT_PROMPT, FILE_PATH_PLACEHOLDER, renderAgentPrompt } from "../lib/agentPrompt";
import { invoke } from "../lib/runtime";
import { useServerStore } from "../store/serverStore";

interface Props {
  filePath: string;
  onClose: () => void;
  onCopied: () => void;
}

export function PromptModal({ filePath, onClose, onCopied }: Props) {
  const config = useServerStore((state) => state.config);
  const save = useServerStore((state) => state.save);
  const [template, setTemplate] = useState(() => config?.settings.agentPromptTemplate || DEFAULT_AGENT_PROMPT);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  if (!config) return null;

  const preview = renderAgentPrompt(template, filePath);
  const canCopy = template.trim().length > 0;

  const handleSaveDefault = async () => {
    if (!canCopy) { setError("提示词模板不能为空"); return; }
    setError("");
    await save({ ...config, settings: { ...config.settings, agentPromptTemplate: template } });
    if (useServerStore.getState().error) return;
    setNote("已保存为默认模板");
  };

  const handleCopy = async () => {
    if (!canCopy) { setError("提示词模板不能为空"); return; }
    setError("");
    try {
      await invoke("copy_agent_prompt", { text: preview });
      onCopied();
    } catch (caught) {
      setError(String(caught));
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#162033]/35" onClick={onClose}>
      <div className="flex max-h-[85vh] w-[680px] max-w-[92vw] flex-col rounded-lg border border-[#d9e0eb] bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#e3e8f0] px-5 py-4">
          <h2 className="text-base font-semibold">复制提示词</h2>
          <button className="rounded-md p-1.5 text-[#5d6b82] hover:bg-[#eef3f8]" type="button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <label className="block text-sm font-medium">
            提示词模板
            <span className="ml-2 text-xs font-normal text-[#69778c]">{FILE_PATH_PLACEHOLDER} 将替换为本次日志路径</span>
            <textarea
              className="mt-1 h-44 w-full resize-y rounded-md border border-[#cfd8e6] bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-[#2563eb]"
              value={template}
              onChange={(event) => { setTemplate(event.target.value); setNote(""); }}
            />
          </label>

          <div>
            <div className="mb-1 text-xs text-[#69778c]">本次将复制的内容（路径已替换，随模板实时更新）</div>
            <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all rounded-md border border-[#e3e8f0] bg-[#f8fafc] px-3 py-2 text-xs leading-5 text-[#243145]">{preview}</pre>
          </div>

          {note && <div className="rounded-md bg-[#ecfdf3] px-3 py-2 text-sm text-[#047857]">{note}</div>}
          {error && <div className="rounded-md bg-[#fff1f3] px-3 py-2 text-sm text-[#b42318]">{error}</div>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e3e8f0] px-5 py-4">
          <button
            className="inline-flex items-center gap-2 whitespace-nowrap rounded-md border border-[#cfd8e6] bg-white px-3 py-2 text-sm text-[#69778c] hover:bg-[#eef3f8]"
            type="button"
            onClick={() => { setTemplate(DEFAULT_AGENT_PROMPT); setNote(""); setError(""); }}
          >
            <RotateCcw size={15} /> 恢复默认模板
          </button>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button className="whitespace-nowrap rounded-md border border-[#cfd8e6] px-4 py-2 text-sm hover:bg-[#f2f5f9]" type="button" onClick={onClose}>
              取消
            </button>
            <button className="whitespace-nowrap rounded-md border border-[#2563eb] px-4 py-2 text-sm text-[#2563eb] hover:bg-[#eff5ff]" type="button" onClick={() => void handleSaveDefault()}>
              保存为默认
            </button>
            <button
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-md bg-[#7c3aed] px-4 py-2 text-sm font-medium text-white hover:bg-[#6d28d9] disabled:opacity-50"
              type="button"
              disabled={!canCopy}
              onClick={() => void handleCopy()}
            >
              <ClipboardCopy size={15} /> 复制
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
