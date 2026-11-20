import type { LogEntry } from "../types/query";

const nameOrder = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

function byName(a: LogEntry, b: LogEntry) {
  return nameOrder.compare(a.name, b.name) || nameOrder.compare(a.path, b.path) || a.id.localeCompare(b.id);
}

function rankOf(ids: string[] | undefined) {
  return new Map((ids ?? []).map((id, index) => [id, index]));
}

function compareRank(aRank: number | undefined, bRank: number | undefined) {
  if (aRank !== undefined && bRank !== undefined) return aRank - bRank;
  if (aRank !== undefined) return -1;
  if (bRank !== undefined) return 1;
  return 0;
}

export function sortLogEntries(entries: LogEntry[], orderIds?: string[]): LogEntry[] {
  const rank = rankOf(orderIds);
  return [...entries].sort((a, b) => compareRank(rank.get(a.id), rank.get(b.id)) || byName(a, b));
}

export function groupLogEntries(
  entries: LogEntry[],
  options?: { groupOrder?: string[]; entryOrder?: Record<string, string[]> },
) {
  const groups = new Map<string, { name: string; entries: LogEntry[] }>();
  for (const entry of sortLogEntries(entries)) {
    const id = entry.groupId;
    if (!groups.has(id)) groups.set(id, { name: id ? entry.groupName : "未分组", entries: [] });
    groups.get(id)!.entries.push(entry);
  }
  for (const [id, group] of groups) {
    group.entries = sortLogEntries(group.entries, options?.entryOrder?.[id]);
  }
  const groupRank = rankOf(options?.groupOrder);
  return [...groups.entries()].sort(([aId, a], [bId, b]) => {
    if (!aId) return 1;
    if (!bId) return -1;
    return compareRank(groupRank.get(aId), groupRank.get(bId)) || nameOrder.compare(a.name, b.name);
  });
}

/** 整理别名：支持中英文逗号、顿号、分号或空白分隔，去重后用英文逗号连接。 */
export function normalizeAlias(value: string): string {
  const parts = value.split(/[,，、;；\s]+/).map(part => part.trim()).filter(Boolean);
  return [...new Set(parts)].join(",");
}

export function matchesLogEntry(entry: LogEntry, query: string, baseUrl: string): boolean {
  const text = `${entry.name} ${entry.alias ?? ""} ${entry.groupName} ${baseUrl.replace(/\/+$/, "")}/${entry.path.replace(/^\/+/, "")}${entry.logFile}`.toLocaleLowerCase();
  return query.trim().toLocaleLowerCase().split(/\s+/).every(term => text.includes(term));
}
