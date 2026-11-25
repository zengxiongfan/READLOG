import { create } from "zustand";
import { invoke } from "../lib/runtime";
import type { AppConfig, LogEntry, ServiceProfile } from "../types/query";

interface ServerState {
  config: AppConfig | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  save: (config: AppConfig) => Promise<void>;
  upsertLogEntry: (entry: LogEntry) => Promise<void>;
  deleteLogEntry: (entryId: string) => Promise<void>;
  toggleLogEntry: (entryId: string) => Promise<void>;
  toggleLogEntries: (entryIds: string[]) => Promise<void>;
  toggleLogEntryVisible: (entryId: string) => Promise<void>;
  toggleGroup: (groupId: string) => Promise<void>;
  toggleGroupVisible: (groupId: string) => Promise<void>;
  renameGroup: (groupId: string, name: string) => Promise<void>;
  deleteGroup: (groupId: string) => Promise<void>;
  saveGroupOrder: (ids: string[]) => Promise<void>;
  saveEntryOrder: (groupId: string, ids: string[]) => Promise<void>;
  resetEntryOrder: () => Promise<void>;
  upsertService: (profile: ServiceProfile) => Promise<void>;
  deleteService: (serviceId: string) => Promise<void>;
  saveServices: (services: ServiceProfile[]) => Promise<void>;
}

// Keep rapid manual selections responsive while writing snapshots in order.
let saveQueue: Promise<void> = Promise.resolve();
let saveRevision = 0;
let persistedConfig: AppConfig | null = null;

export const useServerStore = create<ServerState>((set, get) => ({
  config: null,
  loading: false,
  error: null,
  load: async () => {
    set({ loading: true, error: null });
    try {
      const config = await invoke<AppConfig>("load_app_config");
      // Selection is session-scoped: every launch starts with nothing checked.
      const sessionConfig = {
        ...config,
        logEntries: config.logEntries.map((entry) => (entry.enabled ? { ...entry, enabled: false } : entry)),
      };
      persistedConfig = sessionConfig;
      set({ config: sessionConfig, loading: false });
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },
  save: async (config) => {
    const revision = ++saveRevision;
    set({ config, loading: true, error: null });
    const pending = saveQueue.then(async () => {
      try {
        const saved = await invoke<AppConfig>("save_app_config", { config });
        persistedConfig = saved;
        if (revision === saveRevision) set({ config: saved, loading: false });
      } catch (error) {
        if (revision === saveRevision) set({ config: persistedConfig, error: String(error), loading: false });
      }
    });
    saveQueue = pending;
    await pending;
  },
  upsertLogEntry: async (entry) => {
    const config = get().config;
    if (!config) return;
    const exists = config.logEntries.some((item) => item.id === entry.id);
    const logEntries = exists
      ? config.logEntries.map((item) => (item.id === entry.id ? entry : item))
      : [...config.logEntries, { ...entry, displayOrder: config.logEntries.length }];
    await get().save({ ...config, logEntries });
  },
  deleteLogEntry: async (entryId) => {
    const config = get().config;
    if (!config) return;
    const logEntries = config.logEntries
      .filter((entry) => entry.id !== entryId)
      .map((entry, displayOrder) => ({ ...entry, displayOrder }));
    const entryOrder = Object.fromEntries(
      Object.entries(config.entryOrder)
        .map(([groupId, ids]) => [groupId, ids.filter((id) => id !== entryId)])
        .filter(([, ids]) => ids.length > 0),
    );
    await get().save({ ...config, logEntries, entryOrder });
  },
  toggleLogEntry: async (entryId) => {
    await get().toggleLogEntries([entryId]);
  },
  toggleLogEntries: async (entryIds) => {
    const config = get().config;
    if (!config) return;
    const ids = new Set(entryIds);
    const entries = config.logEntries.filter(entry => ids.has(entry.id));
    if (!entries.length) return;
    const enabled = !entries.every(entry => entry.enabled);
    const logEntries = config.logEntries.map((entry) =>
      ids.has(entry.id) ? { ...entry, enabled } : entry,
    );
    await get().save({ ...config, logEntries });
  },
  toggleLogEntryVisible: async (entryId) => {
    const config = get().config;
    if (!config) return;
    const logEntries = config.logEntries.map((entry) =>
      entry.id === entryId ? { ...entry, visible: !entry.visible } : entry,
    );
    await get().save({ ...config, logEntries });
  },
  toggleGroup: async (groupId) => {
    const config = get().config;
    if (!config) return;
    const groupEntries = config.logEntries.filter((e) => e.groupId === groupId);
    const allEnabled = groupEntries.length > 0 && groupEntries.every((e) => e.enabled);
    const logEntries = config.logEntries.map((entry) =>
      entry.groupId === groupId ? { ...entry, enabled: !allEnabled } : entry,
    );
    await get().save({ ...config, logEntries });
  },
  toggleGroupVisible: async (groupId) => {
    const config = get().config;
    if (!config) return;
    const groupEntries = config.logEntries.filter((e) => e.groupId === groupId);
    const allVisible = groupEntries.length > 0 && groupEntries.every((e) => e.visible);
    const logEntries = config.logEntries.map((entry) =>
      entry.groupId === groupId ? { ...entry, visible: !allVisible } : entry,
    );
    await get().save({ ...config, logEntries });
  },
  renameGroup: async (groupId, name) => {
    const config = get().config;
    if (!config) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const logEntries = config.logEntries.map((entry) =>
      entry.groupId === groupId ? { ...entry, groupName: trimmed } : entry,
    );
    await get().save({ ...config, logEntries });
  },
  deleteGroup: async (groupId) => {
    const config = get().config;
    if (!config) return;
    const logEntries = config.logEntries
      .filter((entry) => entry.groupId !== groupId)
      .map((entry, displayOrder) => ({ ...entry, displayOrder }));
    const entryOrder = { ...config.entryOrder };
    delete entryOrder[groupId];
    await get().save({ ...config, logEntries, entryOrder, groupOrder: config.groupOrder.filter((id) => id !== groupId) });
  },
  saveGroupOrder: async (ids) => {
    const config = get().config;
    if (!config) return;
    await get().save({ ...config, groupOrder: ids });
  },
  saveEntryOrder: async (groupId, ids) => {
    const config = get().config;
    if (!config) return;
    await get().save({ ...config, entryOrder: { ...config.entryOrder, [groupId]: ids } });
  },
  resetEntryOrder: async () => {
    const config = get().config;
    if (!config) return;
    await get().save({ ...config, groupOrder: [], entryOrder: {} });
  },
  upsertService: async (profile) => {
    const config = get().config;
    if (!config) return;
    const services = config.services ?? [];
    const exists = services.some((item) => item.id === profile.id);
    const next = exists
      ? services.map((item) => (item.id === profile.id ? profile : item))
      : [...services, profile];
    await get().save({ ...config, services: next });
  },
  deleteService: async (serviceId) => {
    const config = get().config;
    if (!config) return;
    await get().save({ ...config, services: (config.services ?? []).filter((item) => item.id !== serviceId) });
  },
  saveServices: async (services) => {
    const config = get().config;
    if (!config) return;
    await get().save({ ...config, services });
  },
}));
