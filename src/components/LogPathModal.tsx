import {
  ChevronDown,
  ChevronRight,
  Download,
  Edit2,
  Eye,
  EyeOff,
  FolderPlus,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { exportXlsx } from "../lib/runtime";
import { groupLogEntries, normalizeAlias, sortLogEntries } from "../lib/serverEntries";
import { useServerStore } from "../store/serverStore";
import type { LogEntry } from "../types/query";

interface Props {
  onClose: () => void;
}

interface EntryDraft {
  id: string;
  name: string;
  path: string;
  logFile: string;
  groupId: string;
  groupName: string;
}

interface GroupDraft {
  name: string;
}

type FormMode = null | { type: "add-entry"; draft: EntryDraft } | { type: "edit-entry"; draft: EntryDraft } | { type: "add-group"; draft: GroupDraft } | { type: "edit-group"; groupId: string; draft: GroupDraft };

const emptyEntryDraft = (groupId = "", groupName = ""): EntryDraft => ({
  id: crypto.randomUUID(),
  name: "",
  path: "",
  logFile: "app.log",
  groupId,
  groupName,
});

type OrderOptions = { groupOrder?: string[]; entryOrder?: Record<string, string[]> };

function groupEntries(entries: LogEntry[], options?: OrderOptions): Map<string, { name: string; entries: LogEntry[] }> {
  return new Map(groupLogEntries(entries, options).filter(([id]) => id));
}

function getUngrouped(entries: LogEntry[], options?: OrderOptions): LogEntry[] {
  return sortLogEntries(entries.filter((e) => !e.groupId), options?.entryOrder?.[""]);
}

function groupIsAllVisible(entries: LogEntry[]) {
  return entries.length > 0 && entries.every((e) => e.visible);
}

function groupIsNoneVisible(entries: LogEntry[]) {
  return entries.length > 0 && entries.every((e) => !e.visible);
}

function parseFullUrl(fullUrl: string): { path: string; logFile: string } {
  const lastSlash = fullUrl.lastIndexOf("/");
  if (lastSlash === -1) return { path: "/", logFile: fullUrl };
  return {
    path: fullUrl.substring(0, lastSlash + 1),
    logFile: fullUrl.substring(lastSlash + 1),
  };
}

export function LogPathModal({ onClose }: Props) {
  const config = useServerStore((state) => state.config);
  const { upsertLogEntry, deleteLogEntry, toggleLogEntryVisible, toggleGroupVisible, renameGroup, deleteGroup, save } =
    useServerStore();
  const [form, setForm] = useState<FormMode>(null);
  const [error, setError] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    if (!config) return new Set();
    return new Set(config.logEntries.filter((e) => e.groupId).map((e) => e.groupId));
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!config) return null;

  const orderOptions = { groupOrder: config.groupOrder, entryOrder: config.entryOrder };
  const groups = groupEntries(config.logEntries, orderOptions);
  const ungrouped = getUngrouped(config.logEntries, orderOptions);

  const toggleExpand = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const handleSaveEntry = async () => {
    const draft = form && ("draft" in form) ? form.draft as EntryDraft : null;
    if (!draft) return;
    if (!draft.name.trim()) { setError("日志名称不能为空"); return; }
    if (!draft.path.trim()) { setError("URL 路径不能为空"); return; }
    if (!draft.logFile.trim()) { setError("日志文件名不能为空"); return; }
    setError("");

    const existing = config.logEntries.find((e) => e.id === draft.id);
    const entry: LogEntry = {
      id: draft.id,
      name: draft.name.trim(),
      path: draft.path.trim().endsWith("/") ? draft.path.trim() : draft.path.trim() + "/",
      logFile: draft.logFile.trim(),
      visible: existing?.visible ?? true,
      enabled: existing?.enabled ?? true,
      displayOrder: existing?.displayOrder ?? config.logEntries.length,
      groupId: draft.groupId,
      groupName: draft.groupName,
      alias: existing?.alias ?? "",
    };
    await upsertLogEntry(entry);
    setForm(null);
  };

  const handleSaveGroup = async () => {
    const draft = form && form.type === "add-group" ? form.draft : null;
    if (!draft || !draft.name.trim()) { setError("分组名称不能为空"); return; }
    setError("");
    const groupId = crypto.randomUUID();
    // Create a placeholder entry so the group persists
    const entry: LogEntry = {
      id: crypto.randomUUID(),
      name: "",
      path: "",
      logFile: "app.log",
      visible: true,
      enabled: true,
      displayOrder: config.logEntries.length,
      groupId,
      groupName: draft.name.trim(),
    };
    await upsertLogEntry(entry);
    setExpandedGroups((prev) => new Set(prev).add(groupId));
    setForm(null);
  };

  const handleRenameGroup = async () => {
    if (!form || form.type !== "edit-group") return;
    const name = form.draft.name.trim();
    if (!name) { setError("分组名称不能为空"); return; }
    setError("");
    await renameGroup(form.groupId, name);
    setForm(null);
  };

  const submitForm = () => {
    if (!form) return;
    if (form.type === "add-entry" || form.type === "edit-entry") void handleSaveEntry();
    else if (form.type === "edit-group") void handleRenameGroup();
    else void handleSaveGroup();
  };

  const handleDeleteGroup = async (groupId: string) => {
    const group = groups.get(groupId);
    if (!group) return;
    if (!confirm(`确认删除分组「${group.name}」及其下 ${group.entries.length} 条日志？`)) return;
    await deleteGroup(groupId);
  };

  // XLSX Export
  const handleExport = () => {
    void exportXlsx(config.logEntries);
  };

  // XLSX Import
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const XLSX = await import("xlsx");
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });

      // Skip header row, parse data
      const entries: LogEntry[] = [];
      const groupMap = new Map<string, string>(); // groupName -> groupId
      let order = 0;

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 3) continue;
        const groupName = String(row[0] ?? "").trim();
        const name = String(row[1] ?? "").trim();
        const fullUrl = String(row[2] ?? "").trim();
        const alias = normalizeAlias(String(row[3] ?? ""));
        if (!name || !fullUrl) continue;

        let groupId = "";
        if (groupName) {
          if (!groupMap.has(groupName)) {
            groupMap.set(groupName, crypto.randomUUID());
          }
          groupId = groupMap.get(groupName)!;
        }

        const { path, logFile } = parseFullUrl(fullUrl);
        entries.push({
          id: crypto.randomUUID(),
          name,
          path,
          logFile,
          visible: true,
          enabled: true,
          displayOrder: order++,
          groupId,
          groupName,
          alias,
        });
      }

      if (entries.length === 0) {
        setError("未找到有效的日志配置数据");
        return;
      }

      await save({ ...config, logEntries: entries, groupOrder: [], entryOrder: {} });
      setExpandedGroups(new Set(groupMap.values()));
      setForm(null);
      setError("");
    } catch {
      setError("导入失败，请检查文件格式");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#162033]/35">
      <div className="flex max-h-[85vh] w-[860px] flex-col rounded-lg border border-[#d9e0eb] bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#e3e8f0] px-5 py-4">
          <h2 className="text-base font-semibold">日志路径配置</h2>
          <button
            className="rounded-md p-1.5 text-[#5d6b82] hover:bg-[#eef3f8]"
            type="button"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Groups */}
          {Array.from(groups.entries()).map(([groupId, group]) => (
            <div key={groupId} className="mb-3">
              {/* Group header */}
              <div className="flex items-center gap-2 rounded-md bg-[#f0f4fa] px-3 py-2">
                <button
                  className="rounded p-0.5 text-[#5d6b82] hover:bg-[#dce4f0]"
                  type="button"
                  onClick={() => toggleExpand(groupId)}
                >
                  {expandedGroups.has(groupId) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                <span className="text-sm font-semibold text-[#243145]">{group.name}</span>
                <span className="rounded-full bg-[#dbe4f0] px-2 py-0.5 text-xs text-[#5d6b82]">
                  {group.entries.length}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <button
                    className={`rounded p-1 hover:bg-[#dce4f0] ${
                      groupIsAllVisible(group.entries)
                        ? "text-[#2563eb]"
                        : groupIsNoneVisible(group.entries)
                          ? "text-[#9ca3af]"
                          : "text-[#94a3b8]"
                    }`}
                    type="button"
                    onClick={() => void toggleGroupVisible(groupId)}
                    title={
                      groupIsAllVisible(group.entries)
                        ? "整组隐藏"
                        : groupIsNoneVisible(group.entries)
                          ? "整组显示"
                          : `部分日志已隐藏（${group.entries.filter((e) => e.visible).length}/${group.entries.length}），点击全部显示`
                    }
                  >
                    {groupIsNoneVisible(group.entries) ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <button
                    className="rounded p-1 text-[#2563eb] hover:bg-[#dce4f0]"
                    type="button"
                    onClick={() => {
                      setForm({ type: "add-entry", draft: emptyEntryDraft(groupId, group.name) });
                      setError("");
                    }}
                    title="在此组添加日志"
                  >
                    <Plus size={14} />
                  </button>
                  <button
                    className="rounded p-1 text-[#607086] hover:bg-[#dce4f0]"
                    type="button"
                    onClick={() => {
                      setForm({ type: "edit-group", groupId, draft: { name: group.name } });
                      setError("");
                    }}
                    title="重命名分组"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    className="rounded p-1 text-[#b42318] hover:bg-[#fee4e2]"
                    type="button"
                    onClick={() => void handleDeleteGroup(groupId)}
                    title="删除分组"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* Group entries */}
              {expandedGroups.has(groupId) && (
                <div className="mt-1 space-y-1 pl-8">
                  {group.entries.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center gap-3 rounded-md border border-[#e8ecf2] bg-white px-3 py-2"
                    >
                      <span className="min-w-[80px] text-sm font-medium text-[#243145]">{entry.name}</span>
                      <span className="flex-1 truncate text-xs text-[#69778c]" title={`${entry.path}${entry.logFile}`}>
                        {entry.path}{entry.logFile}
                      </span>
                      <button
                        className={`rounded p-1 ${entry.visible ? "text-[#2563eb] hover:bg-[#eef3f8]" : "text-[#9ca3af] hover:bg-[#eef3f8]"}`}
                        type="button"
                        onClick={() => void toggleLogEntryVisible(entry.id)}
                        title={entry.visible ? "点击隐藏" : "点击显示"}
                      >
                        {entry.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                      </button>
                      <button
                        className="rounded p-1 text-[#607086] hover:bg-[#e8edf5]"
                        type="button"
                        onClick={() => {
                          setForm({
                            type: "edit-entry",
                            draft: {
                              id: entry.id,
                              name: entry.name,
                              path: entry.path,
                              logFile: entry.logFile,
                              groupId: entry.groupId,
                              groupName: entry.groupName,
                            },
                          });
                          setError("");
                        }}
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        className="rounded p-1 text-[#b42318] hover:bg-[#fee4e2]"
                        type="button"
                        onClick={() => void deleteLogEntry(entry.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  {group.entries.length === 0 && (
                    <p className="py-2 text-center text-xs text-[#9ca3af]">暂无日志，点击 + 添加</p>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Ungrouped entries */}
          {ungrouped.length > 0 && (
            <div className="mb-3">
              <div className="mb-1 px-3 py-1.5 text-xs font-medium text-[#9ca3af]">未分组</div>
              <div className="space-y-1">
                {ungrouped.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center gap-3 rounded-md border border-[#e8ecf2] bg-white px-3 py-2"
                  >
                    <span className="min-w-[80px] text-sm font-medium text-[#243145]">{entry.name}</span>
                    <span className="flex-1 truncate text-xs text-[#69778c]" title={`${entry.path}${entry.logFile}`}>
                      {entry.path}{entry.logFile}
                    </span>
                    <button
                      className={`rounded p-1 ${entry.visible ? "text-[#2563eb] hover:bg-[#eef3f8]" : "text-[#9ca3af] hover:bg-[#eef3f8]"}`}
                      type="button"
                      onClick={() => void toggleLogEntryVisible(entry.id)}
                      title={entry.visible ? "点击隐藏" : "点击显示"}
                    >
                      {entry.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                    <button
                      className="rounded p-1 text-[#607086] hover:bg-[#e8edf5]"
                      type="button"
                      onClick={() => {
                        setForm({
                          type: "edit-entry",
                          draft: {
                            id: entry.id,
                            name: entry.name,
                            path: entry.path,
                            logFile: entry.logFile,
                            groupId: entry.groupId,
                            groupName: entry.groupName,
                          },
                        });
                        setError("");
                      }}
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      className="rounded p-1 text-[#b42318] hover:bg-[#fee4e2]"
                      type="button"
                      onClick={() => void deleteLogEntry(entry.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {config.logEntries.length === 0 && (
            <p className="py-8 text-center text-sm text-[#9ca3af]">暂无日志配置，请添加分组/日志或导入配置</p>
          )}

        {form && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#162033]/35" onClick={() => { setForm(null); setError(""); }}>
            <div className="w-[520px] max-w-[92vw] rounded-lg border border-[#d9e0eb] bg-white shadow-xl"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => { if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT") void submitForm(); }}>
              <div className="flex items-center justify-between border-b border-[#e3e8f0] px-5 py-3.5">
                <h2 className="text-sm font-semibold">
                  {form.type === "edit-entry" ? "编辑日志" : form.type === "add-entry" ? "添加日志" : form.type === "edit-group" ? "重命名分组" : "新建分组"}
                </h2>
                <button className="rounded-md p-1.5 text-[#5d6b82] hover:bg-[#eef3f8]" type="button" aria-label="关闭" onClick={() => { setForm(null); setError(""); }}>
                  <X size={16} />
                </button>
              </div>
              <div className="space-y-3 px-5 py-4">
                {form.type === "add-entry" || form.type === "edit-entry" ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block text-sm font-medium">
                        所属分组
                        <select
                          className="mt-1 w-full rounded-md border border-[#cfd8e6] bg-white px-3 py-2 outline-none focus:border-[#2563eb]"
                          value={(form.draft as EntryDraft).groupId}
                          onChange={(e) => {
                            const selectedGroupId = e.target.value;
                            const selectedGroupName = e.target.options[e.target.selectedIndex].text;
                            setForm({ ...form, draft: { ...(form.draft as EntryDraft), groupId: selectedGroupId, groupName: selectedGroupId ? selectedGroupName : "" } });
                          }}
                        >
                          <option value="">（不使用分组）</option>
                          {Array.from(groups.entries()).map(([id, g]) => (
                            <option key={id} value={id}>{g.name}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-sm font-medium">
                        日志名称
                        <input
                          className="mt-1 w-full rounded-md border border-[#cfd8e6] bg-white px-3 py-2 outline-none focus:border-[#2563eb]"
                          value={(form.draft as EntryDraft).name}
                          placeholder="如：cgis-web-benefit"
                          autoFocus
                          onChange={(e) => setForm({ ...form, draft: { ...(form.draft as EntryDraft), name: e.target.value } })}
                        />
                      </label>
                    </div>
                    <label className="block text-sm font-medium">
                      URL 路径
                      <input
                        className="mt-1 w-full rounded-md border border-[#cfd8e6] bg-white px-3 py-2 outline-none focus:border-[#2563eb]"
                        value={(form.draft as EntryDraft).path}
                        placeholder="如：/logs/service/node/"
                        onChange={(e) => setForm({ ...form, draft: { ...(form.draft as EntryDraft), path: e.target.value } })}
                      />
                    </label>
                    <label className="block text-sm font-medium">
                      日志文件名
                      <input
                        className="mt-1 w-full rounded-md border border-[#cfd8e6] bg-white px-3 py-2 outline-none focus:border-[#2563eb]"
                        value={(form.draft as EntryDraft).logFile}
                        placeholder="如：app.log 或 app.log.gz"
                        onChange={(e) => setForm({ ...form, draft: { ...(form.draft as EntryDraft), logFile: e.target.value } })}
                      />
                    </label>
                  </>
                ) : (
                  <label className="block text-sm font-medium">
                    分组名称
                    <input
                      className="mt-1 w-full rounded-md border border-[#cfd8e6] bg-white px-3 py-2 outline-none focus:border-[#2563eb]"
                      value={form.draft.name}
                      placeholder="如：核心服务"
                      autoFocus
                      onChange={(e) => setForm({ ...form, draft: { name: e.target.value } })}
                    />
                  </label>
                )}
                {error && <div className="rounded-md bg-[#fff1f3] px-3 py-2 text-sm text-[#b42318]">{error}</div>}
              </div>
              <div className="flex justify-end gap-3 border-t border-[#e3e8f0] px-5 py-3.5">
                <button className="rounded-md border border-[#cfd8e6] px-4 py-2 text-sm hover:bg-[#f2f5f9]" type="button" onClick={() => { setForm(null); setError(""); }}>
                  取消
                </button>
                <button className="rounded-md bg-[#2563eb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8]" type="button" onClick={() => void submitForm()}>
                  {form.type === "add-group" ? "创建" : "保存"}
                </button>
              </div>
            </div>
          </div>
        )}

        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[#e3e8f0] px-5 py-4">
          <div className="flex items-center gap-2">
            <button
              className="inline-flex items-center gap-2 rounded-md bg-[#2563eb] px-3 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8]"
              type="button"
              onClick={() => {
                setForm({ type: "add-group", draft: { name: "" } });
                setError("");
              }}
            >
              <FolderPlus size={16} /> 添加分组
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-md border border-[#cfd8e6] bg-white px-3 py-2 text-sm font-medium text-[#69778c] hover:bg-[#eef3f8]"
              type="button"
              onClick={() => {
                setForm({ type: "add-entry", draft: emptyEntryDraft() });
                setError("");
              }}
            >
              <Plus size={16} /> 添加日志
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="inline-flex items-center gap-2 rounded-md border border-[#cfd8e6] bg-white px-3 py-2 text-sm text-[#69778c] hover:bg-[#eef3f8]"
              type="button"
              onClick={handleExport}
              title="导出为 Excel 文件"
            >
              <Download size={16} /> 导出XLSX
            </button>
            <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => void handleImportFile(e)} />
            <button
              className="inline-flex items-center gap-2 rounded-md border border-[#cfd8e6] bg-white px-3 py-2 text-sm text-[#69778c] hover:bg-[#eef3f8]"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="从 Excel 文件导入"
            >
              <Upload size={16} /> 导入XLSX
            </button>
            <button
              className="rounded-md border border-[#cfd8e6] px-4 py-2 text-sm hover:bg-[#f2f5f9]"
              type="button"
              onClick={onClose}
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
