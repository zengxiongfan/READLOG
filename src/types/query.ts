import type { LogEvent, LogLevel } from "./log";

export interface QueryRequest {
  queryId: string;
  logEntryIds: string[];
  filePath: string;
  startTime: string | null;
  endTime: string | null;
  keyword: string;
  level: LogLevel;
  batchSize: number;
}

export interface QueryProgressEvent {
  queryId: string;
  status: "running" | "completed" | "cancelled" | string;
  scannedBytes: number;
  scannedEvents: number;
  matchedEvents: number;
  serversCompleted: string[];
  serversPending: string[];
}

export interface QueryResultEvent {
  queryId: string;
  batchIndex: number;
  events: LogEvent[];
  isLastBatch: boolean;
}

export interface ServiceProfile {
  id: string;
  name: string;
  /** 服务级别名，多个用逗号分隔 */
  aliases?: string;
  /** 代码目录：相对 codeRoot，或绝对路径；为空时回退为服务名 */
  codeDir?: string;
  /** 环境 -> 分支，例如 { SIT: "sit", UAT: "uat" } */
  branches?: Record<string, string>;
}

export interface LogEntry {
  id: string;
  name: string;
  path: string;
  logFile: string;
  visible: boolean;
  enabled: boolean;
  displayOrder: number;
  groupId: string;
  groupName: string;
  /** 别名，多个用逗号分隔 */
  alias?: string;
  /** 关联的服务映射 id；为空时按名称去掉 Pod IP 推导 */
  serviceId?: string;
}

export interface ServerConfig {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  displayOrder: number;
}

export interface AppConfig {
  baseUrl: string;
  logEntries: LogEntry[];
  services: ServiceProfile[];
  credentials: {
    username: string;
    password: string;
  };
  groupOrder: string[];
  entryOrder: Record<string, string[]>;
  settings: {
    maxConcurrentServers: number;
    defaultBatchSize: number;
    defaultLevel: LogLevel;
    downloadPath: string;
    agentPromptTemplate: string;
    /** 本地代码工作区根目录 */
    codeRoot: string;
  };
}

export interface DirEntry {
  name: string;
  url: string;
  isDir: boolean;
}

export interface ConnectionCheckResult {
  ok: boolean;
  logEntryId: string;
  serverName: string;
  statusCode: number;
  message: string;
  fileCount: number;
  fileSize?: number | null;
}

export interface DownloadSummary {
  serverCount: number;
  bytesWritten: number;
  outputPath: string;
}

export interface LogSearchRequest {
  queryId: string;
  logEntryIds: string[];
  keyword: string;
  matchMode: "phrase" | "all" | "any";
  caseSensitive: boolean;
  beforeLines: number;
  afterLines: number;
  detailContextLines: number;
  maxResults: number;
  batchSize: number;
}

export interface LogSearchHit {
  id: string;
  logEntryId: string;
  serverName: string;
  fileName: string;
  lineNumber: number;
  matchedLine: string;
  previewBeforeLines: string[];
  previewAfterLines: string[];
  detailBeforeLines: string[];
  detailAfterLines: string[];
}

export interface LogSearchProgressEvent {
  queryId: string;
  status: string;
  scannedBytes: number;
  scannedLines: number;
  matchedCount: number;
  currentServer: string;
}

export interface LogSearchResultEvent {
  queryId: string;
  batchIndex: number;
  results: LogSearchHit[];
  isLastBatch: boolean;
}
