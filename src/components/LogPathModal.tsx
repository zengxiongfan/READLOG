import {
  ChevronDown,
  ChevronRight,
  Download,
  Edit2,
  Eye,
  EyeOff,
  FolderPlus,
  GripVertical,
  Plus,
  Trash2,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { exportXlsx } from "../lib/runtime";
import { groupLogEntries, normalizeAlias, sortLogEntries } from "../lib/serverEntries";
import { useServerStore } from "../store/serverStore";
import type { LogEntry } from "../types/query";

interface Props {
  onClose: () => void;
  initialEditEntryId?: string;
  onSaved?: (entryId: string) => void;
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
type DragItem = { kind: "group"; id: string } | { kind: "entry"; groupId: string; id: string };
type DropTarget = { kind: "group" | "entry"; id: string; position: "before" | "after" } | null;

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

/** 路径最后一段是 IP 时取“上一段-IP”，否则取最后一段。 */
function deriveNameFromPath(path: string): string {
  const parts = path.split("/").map((part) => part.trim()).filter(Boolean);
  if (parts.length > 0 && /\.(log|gz)$/i.test(parts[parts.length - 1])) parts.pop();
  if (parts.length === 0) return "";
  const last = parts[parts.length - 1];
  const previous = parts.length > 1 ? parts[parts.length - 2] : "";
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(last);
  return isIp && previous ? `${previous}-${last}` : last;
}

export function LogPathModal({ onClose, initialEditEntryId, onSaved }: Props) {
  const config = useServerStore((state) => state.config);
  const { upsertLogEntry, deleteLogEntry, toggleLogEntryVisible, toggleGroupVisible, renameGroup, deleteGroup, saveGroupOrder, saveEntryOrder, save } =
    useServerStore();
  const [form, setForm] = useState<FormMode>(() => {
    if (!initialEditEntryId) return null;
    const entry = config?.logEntries.find((item) => item.id === initialEditEntryId);
    if (!entry) return null;
    return {
      type: "edit-entry",
      draft: {
        id: entry.id,
        name: entry.name,
        path: entry.path,
        logFile: entry.logFile,
        groupId: entry.groupId,
        groupName: entry.groupName,
      },
    };
  });
  const [error, setError] = useState("");
  const [nameTouched, setNameTouched] = useState(Boolean(initialEditEntryId));
  const [normalizeOpen, setNormalizeOpen] = useState(false);
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    if (!config) return new Set();
    return new Set(config.logEntries.filter((e) => e.groupId).map((e) => e.groupId));
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!config) return null;

  const directEdit = Boolean(initialEditEntryId && form);
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
    onSaved?.(entry.id);
    if (initialEditEntryId) {
      onClose();
      return;
    }
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

  const closeForm = () => {
    if (initialEditEntryId) {
      onClose();
      return;
    }
    setForm(null);
    setError("");
  };

  const openAddEntryForm = (groupId = "", groupName = "") => {
    setNameTouched(false);
    setForm({ type: "add-entry", draft: emptyEntryDraft(groupId, groupName) });
    setError("");
  };

  const openEditEntryForm = (entry: LogEntry) => {
    setNameTouched(true);
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
  };

  const submitForm = () => {
    if (!form) return;
    if (form.type === "add-entry" || form.type === "edit-entry") void handleSaveEntry();
    else if (form.type === "edit-group") void handleRenameGroup();
    else void handleSaveGroup();
  };

  const nameChanges = config.logEntries
    .map((entry) => ({ entry, next: deriveNameFromPath(entry.path) }))
    .filter(({ entry, next }) => next && next !== entry.name);

  const groupedNameChanges = nameChanges.reduce<Array<{ group: string; changes: typeof nameChanges }>>((groups, change) => {
    const group = change.entry.groupName || "未分组";
    const existing = groups.find((item) => item.group === group);
    if (existing) existing.changes.push(change);
    else groups.push({ group, changes: [change] });
    return groups;
  }, []);

  const handleNormalizeNames = async () => {
    if (nameChanges.length === 0) {
      setNormalizeOpen(false);
      return;
    }
    const updated = config.logEntries.map((entry) => {
      const next = deriveNameFromPath(entry.path);
      return next && next !== entry.name ? { ...entry, name: next } : entry;
    });
    await save({ ...config, logEntries: updated });
    setNormalizeOpen(false);
  };

  const clearDrag = () => {
    setDragItem(null);
    setDropTarget(null);
  };

  const dropIndicatorStyle = (kind: "group" | "entry", id: string) => {
    if (dropTarget?.kind !== kind || dropTarget.id !== id) return undefined;
    return { boxShadow: dropTarget.position === "before" ? "inset 0 2px 0 #2563eb" : "inset 0 -2px 0 #2563eb" };
  };

  const dropPositionOf = (event: React.DragEvent, element: HTMLElement): "before" | "after" => {
    const rect = element.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  };

  const finishGroupDrop = async (targetId: string, position: "before" | "after") => {
    if (dragItem?.kind !== "group" || dragItem.id === targetId) return;
    const ids = Array.from(groups.keys()).filter((id) => id && id !== dragItem.id);
    const targetIndex = ids.indexOf(targetId);
    if (targetIndex < 0) return;
    ids.splice(position === "after" ? targetIndex + 1 : targetIndex, 0, dragItem.id);
    const rest = groupLogEntries(config.logEntries, { groupOrder: config.groupOrder, entryOrder: config.entryOrder })
      .map(([id]) => id)
      .filter((id) => id && !ids.includes(id));
    await saveGroupOrder([...ids, ...rest]);
  };

  const finishEntryDrop = async (target: LogEntry, groupId: string, displayed: LogEntry[], position: "before" | "after") => {
    if (dragItem?.kind !== "entry" || dragItem.groupId !== groupId || dragItem.id === target.id) return;
    const ids = displayed.map((entry) => entry.id).filter((id) => id !== dragItem.id);
    const targetIndex = ids.indexOf(target.id);
    if (targetIndex < 0) return;
    ids.splice(position === "after" ? targetIndex + 1 : targetIndex, 0, dragItem.id);
    const rest = sortLogEntries(
      config.logEntries.filter((entry) => entry.groupId === groupId),
      config.entryOrder[groupId],
    ).map((entry) => entry.id).filter((id) => !ids.includes(id));
    await saveEntryOrder(groupId, [...ids, ...rest]);
  };

  const renderEntryRow = (entry: LogEntry, groupId: string, displayed: LogEntry[]) => (
    <div
      key={entry.id}
      data-drag-row=""
      style={dropIndicatorStyle("entry", entry.id)}
      onDragOver={(event) => {
        if (dragItem?.kind !== "entry" || dragItem.groupId !== groupId || dragItem.id === entry.id) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropTarget({ kind: "entry", id: entry.id, position: dropPositionOf(event, event.currentTarget) });
      }}
      onDrop={(event) => {
        if (dragItem?.kind !== "entry") return;
        event.preventDefault();
        void finishEntryDrop(entry, groupId, displayed, dropPositionOf(event, event.currentTarget));
        clearDrag();
      }}
      className="flex items-center gap-3 rounded-md border border-[#e8ecf2] bg-white px-3 py-2"
    >
      <span
        role="button"
        tabIndex={-1}
        title="拖动排序"
        aria-label={`拖动排序 ${entry.name}`}
        draggable
        className="shrink-0 cursor-grab rounded p-0.5 text-[#9aa8bc] hover:bg-[#e8edf5] hover:text-[#607086] active:cursor-grabbing"
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
        onDragStart={(event) => {
          event.stopPropagation();
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", entry.id);
          const row = event.currentTarget.closest("[data-drag-row]") as HTMLElement | null;
          if (row) event.dataTransfer.setDragImage(row, 24, 14);
          setDragItem({ kind: "entry", groupId, id: entry.id });
          setDropTarget(null);
        }}
        onDragEnd={clearDrag}
      >
        <GripVertical size={14} />
      </span>
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
        onClick={() => openEditEntryForm(entry)}
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
  );

  const handleDeleteGroup = async (groupId: string) => {
    const group = groups.get(groupId);
    if (!group) return;
    if (!confirm(`确认删除分组「${group.name}」及其下 ${group.entries.length} 条日志？`)) return;
    await deleteGroup(groupId);
  };

  // XLSX Export
  const handleExport = () => {
    const orderedEntries = groupLogEntries(config.logEntries, {
      groupOrder: config.groupOrder,
      entryOrder: config.entryOrder,
    }).flatMap(([, group]) => group.entries);
    void exportXlsx(orderedEntries);
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
    <div className={`fixed inset-0 z-30 flex items-center justify-center ${directEdit ? "" : "bg-[#162033]/35"}`}>
      <div className={directEdit ? "contents" : "flex max-h-[85vh] w-[860px] flex-col rounded-lg border border-[#d9e0eb] bg-white shadow-xl"}>
        {/* Header */}
        <div className={`flex items-center justify-between border-b border-[#e3e8f0] px-5 py-4 ${directEdit ? "hidden" : ""}`}>
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
        <div className={`flex-1 overflow-y-auto px-5 py-4 ${directEdit ? "hidden" : ""}`}>
          {/* Groups */}
          {Array.from(groups.entries()).map(([groupId, group]) => (
            <div
              key={groupId}
              className="mb-3"
              onDragOver={(event) => {
                if (dragItem?.kind !== "group" || dragItem.id === groupId) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropTarget({ kind: "group", id: groupId, position: dropPositionOf(event, event.currentTarget) });
              }}
              onDrop={(event) => {
                if (dragItem?.kind !== "group") return;
                event.preventDefault();
                void finishGroupDrop(groupId, dropPositionOf(event, event.currentTarget));
                clearDrag();
              }}
            >
              {/* Group header */}
              <div data-drag-row="" style={dropIndicatorStyle("group", groupId)} className="flex items-center gap-2 rounded-md bg-[#f0f4fa] px-3 py-2">
                <span
                  role="button"
                  tabIndex={-1}
                  title="拖动排序分组"
                  aria-label={`拖动排序分组 ${group.name}`}
                  draggable
                  className="shrink-0 cursor-grab rounded p-0.5 text-[#5d6b82] hover:bg-[#dce4f0] active:cursor-grabbing"
                  onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
                  onDragStart={(event) => {
                    event.stopPropagation();
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", groupId);
                    const row = event.currentTarget.closest("[data-drag-row]") as HTMLElement | null;
                    if (row) event.dataTransfer.setDragImage(row, 24, 16);
                    setDragItem({ kind: "group", id: groupId });
                    setDropTarget(null);
                  }}
                  onDragEnd={clearDrag}
                >
                  <GripVertical size={14} />
                </span>
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
                    onClick={() => openAddEntryForm(groupId, group.name)}
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
                  {group.entries.map((entry) => renderEntryRow(entry, groupId, group.entries))}
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
                {ungrouped.map((entry) => renderEntryRow(entry, "", ungrouped))}
              </div>
            </div>
          )}

          {config.logEntries.length === 0 && (
            <p className="py-8 text-center text-sm text-[#9ca3af]">暂无日志配置，请添加分组/日志或导入配置</p>
          )}

        {form && createPortal(
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#162033]/35" onClick={closeForm}>
            <div className="w-[520px] max-w-[92vw] rounded-lg border border-[#d9e0eb] bg-white shadow-xl"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => { if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT") void submitForm(); }}>
              <div className="flex items-center justify-between border-b border-[#e3e8f0] px-5 py-3.5">
                <h2 className="text-sm font-semibold">
                  {form.type === "edit-entry" ? "编辑日志" : form.type === "add-entry" ? "添加日志" : form.type === "edit-group" ? "重命名分组" : "新建分组"}
                </h2>
                <button className="rounded-md p-1.5 text-[#5d6b82] hover:bg-[#eef3f8]" type="button" aria-label="关闭" onClick={closeForm}>
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
                          autoFocus={form.type === "edit-entry"}
                          onChange={(e) => {
                            setNameTouched(true);
                            setForm({ ...form, draft: { ...(form.draft as EntryDraft), name: e.target.value } });
                          }}
                        />
                      </label>
                    </div>
                    <label className="block text-sm font-medium">
                      URL 路径
                      <input
                        className="mt-1 w-full rounded-md border border-[#cfd8e6] bg-white px-3 py-2 outline-none focus:border-[#2563eb]"
                        value={(form.draft as EntryDraft).path}
                        placeholder="如：/logs/service/node/"
                        autoFocus={form.type === "add-entry"}
                        onChange={(e) => {
                          const path = e.target.value;
                          setForm((current) => {
                            if (!current || !("draft" in current)) return current;
                            const draft = { ...(current.draft as EntryDraft), path };
                            if (!nameTouched && current.type === "add-entry") draft.name = deriveNameFromPath(path);
                            return { ...current, draft };
                          });
                        }}
                      />
                      {form.type === "add-entry" && <span className="mt-1 block text-xs font-normal text-[#7b889b]">填写路径后自动生成名称，可手动修改</span>}
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
                <button className="rounded-md border border-[#cfd8e6] px-4 py-2 text-sm hover:bg-[#f2f5f9]" type="button" onClick={closeForm}>
                  取消
                </button>
                <button className="rounded-md bg-[#2563eb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8]" type="button" onClick={() => void submitForm()}>
                  {form.type === "add-group" ? "创建" : "保存"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {normalizeOpen && createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#162033]/45 p-4"
            onPointerDown={(event) => { if (event.target === event.currentTarget) setNormalizeOpen(false); }}
            onKeyDown={(event) => { if (event.key === "Escape") setNormalizeOpen(false); }}>
            <div role="dialog" aria-modal="true" aria-label="统一日志名称" className="flex max-h-[80vh] w-[560px] max-w-[92vw] flex-col rounded-lg border border-[#d9e0eb] bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-[#e3e8f0] px-5 py-3.5">
                <h2 className="text-sm font-semibold">统一日志名称？</h2>
                <button className="rounded-md p-1.5 text-[#5d6b82] hover:bg-[#eef3f8]" type="button" aria-label="关闭" onClick={() => setNormalizeOpen(false)}>
                  <X size={16} />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                <p className="text-sm leading-6 text-[#243145]">将按 URL 路径重新生成名称：识别到 IP 时用「服务名-IP」，否则使用最后一段。</p>
                {nameChanges[0] && (
                  <div className="mt-3 rounded-md bg-[#f8fafc] px-3 py-2 text-xs leading-6 text-[#475569]">
                    <div className="truncate" title={nameChanges[0].entry.path}>{nameChanges[0].entry.path}</div>
                    <div className="truncate font-medium text-[#2563eb]" title={nameChanges[0].next}>→ {nameChanges[0].next}</div>
                  </div>
                )}
                <div className="mt-3 flex items-center justify-between text-xs text-[#69778c]">
                  <span>名称变化预览</span>
                  <span>共 {config.logEntries.length} 条 · {nameChanges.length} 条将变化{nameChanges.length > 0 ? ` · ${groupedNameChanges.length} 个分组` : ""}</span>
                </div>
                <div className="mt-1 max-h-56 overflow-y-auto rounded-md border border-[#e3e8f0]">
                  {groupedNameChanges.map(({ group, changes }) => (
                    <div key={group}>
                      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#e3e8f0] bg-[#f6f8fc] px-3 py-1.5 text-[10px] font-semibold text-[#243145]">
                        <span>{group}</span>
                        <span className="font-normal text-[#7b889b]">{changes.length} 条</span>
                      </div>
                      {changes.map(({ entry, next }) => (
                        <div key={entry.id} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-[#eef2f7] px-3 py-2 text-xs">
                          <span className="truncate text-[#7b889b] line-through" title={entry.name}>{entry.name}</span>
                          <span className="text-[#94a3b8]">→</span>
                          <span className="truncate font-medium text-[#2563eb]" title={next}>{next}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                  {nameChanges.length === 0 && <p className="px-3 py-6 text-center text-xs text-[#7b889b]">所有名称已经是标准格式，无需修改。</p>}
                </div>
                <p className="mt-3 text-xs leading-5 text-[#b45309]">团核心等特殊名称也会按规则重置；确认后仍可在列表里单独编辑。</p>
              </div>
              <div className="flex justify-end gap-3 border-t border-[#e3e8f0] px-5 py-3.5">
                <button className="rounded-md border border-[#cfd8e6] px-4 py-2 text-sm hover:bg-[#f2f5f9]" type="button" onClick={() => setNormalizeOpen(false)}>取消</button>
                <button className="rounded-md bg-[#2563eb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8] disabled:opacity-50" type="button" disabled={nameChanges.length === 0} onClick={() => void handleNormalizeNames()}>确认统一</button>
              </div>
            </div>
          </div>,
          document.body
        )}

        </div>

        {/* Footer */}
        <div className={`flex items-center justify-between border-t border-[#e3e8f0] px-5 py-4 ${directEdit ? "hidden" : ""}`}>
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
              onClick={() => openAddEntryForm()}
            >
              <Plus size={16} /> 添加日志
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-md border border-[#93c5fd] bg-[#eff6ff] px-3 py-2 text-sm font-medium text-[#2563eb] hover:bg-[#dbeafe]"
              type="button"
              onClick={() => { setNormalizeOpen(true); setError(""); }}
              title="按 URL 路径统一日志名称"
            >
              <Wand2 size={16} /> 日志名称标准化
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
