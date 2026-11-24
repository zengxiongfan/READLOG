import { CheckCircle2, ChevronDown, ChevronRight, ExternalLink, Eye, EyeOff, GripVertical, Pencil, PlugZap, RotateCcw, Save, Search, Settings, Tag, X, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "../lib/runtime";
import { groupLogEntries, matchesLogEntry, normalizeAlias, sortLogEntries } from "../lib/serverEntries";
import { useServerStore } from "../store/serverStore";
import type { ConnectionCheckResult, LogEntry } from "../types/query";
import { LogPathModal } from "./LogPathModal";

type CheckState = Record<string, { loading: boolean; result?: ConnectionCheckResult; error?: string }>;
type ContextMenuState = { x: number; y: number; dirUrl: string; entryId: string } | null;
type AliasEditState = { entryId: string; name: string; value: string } | null;
type DragItem = { kind: "group"; id: string } | { kind: "entry"; groupId: string; id: string };
type DropTarget = { kind: "group" | "entry"; id: string; position: "before" | "after"; axis: "x" | "y" } | null;

export function ServerConfig({ view = "all" }: { view?: "all" | "connection" | "scope" }) {
  const { config, toggleLogEntry, toggleLogEntries, save, upsertLogEntry, saveGroupOrder, saveEntryOrder, resetEntryOrder } = useServerStore();
  const [showModal, setShowModal] = useState(false);
  const [editEntryId, setEditEntryId] = useState<string | null>(null);
  const [authDraft, setAuthDraft] = useState({ username: "", password: "" });
  const [baseUrlDraft, setBaseUrlDraft] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [checkingAll, setCheckingAll] = useState(false);
  const [checks, setChecks] = useState<CheckState>({});
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [searchText, setSearchText] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [aliasEdit, setAliasEdit] = useState<AliasEditState>(null);
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!config || dirty) return;
    setAuthDraft(config.credentials);
    setBaseUrlDraft(config.baseUrl);
  }, [dirty, config]);

  useEffect(() => {
    if (!contextMenu) return;
    const dismissOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setContextMenu(null);
    };
    const dismiss = () => setContextMenu(null);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [contextMenu]);

  useEffect(() => { setContextMenu(null); }, [view, showModal]);

  if (!config) return null;

  const visibleEntries = config.logEntries.filter(entry => entry.visible && entry.name);
  const filteredEntries = visibleEntries.filter(entry => matchesLogEntry(entry, searchText, config.baseUrl));
  const filteredIds = new Set(filteredEntries.map(entry => entry.id));
  const groups = groupLogEntries(filteredEntries, { groupOrder: config.groupOrder, entryOrder: config.entryOrder });
  const selectedEntries = config.logEntries.filter(entry => entry.enabled && entry.visible && entry.name);
  const selectedOutsideFilter = selectedEntries.filter(entry => !filteredIds.has(entry.id)).length;
  const filtering = !!searchText.trim();
  const allCollapsed = groups.length > 0 && groups.every(([id]) => !expandedGroups.has(id));

  const toggleExpand = (groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const hasCustomOrder = config.groupOrder.length > 0 || Object.keys(config.entryOrder).length > 0;

  const clearDrag = () => {
    setDragItem(null);
    setDropTarget(null);
  };

  const dropIndicatorStyle = (kind: "group" | "entry", id: string) => {
    if (dropTarget?.kind !== kind || dropTarget.id !== id) return undefined;
    if (dropTarget.axis === "x") {
      return { boxShadow: dropTarget.position === "before" ? "inset 2px 0 0 #2563eb" : "inset -2px 0 0 #2563eb" };
    }
    return { boxShadow: dropTarget.position === "before" ? "inset 0 2px 0 #2563eb" : "inset 0 -2px 0 #2563eb" };
  };

  const groupDropLine = (groupId: string, edge: "before" | "after") =>
    dropTarget?.kind === "group" && dropTarget.id === groupId && dropTarget.position === edge
      ? <div aria-hidden="true" className={`pointer-events-none absolute left-0 right-0 z-10 h-[3px] rounded-full bg-[#2563eb] ${edge === "before" ? "-top-[6px]" : "-bottom-[6px]"}`} />
      : null;

  const dropPositionOf = (event: React.DragEvent, element: HTMLElement): "before" | "after" => {
    const rect = element.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  };

  const entryDropPoint = (event: React.DragEvent, element: HTMLElement): { position: "before" | "after"; axis: "x" | "y" } => {
    const rect = element.getBoundingClientRect();
    const dx = Math.abs(event.clientX - (rect.left + rect.width / 2)) / Math.max(rect.width / 2, 1);
    const dy = Math.abs(event.clientY - (rect.top + rect.height / 2)) / Math.max(rect.height / 2, 1);
    if (dy > dx) {
      return { position: event.clientY < rect.top + rect.height / 2 ? "before" : "after", axis: "y" };
    }
    return { position: event.clientX < rect.left + rect.width / 2 ? "before" : "after", axis: "x" };
  };

  const finishGroupDrop = async (targetId: string, position: "before" | "after") => {
    if (filtering || dragItem?.kind !== "group" || dragItem.id === targetId) return;
    const ids = groups.map(([id]) => id).filter(id => id && id !== dragItem.id);
    const targetIndex = ids.indexOf(targetId);
    if (targetIndex < 0) return;
    ids.splice(position === "after" ? targetIndex + 1 : targetIndex, 0, dragItem.id);
    const rest = groupLogEntries(config.logEntries, { groupOrder: config.groupOrder, entryOrder: config.entryOrder })
      .map(([id]) => id)
      .filter(id => id && !ids.includes(id));
    await saveGroupOrder([...ids, ...rest]);
  };

  const finishEntryDrop = async (target: LogEntry, position: "before" | "after") => {
    if (filtering || dragItem?.kind !== "entry" || dragItem.groupId !== target.groupId || dragItem.id === target.id) return;
    const displayed = groups.find(([id]) => id === target.groupId)?.[1].entries.map(entry => entry.id) ?? [];
    const ids = displayed.filter(id => id !== dragItem.id);
    const targetIndex = ids.indexOf(target.id);
    if (targetIndex < 0) return;
    ids.splice(position === "after" ? targetIndex + 1 : targetIndex, 0, dragItem.id);
    const rest = sortLogEntries(
      config.logEntries.filter(entry => entry.groupId === target.groupId),
      config.entryOrder[target.groupId],
    ).map(entry => entry.id).filter(id => !ids.includes(id));
    await saveEntryOrder(target.groupId, [...ids, ...rest]);
  };

  const saveAll = async () => {
    await save({ ...config, baseUrl: baseUrlDraft.trim(), credentials: authDraft });
    if (!useServerStore.getState().error) setDirty(false);
  };

  const testAll = async () => {
    setCheckingAll(true);
    const ids = visibleEntries.map(entry => entry.id);
    setChecks(Object.fromEntries(ids.map(id => [id, { loading: true }])));
    try {
      const results = await invoke<ConnectionCheckResult[]>("test_all_connections", { logEntryIds: ids });
      setChecks(Object.fromEntries(results.map(result => [result.logEntryId, { loading: false, result }])));
    } catch (error) {
      setChecks(Object.fromEntries(ids.map(id => [id, { loading: false, error: String(error) }])));
    } finally {
      setCheckingAll(false);
    }
  };

  const openAliasEdit = (entryId: string) => {
    const entry = config.logEntries.find(item => item.id === entryId);
    if (entry) setAliasEdit({ entryId, name: entry.name, value: (entry.alias ?? "").split(",").filter(Boolean).join("、") });
    setContextMenu(null);
  };

  const saveAlias = async () => {
    if (!aliasEdit) return;
    const entry = config.logEntries.find(item => item.id === aliasEdit.entryId);
    if (entry) await upsertLogEntry({ ...entry, alias: normalizeAlias(aliasEdit.value) });
    setAliasEdit(null);
  };

  const openEntryEdit = (entryId: string) => {
    setEditEntryId(entryId);
    setShowModal(true);
    setContextMenu(null);
  };

  const renderEntry = (entry: LogEntry) => {
    const check = checks[entry.id];
    const dirUrl = config.baseUrl.replace(/\/+$/, "") + "/" + entry.path.replace(/^\/+/, "");
    const aliases = (entry.alias ?? "").split(",").filter(Boolean);
    return (
      <label key={entry.id} title={`${entry.name}${aliases.length ? `\n别名：${aliases.join("、")}` : ""}\n${dirUrl}${entry.logFile}`} data-drag-row=""
        style={dropIndicatorStyle("entry", entry.id)}
        onDragOver={event => {
          if (filtering || dragItem?.kind !== "entry" || dragItem.groupId !== entry.groupId || dragItem.id === entry.id) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDropTarget({ kind: "entry", id: entry.id, ...entryDropPoint(event, event.currentTarget) });
        }}
        onDrop={event => {
          if (dragItem?.kind !== "entry") return;
          event.preventDefault();
          void finishEntryDrop(entry, entryDropPoint(event, event.currentTarget).position);
          clearDrag();
        }}
        onContextMenu={event => {
          event.preventDefault();
          setContextMenu({ x: Math.max(8, Math.min(event.clientX, window.innerWidth - 152)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 124)), dirUrl, entryId: entry.id });
        }}
        className={`server-entry ${entry.enabled ? "server-entry-selected" : ""}`}>
        <span role="button" tabIndex={-1} title={filtering ? "筛选时不能拖动排序" : "拖动排序"} aria-label={`拖动排序 ${entry.name}`}
          draggable={!filtering}
          className={`shrink-0 rounded p-0.5 ${filtering ? "cursor-not-allowed text-[#c8d0dc]" : "cursor-grab text-[#9aa8bc] hover:bg-[#e8edf5] hover:text-[#607086] active:cursor-grabbing"}`}
          onClick={event => { event.preventDefault(); event.stopPropagation(); }}
          onDragStart={event => {
            event.stopPropagation();
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", entry.id);
            const row = event.currentTarget.closest("[data-drag-row]") as HTMLElement | null;
            if (row) event.dataTransfer.setDragImage(row, 24, 14);
            setDragItem({ kind: "entry", groupId: entry.groupId, id: entry.id });
            setDropTarget(null);
          }}
          onDragEnd={clearDrag}>
          <GripVertical size={12} />
        </span>
        <input type="checkbox" className="h-3.5 w-3.5 shrink-0 accent-[#2563eb]" checked={entry.enabled} onChange={() => void toggleLogEntry(entry.id)} />
        <span className="min-w-0 flex-1 truncate">{entry.name}{aliases.length > 0 && <span className="ml-1.5 text-[#7c3aed]">({aliases.join("、")})</span>}</span>
        {check?.loading && <span className="shrink-0 text-[#607086]">...</span>}
        {check?.result && (check.result.ok ? <CheckCircle2 size={14} className="shrink-0 text-[#047857]" /> : <XCircle size={14} className="shrink-0 text-[#b42318]" />)}
        {check?.error && <XCircle size={14} className="shrink-0 text-[#b42318]" />}
      </label>
    );
  };

  return (
    <section className={`border-b border-[#d9e1ec] bg-white px-5 py-4 ${view === "all" ? "flex min-h-0 flex-1 flex-col overflow-hidden" : ""}`}>
      <div className={view === "scope" ? "hidden" : "mb-4 grid shrink-0 items-end gap-3"} style={{ gridTemplateColumns: view === "connection" ? "1fr 1fr" : "minmax(100px, 1fr) minmax(100px, 1fr) minmax(220px, 2fr) auto auto" }}>
        <label className="block min-w-0 text-sm font-medium">用户名
          <input className="mt-1 w-full rounded-md border border-[#cfd8e6] bg-white px-3 py-2 outline-none focus:border-[#2563eb]" value={authDraft.username}
            onChange={event => { setDirty(true); setAuthDraft(draft => ({ ...draft, username: event.target.value })); }} />
        </label>
        <label className="block min-w-0 text-sm font-medium">密码
          <div className="relative mt-1">
            <input type={showPassword ? "text" : "password"} className="w-full rounded-md border border-[#cfd8e6] bg-white py-2 pl-3 pr-10 outline-none focus:border-[#2563eb]" value={authDraft.password}
              onChange={event => { setDirty(true); setAuthDraft(draft => ({ ...draft, password: event.target.value })); }} />
            <button type="button" aria-label={showPassword ? "隐藏密码" : "显示密码"} aria-pressed={showPassword} title={showPassword ? "隐藏密码" : "显示密码"}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[#94a3b8] hover:text-[#243145]"
              onMouseDown={event => event.preventDefault()}
              onClick={() => setShowPassword(value => !value)}>
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </label>
        <label className={`block min-w-0 text-sm font-medium ${view === "connection" ? "col-span-2" : ""}`}>URL 前缀
          <input className="mt-1 w-full rounded-md border border-[#cfd8e6] bg-white px-3 py-2 outline-none focus:border-[#2563eb]" value={baseUrlDraft} placeholder="请输入日志服务的 http:// 或 https:// 地址"
            onChange={event => { setDirty(true); setBaseUrlDraft(event.target.value); }} />
        </label>
        <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md bg-[#10b981] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#059669] disabled:opacity-50" type="button" disabled={!dirty} onClick={() => void saveAll()}><Save size={16} />保存</button>
        <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-[#cfd8e6] bg-white px-4 py-2.5 text-sm font-medium hover:bg-[#eef3f8] disabled:opacity-50" type="button" disabled={checkingAll || dirty || !config.baseUrl || visibleEntries.length === 0} onClick={() => void testAll()} title={dirty ? "请先保存配置" : "测试所有日志连接"}><PlugZap size={16} />{checkingAll ? "测试中" : "测试连接"}</button>
      </div>

      {view !== "connection" && <div className={view === "all" ? "flex min-h-0 flex-1 flex-col gap-2.5" : "space-y-2.5"}>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#cfd8e6] bg-[#f8fafc] px-3 py-2 text-xs font-medium text-[#607086] hover:bg-[#eef3f8]" type="button" onClick={() => { setEditEntryId(null); setShowModal(true); }}><Settings size={14} />日志路径配置</button>
          <div className="relative min-w-[180px] flex-1">
            <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
            <input type="search" aria-label="筛选服务器配置" className="server-filter w-full rounded-md border border-[#cfd8e6] bg-white py-2 pl-8 pr-8 text-xs outline-none focus:border-[#2563eb]" placeholder="输入名称、分组、IP、路径或文件名筛选…" value={searchText} onChange={event => setSearchText(event.target.value)} onKeyDown={event => { if (event.key === "Escape") setSearchText(""); }} />
            {searchText && <button className="absolute right-2 top-1/2 -translate-y-1/2 rounded text-[#94a3b8] hover:text-[#243145]" type="button" aria-label="清空筛选" onClick={() => setSearchText("")}><X size={14} /></button>}
          </div>
          <span className="whitespace-nowrap text-xs text-[#607086]" role="status">{filtering ? `${filteredEntries.length} / ${visibleEntries.length} 项` : `共 ${visibleEntries.length} 项`}<span className="ml-3 text-[#2563eb]">已选 {selectedEntries.length}</span></span>
        </div>
        {visibleEntries.length > 0 && <div className="flex shrink-0 items-center justify-between gap-2 text-xs text-[#7b889b]">
          <span>{selectedOutsideFilter > 0 ? `筛选外仍有 ${selectedOutsideFilter} 项已勾选，操作时会一并使用` : `${hasCustomOrder ? "拖动排序生效中" : "按名称排序"} · 输入仅筛选，勾选由你决定`}</span>
          <div className="flex shrink-0 items-center gap-3">
            {hasCustomOrder && <button type="button" className="inline-flex items-center gap-1 text-[#607086] hover:text-[#2563eb]" title="清除拖动排序，恢复按名称排序" onClick={() => void resetEntryOrder()}><RotateCcw size={11} />恢复名称排序</button>}
            {!filtering && groups.length > 0 && <button type="button" className="shrink-0 text-[#607086] hover:text-[#2563eb]" onClick={() => setExpandedGroups(allCollapsed ? new Set(groups.map(([id]) => id)) : new Set())}>{allCollapsed ? "全部展开" : "全部折叠"}</button>}
          </div>
        </div>}
        <div className={`server-groups log-scrollbar ${view === "scope" ? "server-groups-drawer" : ""}`} aria-label="服务器配置列表">
          {groups.map(([groupId, group]) => {
            const allEnabled = group.entries.every(entry => entry.enabled);
            const count = group.entries.filter(entry => entry.enabled).length;
            const expanded = filtering || expandedGroups.has(groupId);
            return <div key={groupId} className="relative"
              onDragOver={event => {
                if (!groupId || filtering || dragItem?.kind !== "group" || dragItem.id === groupId) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropTarget({ kind: "group", id: groupId, position: dropPositionOf(event, event.currentTarget), axis: "y" });
              }}
              onDrop={event => {
                if (dragItem?.kind !== "group") return;
                event.preventDefault();
                void finishGroupDrop(groupId, dropPositionOf(event, event.currentTarget));
                clearDrag();
              }}>
              {groupDropLine(groupId, "before")}
              <div className="overflow-hidden rounded-md border border-[#e0e6ef]">
                <div data-drag-row="" className={`flex items-center gap-2 bg-[#f6f8fc] px-2.5 py-2 ${filtering ? "" : "cursor-pointer hover:bg-[#eef2f9]"}`} onClick={() => { if (!filtering) toggleExpand(groupId); }}>
                {groupId ? <span role="button" tabIndex={-1} title={filtering ? "筛选时不能拖动排序" : "拖动排序"} aria-label={`拖动排序分组 ${group.name}`}
                  draggable={!filtering}
                  className={`shrink-0 rounded p-0.5 ${filtering ? "cursor-not-allowed text-[#c8d0dc]" : "cursor-grab text-[#9aa8bc] hover:bg-[#e8edf5] hover:text-[#607086] active:cursor-grabbing"}`}
                  onClick={event => { event.preventDefault(); event.stopPropagation(); }}
                  onDragStart={event => {
                    event.stopPropagation();
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", groupId);
                    const row = event.currentTarget.closest("[data-drag-row]") as HTMLElement | null;
                    if (row) event.dataTransfer.setDragImage(row, 24, 16);
                    setDragItem({ kind: "group", id: groupId });
                    setDropTarget(null);
                  }}
                  onDragEnd={clearDrag}>
                  <GripVertical size={14} />
                </span> : <span className="w-[18px] shrink-0" aria-hidden="true" />}
                <button type="button" aria-label={`${expanded ? "折叠" : "展开"}${group.name}`} aria-expanded={expanded} disabled={filtering} className="rounded p-0.5 text-[#607086] hover:bg-[#e8edf5] disabled:cursor-default" onClick={event => { event.stopPropagation(); toggleExpand(groupId); }}>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
                <label className="inline-flex min-w-0 cursor-pointer items-center gap-2 text-xs font-semibold text-[#243145]" onClick={event => event.stopPropagation()}>
                  <input ref={element => { if (element) element.indeterminate = count > 0 && !allEnabled; }} type="checkbox" aria-label={`${filtering ? "勾选筛选结果" : "勾选分组"} ${group.name}`} className="h-3.5 w-3.5 shrink-0 accent-[#2563eb]" checked={allEnabled} onChange={() => void toggleLogEntries(group.entries.map(entry => entry.id))} />
                  <span className="truncate">{group.name}</span>
                </label>
                <span className="ml-auto shrink-0 text-xs text-[#7b889b]">已选 {count} / {group.entries.length}</span>
              </div>
                {expanded && <div className="server-entry-grid p-2">{group.entries.map(renderEntry)}</div>}
              </div>
              {groupDropLine(groupId, "after")}
            </div>;
          })}
          {visibleEntries.length === 0 && <div className="rounded-md border border-dashed border-[#d7dfeb] px-4 py-5 text-center text-xs text-[#7b889b]">暂无服务器配置，点击“日志路径配置”添加或导入。</div>}
          {visibleEntries.length > 0 && filteredEntries.length === 0 && <div className="py-5 text-center text-xs text-[#7b889b]">没有匹配的配置，试试其他关键词或<button type="button" className="ml-1 text-[#2563eb]" onClick={() => setSearchText("")}>清空筛选</button>。</div>}
        </div>
        <p className="shrink-0 text-xs leading-5 text-[#7b889b]">勾选后可下载或查询日志；右键可编辑路径、打开服务器目录或设置别名（AI 可通过别名识别日志）。.gz 文件会自动解压。</p>
      </div>}

      {contextMenu && createPortal(<div ref={menuRef} role="menu" aria-label="服务器操作" className="fixed z-[100] min-w-[144px] rounded-md border border-[#d9e1ec] bg-white py-1 shadow-lg" style={{ left: contextMenu.x, top: contextMenu.y }}>
        <button role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 text-xs text-[#243145] hover:bg-[#f0f4ff]" type="button" onClick={() => { void invoke("open_file", { path: contextMenu.dirUrl }); setContextMenu(null); }}><ExternalLink size={13} />跳转</button>
        <button role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 text-xs text-[#243145] hover:bg-[#f0f4ff]" type="button" onClick={() => openEntryEdit(contextMenu.entryId)}><Pencil size={13} />编辑路径</button>
        <button role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 text-xs text-[#243145] hover:bg-[#f0f4ff]" type="button" onClick={() => openAliasEdit(contextMenu.entryId)}><Tag size={13} />设置别名</button>
      </div>, document.body)}
      {aliasEdit && createPortal(<div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/30" onPointerDown={event => { if (event.target === event.currentTarget) setAliasEdit(null); }}>
        <form role="dialog" aria-modal="true" aria-label="设置别名" className="w-[420px] max-w-[90vw] rounded-lg bg-white p-5 shadow-xl"
          onSubmit={event => { event.preventDefault(); void saveAlias(); }}
          onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setAliasEdit(null); } }}>
          <h2 className="text-sm font-semibold text-[#18212f]">设置别名</h2>
          <p className="mt-1 truncate text-xs text-[#69778c]" title={aliasEdit.name}>{aliasEdit.name}</p>
          <input autoFocus className="mt-3 w-full rounded-md border border-[#cfd8e6] px-3 py-2 text-sm outline-none focus:border-[#2563eb]" placeholder="例如：SIT网关、C1网关" value={aliasEdit.value}
            onChange={event => setAliasEdit(edit => edit && { ...edit, value: event.target.value })} />
          <p className="mt-2 text-xs leading-5 text-[#7b889b]">多个别名用逗号或顿号分隔。和 AI 对话时说出别名，AI 就能定位到这个日志。留空表示清除别名。</p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="rounded-md border border-[#cfd8e6] px-4 py-2 text-sm hover:bg-[#eef3f8]" onClick={() => setAliasEdit(null)}>取消</button>
            <button type="submit" className="rounded-md bg-[#2563eb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8]">保存</button>
          </div>
        </form>
      </div>, document.body)}
      {showModal && (
        <LogPathModal
          initialEditEntryId={editEntryId ?? undefined}
          onClose={() => { setShowModal(false); setEditEntryId(null); }}
          onSaved={(entryId) => setChecks((prev) => {
            const next = { ...prev };
            delete next[entryId];
            return next;
          })}
        />
      )}
    </section>
  );
}
