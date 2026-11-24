import { useEffect, useState } from "react";
import { AlertCircle, Bot, CheckCircle2, Copy, Info, X } from "lucide-react";
import { invoke, isTauriRuntime } from "../lib/runtime";

type AiAgentStatus = { cliPath: string; cliFound: boolean };
type CopyState = { ok: boolean; message: string } | null;

interface Props {
  onClose: () => void;
}

export function AiAgentModal({ onClose }: Props) {
  const [status, setStatus] = useState<AiAgentStatus | null>(null);
  const [loading, setLoading] = useState(isTauriRuntime());
  const [statusError, setStatusError] = useState("");
  const [copying, setCopying] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>(null);

  useEffect(() => {
    if (!isTauriRuntime()) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    invoke<AiAgentStatus>("ai_agent_status")
      .then((value) => {
        if (!cancelled) setStatus(value);
      })
      .catch((error) => {
        if (!cancelled) setStatusError(String(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const cliMissing = Boolean(status && !status.cliFound);
  const canCopy = isTauriRuntime() && !loading && !cliMissing;

  const copyInstallPrompt = async () => {
    setCopying(true);
    setCopyState(null);
    try {
      await invoke("copy_skill_install_prompt");
      setCopyState({ ok: true, message: "已复制。请粘贴给本机 AI Agent（Claude Code / Codex）。" });
    } catch (error) {
      setCopyState({ ok: false, message: `复制失败：${String(error)}` });
    } finally {
      setCopying(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-[#162033]/45 p-4"
      onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="接入 AI Agent"
        className="flex max-h-[85vh] w-[560px] max-w-[92vw] flex-col rounded-lg border border-[#d9e0eb] bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-[#e3e8f0] px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Bot size={18} className="text-[#2563eb]" />
            <h2 className="text-sm font-semibold">接入 AI Agent</h2>
          </div>
          <button className="rounded-md p-1.5 text-[#5d6b82] hover:bg-[#eef3f8]" type="button" aria-label="关闭" onClick={onClose} autoFocus>
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="text-sm leading-6 text-[#243145]">
            安装一次用户级 Skill，让 AI Agent（如 Claude Code / Codex）直接查询 GCIS 日志。
          </p>
          <div className="mt-3 flex gap-2 rounded-md border border-[#bfdbfe] bg-[#eff6ff] px-3 py-2 text-xs leading-5 text-[#1e40af]">
            <Info size={15} className="mt-0.5 shrink-0" />
            <span>本操作只复制安装说明，不会自动安装，也不会修改日志配置。</span>
          </div>

          <ol className="mt-4 space-y-2.5 text-sm text-[#243145]">
            <li className="flex gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#eff6ff] text-xs font-semibold text-[#2563eb]">1</span>
              <span>点击“复制安装说明”。</span>
            </li>
            <li className="flex gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#eff6ff] text-xs font-semibold text-[#2563eb]">2</span>
              <span>粘贴给本机 AI Agent（Claude Code / Codex）并执行。</span>
            </li>
            <li className="flex gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#eff6ff] text-xs font-semibold text-[#2563eb]">3</span>
              <span>新开会话后，直接问日志问题，例如“SIT 网关最近有什么报错？”。</span>
            </li>
          </ol>

          <div className="mt-4 rounded-md border border-[#e3e8f0] bg-[#f8fafc] px-3 py-2.5">
            <div className="text-xs font-medium text-[#243145]">命令行工具</div>
            {!isTauriRuntime() ? (
              <p className="mt-1 text-xs leading-5 text-[#b45309]">请在 Windows 桌面应用中使用此功能。</p>
            ) : loading ? (
              <p className="mt-1 text-xs text-[#69778c]">正在检测 readgcislog.exe…</p>
            ) : statusError ? (
              <p className="mt-1 text-xs leading-5 text-[#b42318]">无法检测命令行工具：{statusError}</p>
            ) : status ? (
              <>
                <div className="mt-1 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate text-xs text-[#475569]" title={status.cliPath}>{status.cliPath}</code>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${status.cliFound ? "bg-[#ecfdf3] text-[#047857]" : "bg-[#fff1f3] text-[#b42318]"}`}>
                    {status.cliFound ? "已找到" : "未找到"}
                  </span>
                </div>
                {!status.cliFound && (
                  <p className="mt-1.5 flex items-center gap-1 text-xs text-[#b42318]">
                    <AlertCircle size={13} /> 未找到 readgcislog.exe，请重新安装日志工具。
                  </p>
                )}
              </>
            ) : null}
          </div>

          {copyState && (
            <div className={`mt-3 flex items-start gap-2 rounded-md px-3 py-2 text-xs leading-5 ${copyState.ok ? "bg-[#ecfdf3] text-[#047857]" : "bg-[#fff1f3] text-[#b42318]"}`}>
              {copyState.ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0" /> : <AlertCircle size={15} className="mt-0.5 shrink-0" />}
              <span role={copyState.ok ? "status" : "alert"}>{copyState.message}</span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-[#e3e8f0] px-5 py-3.5">
          <button className="rounded-md border border-[#cfd8e6] px-4 py-2 text-sm hover:bg-[#f2f5f9]" type="button" onClick={onClose}>
            关闭
          </button>
          <button
            className="inline-flex items-center gap-1.5 rounded-md bg-[#2563eb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8] disabled:opacity-50"
            type="button"
            disabled={!canCopy || copying}
            onClick={() => void copyInstallPrompt()}
          >
            <Copy size={15} /> {copying ? "正在复制…" : "复制安装说明"}
          </button>
        </div>
      </div>
    </div>
  );
}
