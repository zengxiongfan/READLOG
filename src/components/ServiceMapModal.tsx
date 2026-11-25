import { Download, FolderOpen, Plus, Trash2, Upload, Wand2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { invoke, isTauriRuntime, pickDirectory, saveDialog } from "../lib/runtime";
import { useServerStore } from "../store/serverStore";
import type { LogEntry, ServiceProfile } from "../types/query";

interface Props {
  onClose: () => void;
}

interface EditDraft {
  id: string;
  name: string;
  aliases: string;
  codeDir: string;
  branches: Record<string, string>;
  isNew: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  ok: "OK",
  noLogs: "无日志项",
  missingCodeRoot: "未配置代码根",
  missingCodeDir: "目录不存在",
  checking: "检查中",
};

const STATUS_CLASSES: Record<string, string> = {
  ok: "bg-[#ecfdf5] text-[#047857]",
  noLogs: "bg-[#f1f5f9] text-[#64748b]",
  missingCodeRoot: "bg-[#fff7ed] text-[#b45309]",
  missingCodeDir: "bg-[#fef2f2] text-[#b42318]",
  checking: "bg-[#eff6ff] text-[#1d4ed8]",
};

const ENVS = ["SIT", "UAT", "STG"];

const DEFAULT_BRANCHES: Record<string, string> = {
  SIT: "origin/sit",
  UAT: "origin/uat",
  STG: "origin/stg",
};

function stripPodIp(name: string) {
  const index = name.lastIndexOf("-");
  if (index < 0) return name;
  const tail = name.slice(index + 1);
  const parts = tail.split(".");
  if (parts.length === 4 && parts.every(part => /^[0-9]{1,3}$/.test(part) && Number(part) <= 255)) {
    return name.slice(0, index);
  }
  return name;
}

function serviceOf(entry: LogEntry, services: ServiceProfile[]) {
  if (entry.serviceId) {
    const linked = services.find(service => service.id === entry.serviceId);
    if (linked) return linked;
  }
  const name = stripPodIp(entry.name).toLowerCase();
  return services.find(service => service.name.toLowerCase() === name);
}

function environmentOf(group: string) {
  const upper = group.trim().toUpperCase();
  for (const env of ["SIT", "UAT", "STG", "PROD"]) {
    if (upper.startsWith(env)) return env;
  }
  return group.trim();
}

function isAbsolutePath(path: string) {
  return path.length > 2 && path[1] === ":";
}

function resolveDir(service: ServiceProfile, codeRoot: string) {
  const dir = (service.codeDir ?? "").trim() || service.name.trim();
  if (!dir) return null;
  if (isAbsolutePath(dir)) return dir;
  const root = codeRoot.trim();
  if (!root) return null;
  return root.replace(/\/+$/, "") + "/" + dir.replace(/^\/+/, "");
}

export function ServiceMapModal({ onClose }: Props) {
  const config = useServerStore(state => state.config);
  const save = useServerStore(state => state.save);
  const upsertService = useServerStore(state => state.upsertService);
  const deleteService = useServerStore(state => state.deleteService);
  const saveServices = useServerStore(state => state.saveServices);
  const services = useMemo(() => config?.services ?? [], [config?.services]);
  const [codeRootDraft, setCodeRootDraft] = useState(config?.settings.codeRoot ?? "");
  const [rootExists, setRootExists] = useState<boolean | null>(null);
  const [dirExists, setDirExists] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCodeRootDraft(config?.settings.codeRoot ?? "");
  }, [config?.settings.codeRoot]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (draft) setDraft(null);
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [draft, onClose]);

  useEffect(() => {
    let cancelled = false;
    if (!codeRootDraft.trim()) {
      setRootExists(null);
      return;
    }
    void invoke<boolean>("path_is_dir", { path: codeRootDraft })
      .then(ok => { if (!cancelled) setRootExists(ok); })
      .catch(() => { if (!cancelled) setRootExists(false); });
    return () => { cancelled = true; };
  }, [codeRootDraft]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const next: Record<string, boolean> = {};
      for (const service of services) {
        const dir = resolveDir(service, codeRootDraft);
        if (!dir) continue;
        try {
          next[service.id] = await invoke<boolean>("path_is_dir", { path: dir });
        } catch {
          next[service.id] = false;
        }
      }
      if (!cancelled) setDirExists(next);
    };
    void run();
    return () => { cancelled = true; };
  }, [services, codeRootDraft]);

  if (!config) return null;

  const saveCodeRoot = async (value = codeRootDraft) => {
    if (value.trim() === (config.settings.codeRoot ?? "")) return;
    await save({ ...config, settings: { ...config.settings, codeRoot: value.trim() } });
  };

  const chooseRoot = async () => {
    const dir = await pickDirectory("选择代码根目录");
    if (!dir) return;
    setCodeRootDraft(dir);
    await save({ ...config, settings: { ...config.settings, codeRoot: dir } });
  };

  const openNew = () => {
    setDraft({ id: crypto.randomUUID(), name: "", aliases: "", codeDir: "", branches: { ...DEFAULT_BRANCHES }, isNew: true });
  };

  const openEdit = (service: ServiceProfile) => {
    setDraft({
      id: service.id,
      name: service.name,
      aliases: service.aliases ?? "",
      codeDir: service.codeDir ?? "",
      branches: { ...(service.branches ?? {}) },
      isNew: false,
    });
  };

  const saveDraft = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) {
      setNotice("服务名不能为空");
      return;
    }
    if (services.some(service => service.id !== draft.id && service.name.toLowerCase() === name.toLowerCase())) {
      setNotice("服务名已存在");
      return;
    }
    const branches: Record<string, string> = {};
    for (const env of ENVS) {
      const value = (draft.branches[env] ?? "").trim();
      if (value) branches[env] = value;
    }
    await upsertService({
      id: draft.id,
      name,
      aliases: draft.aliases.trim(),
      codeDir: draft.codeDir.trim(),
      branches,
    });
    setDraft(null);
    setNotice("");
  };

  const removeDraft = async () => {
    if (!draft) return;
    if (!window.confirm(`删除服务「${draft.name}」？日志项不会被删除。`)) return;
    await deleteService(draft.id);
    setDraft(null);
  };

  const generateSkeleton = async () => {
    const generated = new Map<string, string>();
    for (const entry of config.logEntries) {
      if (serviceOf(entry, services)) continue;
      const name = stripPodIp(entry.name).trim();
      if (name) generated.set(name.toLowerCase(), name);
    }
    const created = [...generated.entries()]
      .filter(([lower]) => !services.some(service => service.name.toLowerCase() === lower))
      .map(([, name]) => ({ id: crypto.randomUUID(), name, aliases: "", codeDir: name, branches: { ...DEFAULT_BRANCHES } }));
    if (created.length === 0) {
      setNotice("没有可生成的新服务");
      return;
    }
    await saveServices([...services, ...created]);
    setNotice(`已生成 ${created.length} 个服务骨架；请补充别名、代码目录和分支`);
  };

  const applyDefaultBranches = async () => {
    if (services.length === 0) {
      setNotice("还没有服务映射");
      return;
    }
    if (!window.confirm("将所有服务的分支改为 origin/sit、origin/uat、origin/stg？")) return;
    await saveServices(services.map(service => ({ ...service, branches: { ...DEFAULT_BRANCHES } })));
    setNotice("已全部填入默认远端分支");
  };

  const exportJson = async () => {
    const payload = { schemaVersion: 1, codeRoot: codeRootDraft, services };
    const content = JSON.stringify(payload, null, 2);
    if (!isTauriRuntime()) {
      const blob = new Blob([content], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "服务映射.json";
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice("已导出服务映射");
      return;
    }
    try {
      const filePath = await saveDialog({
        defaultPath: "服务映射.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!filePath) return;
      await invoke("export_services_json", { outputPath: filePath, content });
      setNotice(`已导出：${filePath}`);
    } catch (error) {
      setNotice(`导出失败：${String(error)}`);
    }
  };

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = Array.isArray(parsed?.services) ? parsed.services : Array.isArray(parsed) ? parsed : null;
      if (!incoming) throw new Error("文件中没有 services 数组");
      const cleaned: ServiceProfile[] = incoming
        .filter((item: ServiceProfile) => item && typeof item.name === "string" && item.name.trim())
        .map((item: ServiceProfile) => ({
          id: typeof item.id === "string" && item.id ? item.id : crypto.randomUUID(),
          name: item.name.trim(),
          aliases: typeof item.aliases === "string" ? item.aliases : "",
          codeDir: typeof item.codeDir === "string" ? item.codeDir : "",
          branches: item.branches && typeof item.branches === "object" ? item.branches : {},
        }));
      await save({
        ...config,
        services: cleaned,
        settings: {
          ...config.settings,
          codeRoot: typeof parsed?.codeRoot === "string" ? parsed.codeRoot : config.settings.codeRoot,
        },
      });
      if (typeof parsed?.codeRoot === "string") setCodeRootDraft(parsed.codeRoot);
      setNotice(`已导入 ${cleaned.length} 个服务`);
    } catch (error) {
      setNotice(`导入失败：${String(error)}`);
    }
    event.target.value = "";
  };

  const unmappedEntries = config.logEntries.filter(entry => !serviceOf(entry, services));
  const rows = services.map(service => {
    const entries = config.logEntries.filter(entry => serviceOf(entry, services)?.id === service.id);
    const environments = [...new Set(entries.map(entry => environmentOf(entry.groupName)))].sort();
    const dir = resolveDir(service, codeRootDraft);
    let status = "ok";
    if (entries.length === 0) status = "noLogs";
    else if (!dir) status = "missingCodeRoot";
    else if (dirExists[service.id] === false) status = "missingCodeDir";
    else if (dirExists[service.id] === undefined) status = "checking";
    return { service, entries, environments, status };
  });

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[88vh] w-full max-w-[1040px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label="服务与代码映射">
        <div className="flex items-start justify-between border-b border-[#e3e8f0] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">服务与代码映射</h2>
            <p className="mt-1 text-xs text-[#69778c]">服务、别名、代码目录与分支只保存在本机，readgcislog map 自动读取</p>
          </div>
          <button className="reader-tool" type="button" aria-label="关闭" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold">代码根</span>
            <input
              className="min-w-[260px] flex-1 rounded-md border border-[#cfd8e6] px-3 py-2 text-xs outline-none focus:border-[#2563eb]"
              value={codeRootDraft}
              onChange={event => setCodeRootDraft(event.target.value)}
              onBlur={() => void saveCodeRoot()}
              placeholder="例如：F:/Projects_zsxn_cgis"
            />
            <button className="reader-tool" type="button" onClick={() => void chooseRoot()}><FolderOpen size={14} />选择目录</button>
            <button className="reader-tool" type="button" disabled={codeRootDraft.trim() === (config.settings.codeRoot ?? "")} onClick={() => void saveCodeRoot()}>保存</button>
            <span className={`rounded-full px-2 py-0.5 text-[11px] ${rootExists ? "bg-[#ecfdf5] text-[#047857]" : rootExists === false ? "bg-[#fef2f2] text-[#b42318]" : "bg-[#f1f5f9] text-[#64748b]"}`}>
              {codeRootDraft.trim() ? (rootExists === null ? "检查中" : rootExists ? "存在" : "不存在") : "未配置"}
            </span>
          </div>
          {notice && <div className="mb-3 rounded-md border border-[#bfdbfe] bg-[#eff6ff] px-3 py-2 text-xs text-[#1d4ed8]">{notice}</div>}
          <div className="overflow-x-auto rounded-md border border-[#e0e6ef]">
            <table className="w-full border-collapse text-xs">
              <thead className="bg-[#f6f8fc] text-[#52627a]">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">服务名</th>
                  <th className="px-3 py-2 text-left font-semibold">别名</th>
                  <th className="px-3 py-2 text-left font-semibold">代码目录</th>
                  {ENVS.map(env => <th key={env} className="px-3 py-2 text-left font-semibold">{env} 分支</th>)}
                  <th className="px-3 py-2 text-left font-semibold">状态</th>
                  <th className="px-3 py-2 text-right font-semibold">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ service, entries, environments, status }) => (
                  <tr key={service.id} className="border-t border-[#eef1f6] hover:bg-[#fafcff]">
                    <td className="px-3 py-2">
                      <div className="font-medium text-[#243145]">{service.name}</div>
                      <div className="mt-0.5 text-[11px] text-[#7b889b]">{environments.length ? environments.join("、") : "无日志环境"} · {entries.length} 项</div>
                    </td>
                    <td className="px-3 py-2 text-[#7c3aed]">{service.aliases ? service.aliases.split(/[,，、;；]/).filter(Boolean).join("、") : "-"}</td>
                    <td className="px-3 py-2 text-[#334155]">{(service.codeDir ?? "").trim() || service.name}</td>
                    {ENVS.map(env => <td key={env} className="px-3 py-2 text-[#334155]">{service.branches?.[env] || "-"}</td>)}
                    <td className="px-3 py-2"><span className={`inline-block rounded-full px-2 py-0.5 text-[11px] ${STATUS_CLASSES[status]}`}>{STATUS_LABELS[status]}</span></td>
                    <td className="px-3 py-2 text-right"><button className="reader-tool" type="button" onClick={() => openEdit(service)}>编辑</button></td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-[#7b889b]">还没有服务映射，点击「从日志项生成服务骨架」或「新建服务」开始</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 text-xs text-[#69778c]">
            未关联服务的日志项：{unmappedEntries.length}
            {unmappedEntries.length > 0 ? `（${unmappedEntries.slice(0, 3).map(entry => entry.name).join("、")}${unmappedEntries.length > 3 ? " 等" : ""}）` : ""}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-[#e3e8f0] px-5 py-3">
          <button className="reader-tool" type="button" onClick={openNew}><Plus size={14} />新建服务</button>
          <button className="reader-tool" type="button" onClick={() => void generateSkeleton()}><Wand2 size={14} />从日志项生成服务骨架</button>
          <button className="reader-tool" type="button" onClick={() => void applyDefaultBranches()}>全部填默认分支</button>
          <span className="flex-1" />
          <button className="reader-tool" type="button" onClick={() => fileRef.current?.click()}><Upload size={14} />导入</button>
          <button className="reader-tool" type="button" onClick={exportJson}><Download size={14} />导出</button>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={event => void importFile(event)} />
        </div>
      </div>
      {draft && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/30 p-4"
          onMouseDown={event => { if (event.target === event.currentTarget) setDraft(null); }}
        >
          <div className="w-full max-w-[520px] rounded-xl bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label="编辑服务">
            <div className="flex items-start justify-between border-b border-[#e3e8f0] px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold">{draft.isNew ? "新建服务" : "编辑服务"}</h3>
                <p className="mt-1 text-xs text-[#69778c]">别名用于 AI 识别你说的是哪个服务</p>
              </div>
              <button className="reader-tool" type="button" aria-label="关闭" onClick={() => setDraft(null)}><X size={18} /></button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <label className="block text-xs font-semibold">服务名
                <input className="mt-1 w-full rounded-md border border-[#cfd8e6] px-3 py-2 text-sm outline-none focus:border-[#2563eb]" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="例如：cgis-web-claim" />
              </label>
              <label className="block text-xs font-semibold">别名（逗号分隔）
                <input className="mt-1 w-full rounded-md border border-[#cfd8e6] px-3 py-2 text-sm outline-none focus:border-[#2563eb]" value={draft.aliases} onChange={event => setDraft({ ...draft, aliases: event.target.value })} placeholder="例如：理赔、理赔服务" />
              </label>
              <label className="block text-xs font-semibold">代码目录
                <input className="mt-1 w-full rounded-md border border-[#cfd8e6] px-3 py-2 text-sm outline-none focus:border-[#2563eb]" value={draft.codeDir} onChange={event => setDraft({ ...draft, codeDir: event.target.value })} placeholder="相对代码根，或绝对路径；留空使用服务名" />
              </label>
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">代码分支（按日志环境）</span>
                  <button className="text-[11px] text-[#2563eb] hover:underline" type="button" onClick={() => setDraft({ ...draft, branches: { ...DEFAULT_BRANCHES } })}>填入默认远端分支</button>
                </div>
                <p className="mt-1 text-[11px] text-[#7b889b]">左侧是日志环境，右侧填该环境对应的代码分支；默认 origin/sit、origin/uat、origin/stg</p>
                <div className="mt-2 space-y-2">
                  {ENVS.map(env => (
                    <div key={env} className="flex items-center gap-2">
                      <span className="w-11 shrink-0 rounded-md bg-[#eff6ff] py-1 text-center text-[11px] font-bold tracking-wide text-[#1d4ed8]">{env}</span>
                      <div className="flex flex-1 overflow-hidden rounded-md border border-[#cfd8e6] bg-white focus-within:border-[#2563eb]">
                        <span className="flex items-center border-r border-[#e3e8f0] bg-[#f6f8fc] px-2 text-[11px] text-[#7b889b]">分支</span>
                        <input className="min-w-0 flex-1 px-3 py-1.5 text-xs outline-none" value={draft.branches[env] ?? ""} onChange={event => setDraft({ ...draft, branches: { ...draft.branches, [env]: event.target.value } })} placeholder={`例如 origin/${env.toLowerCase()}`} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 border-t border-[#e3e8f0] px-5 py-3">
              {!draft.isNew && (
                <button className="inline-flex items-center gap-1 rounded-md border border-[#fecdca] px-3 py-2 text-xs text-[#b42318] hover:bg-[#fff1f3]" type="button" onClick={() => void removeDraft()}><Trash2 size={14} />删除</button>
              )}
              <span className="flex-1" />
              <button className="reader-tool" type="button" onClick={() => setDraft(null)}>取消</button>
              <button className="rounded-md bg-[#10b981] px-4 py-2 text-sm font-medium text-white hover:bg-[#059669]" type="button" onClick={() => void saveDraft()}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
