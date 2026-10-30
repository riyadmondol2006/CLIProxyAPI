/**
 * Claude usage: reads Claude Code's local logs through the desktop app backend
 * (`/app/claude-usage/*`, same origin). Plain fetch on purpose: XHR does not work on the
 * app's wails:// scheme. Every response is normalized so missing fields read as empty.
 */

export interface ClaudeUsageStatus {
  scanning: boolean;
  filesTotal: number;
  filesDone: number;
  bytesTotal: number;
  bytesDone: number;
  lastScanAt: string;
  lastError: string;
  turns: number;
  sessions: number;
  sources: string[];
  dbPath: string;
}

export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ModelOption {
  model: string;
  turns: number;
  tokens: number;
  priced: boolean;
}

export interface UsageTotals extends TokenCounts {
  sessions: number;
  turns: number;
  subagentTokens: number;
  cost: number;
}

export interface DailyRow extends TokenCounts {
  day: string;
  turns: number;
  cost: number;
}

export interface HourlyRow {
  hour: number;
  turns: number;
  output: number;
  avgTurns: number;
  avgOutput: number;
}

export interface ModelRow extends TokenCounts {
  model: string;
  turns: number;
  cost: number;
  priced: boolean;
}

export interface ProjectRow extends TokenCounts {
  project: string;
  sessions: number;
  turns: number;
  cost: number;
}

export interface BranchRow extends ProjectRow {
  branch: string;
}

export interface SessionRow extends TokenCounts {
  sessionId: string;
  project: string;
  branch: string;
  topic: string;
  first: string;
  last: string;
  durationMin: number;
  model: string;
  turns: number;
  cost: number;
}

export interface SubagentRow extends TokenCounts {
  agentType: string;
  dispatches: number;
  turns: number;
  cost: number;
}

export interface DispatchRow extends TokenCounts {
  agentId: string;
  agentType: string;
  model: string;
  started: string;
  turns: number;
  toolUses: number;
  durationMs: number;
  status: string;
  cost: number;
}

export interface ClaudeUsageData {
  generatedAt: string;
  from: string;
  to: string;
  models: ModelOption[];
  totals: UsageTotals;
  daily: DailyRow[];
  hourly: HourlyRow[];
  byModel: ModelRow[];
  projects: ProjectRow[];
  branches: BranchRow[];
  sessions: SessionRow[];
  sessionsTotal: number;
  subagents: SubagentRow[];
  dispatches: DispatchRow[];
}

export interface ClaudeUsageQuery {
  from?: string;
  to?: string;
  models?: string[];
}

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const num = (value: unknown): number => {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : 0;
};

const str = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';

const records = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isRecord) : []);

const tokens = (record: Json): TokenCounts => ({
  input: num(record.input),
  output: num(record.output),
  cacheRead: num(record['cache-read']),
  cacheWrite: num(record['cache-write']),
});

export const normalizeStatus = (input: unknown): ClaudeUsageStatus => {
  const record = isRecord(input) ? input : {};
  return {
    scanning: record.scanning === true,
    filesTotal: num(record['files-total']),
    filesDone: num(record['files-done']),
    bytesTotal: num(record['bytes-total']),
    bytesDone: num(record['bytes-done']),
    lastScanAt: str(record['last-scan-at']),
    lastError: str(record['last-error']),
    turns: num(record.turns),
    sessions: num(record.sessions),
    sources: Array.isArray(record.sources)
      ? record.sources.filter((item): item is string => typeof item === 'string' && item !== '')
      : [],
    dbPath: str(record['db-path']),
  };
};

/** Always 24 rows, one per local hour, whatever the backend sent. */
const normalizeHourly = (value: unknown): HourlyRow[] => {
  const byHour = new Map<number, HourlyRow>();
  for (const row of records(value)) {
    const hour = num(row.hour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    byHour.set(hour, {
      hour,
      turns: num(row.turns),
      output: num(row.output),
      avgTurns: num(row['avg-turns']),
      avgOutput: num(row['avg-output']),
    });
  }
  return Array.from(
    { length: 24 },
    (_, hour) => byHour.get(hour) ?? { hour, turns: 0, output: 0, avgTurns: 0, avgOutput: 0 }
  );
};

export const normalizeData = (input: unknown): ClaudeUsageData => {
  const record = isRecord(input) ? input : {};
  const totals = isRecord(record.totals) ? record.totals : {};
  const sessions = records(record.sessions).map((row) => ({
    sessionId: str(row['session-id']),
    project: str(row.project),
    branch: str(row.branch),
    topic: str(row.topic),
    first: str(row.first),
    last: str(row.last),
    durationMin: num(row['duration-min']),
    model: str(row.model),
    turns: num(row.turns),
    ...tokens(row),
    cost: num(row.cost),
  }));

  return {
    generatedAt: str(record['generated-at']),
    from: str(record.from),
    to: str(record.to),
    models: records(record.models)
      .map((row) => ({
        model: str(row.model),
        turns: num(row.turns),
        tokens: num(row.tokens),
        priced: row.priced !== false,
      }))
      .filter((row) => row.model !== ''),
    totals: {
      sessions: num(totals.sessions),
      turns: num(totals.turns),
      ...tokens(totals),
      subagentTokens: num(totals['subagent-tokens']),
      cost: num(totals.cost),
    },
    daily: records(record.daily)
      .map((row) => ({
        day: str(row.day),
        turns: num(row.turns),
        ...tokens(row),
        cost: num(row.cost),
      }))
      .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.day)),
    hourly: normalizeHourly(record.hourly),
    byModel: records(record['by-model']).map((row) => ({
      model: str(row.model),
      turns: num(row.turns),
      ...tokens(row),
      cost: num(row.cost),
      priced: row.priced !== false,
    })),
    projects: records(record.projects).map((row) => ({
      project: str(row.project),
      sessions: num(row.sessions),
      turns: num(row.turns),
      ...tokens(row),
      cost: num(row.cost),
    })),
    branches: records(record.branches).map((row) => ({
      project: str(row.project),
      branch: str(row.branch),
      sessions: num(row.sessions),
      turns: num(row.turns),
      ...tokens(row),
      cost: num(row.cost),
    })),
    sessions,
    sessionsTotal: Math.max(num(record['sessions-total']), sessions.length),
    subagents: records(record.subagents).map((row) => ({
      agentType: str(row['agent-type']),
      dispatches: num(row.dispatches),
      turns: num(row.turns),
      ...tokens(row),
      cost: num(row.cost),
    })),
    dispatches: records(record.dispatches).map((row) => ({
      agentId: str(row['agent-id']),
      agentType: str(row['agent-type']),
      model: str(row.model),
      started: str(row.started),
      turns: num(row.turns),
      toolUses: num(row['tool-uses']),
      durationMs: num(row['duration-ms']),
      status: str(row.status),
      ...tokens(row),
      cost: num(row.cost),
    })),
  };
};

/** Builds the query string for `/app/claude-usage/data`; empty parts are left out. */
export const buildDataQuery = ({ from, to, models }: ClaudeUsageQuery): string => {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const list = (models ?? []).filter(Boolean);
  if (list.length > 0) params.set('models', list.join(','));
  const query = params.toString();
  return query ? `?${query}` : '';
};

async function requestJSON(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, init);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === 'string' ? body.error : '';
    throw new Error(message || `Request failed (${response.status})`);
  }
  return body;
}

export const claudeUsageApi = {
  async status(): Promise<ClaudeUsageStatus> {
    return normalizeStatus(await requestJSON('/app/claude-usage/status'));
  },

  async scan(): Promise<ClaudeUsageStatus> {
    return normalizeStatus(await requestJSON('/app/claude-usage/scan', { method: 'POST' }));
  },

  async data(query: ClaudeUsageQuery): Promise<ClaudeUsageData> {
    return normalizeData(await requestJSON(`/app/claude-usage/data${buildDataQuery(query)}`));
  },
};
