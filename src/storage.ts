import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fresh, uid, validate, type Workspace } from "./domain";
const env = import.meta.env;
export const configured = !!(
  env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY
);
export const supabase: SupabaseClient | null = configured
  ? createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
export type Pending = { id: string; document: Workspace; base: number };
export type Cache = { version: number; document: Workspace; pending?: Pending };
export type Conflict = { version: number; document: Workspace };
export class Store {
  key: string;
  cache: Cache;
  conflict: Conflict | null = null;
  busy = false;
  status = "本机保存";
  onchange = () => {};
  cloud: boolean;
  initialised = false;
  disposed = false;
  lockRequested = false;
  dispose() {
    this.disposed = true;
    clearTimeout(this.syncTimer);
    this.onchange = () => {};
  }
  refresh() {
    const raw = localStorage.getItem(this.key);
    if (raw) {
      const next = JSON.parse(raw) as Cache;
      validate(next.document);
      this.cache = next;
    }
  }
  syncTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    public userId: string,
    cloud: boolean,
  ) {
    this.key = "study-tracker:v1:" + userId;
    this.cloud = cloud;
    const raw = localStorage.getItem(this.key);
    if (raw) {
      this.cache = JSON.parse(raw);
      validate(this.cache.document);
      if (this.cache.pending) validate(this.cache.pending.document);
    } else this.cache = { version: 0, document: fresh() };
    this.status = cloud ? "连接云端中" : "仅保存在此浏览器";
  }
  get workspace() {
    return this.cache.document;
  }
  persist(next: Cache) {
    localStorage.setItem(this.key, JSON.stringify(next));
    this.cache = next;
    this.onchange();
  }
  update(fn: (w: Workspace) => Workspace) {
    const latest = localStorage.getItem(this.key);
    if (latest) {
      const parsed = JSON.parse(latest) as Cache;
      validate(parsed.document);
      if (
        parsed.version !== this.cache.version ||
        parsed.pending?.id !== this.cache.pending?.id
      )
        this.cache = parsed;
    }
    if (this.disposed) throw Error("工作区已退出，请重新登录");
    if (this.conflict) throw Error("请先处理同步冲突");
    const doc = fn(structuredClone(this.workspace));
    validate(doc);
    const next = {
      ...this.cache,
      version: this.cloud ? this.cache.version : this.cache.version + 1,
      document: doc,
      ...(this.cloud
        ? { pending: { id: uid(), document: doc, base: this.cache.version } }
        : {}),
    };
    this.persist(next);
    this.status = this.cloud ? "待同步（已存本机）" : "仅保存在此浏览器";
    this.onchange();
    if (this.cloud) {
      clearTimeout(this.syncTimer);
      this.syncTimer = setTimeout(() => void this.sync(), 600);
    }
  }
  async sync() {
    if (this.disposed || this.lockRequested) return;
    this.lockRequested = true;
    try {
      if (typeof navigator !== "undefined" && navigator.locks)
        await navigator.locks.request("study-sync:" + this.userId, () =>
          this.performSync(),
        );
      else await this.performSync();
    } finally {
      this.lockRequested = false;
    }
  }
  async performSync() {
    if (this.disposed || !this.cloud || !supabase || this.busy || this.conflict)
      return;
    this.refresh();
    this.busy = true;
    try {
      const pending = this.cache.pending;
      if (pending) {
        const { data, error } = await supabase.rpc("commit_study_workspace", {
          expected_version: pending.base,
          operation_id: pending.id,
          next_document: pending.document,
        });
        if (this.disposed) return;
        this.refresh();
        if (error) throw error;
        validate(data.document);
        if (data.conflict) {
          this.conflict = { version: data.version, document: data.document };
          this.status = "同步冲突 · 本机数据已保留";
          this.onchange();
          return;
        }
        const newer =
          !!this.cache.pending && this.cache.pending.id !== pending.id;
        this.persist(
          newer
            ? {
                version: data.version,
                document: this.workspace,
                pending: {
                  id: this.cache.pending!.id,
                  document: this.workspace,
                  base: data.version,
                },
              }
            : { version: data.version, document: data.document },
        );
      } else {
        const { data, error } = await supabase
          .from("study_workspaces")
          .select("version,document")
          .eq("user_id", this.userId)
          .maybeSingle();
        if (this.disposed) return;
        this.refresh();
        if (error) throw error;
        // Recheck pending after await: never overwrite an edit made while a poll was in flight.
        if (this.cache.pending) return;
        if (data) {
          validate(data.document);
          this.persist({ version: data.version, document: data.document });
        } else
          this.persist({
            ...this.cache,
            pending: { id: uid(), base: 0, document: this.workspace },
          });
      }
      this.initialised = true;
      this.status = this.cache.pending ? "待同步（已存本机）" : "已同步";
    } catch (e) {
      this.status =
        "未同步 · " +
        (e instanceof Error
          ? e.message
          : String((e as { message?: string }).message || e));
    } finally {
      this.busy = false;
      this.onchange();
    }
  }
  resolve(choice: "cloud" | "local") {
    if (!this.conflict) return;
    const c = this.conflict;
    this.conflict = null;
    if (choice === "cloud")
      this.persist({ version: c.version, document: c.document });
    else
      this.persist({
        version: c.version,
        document: this.workspace,
        pending: { id: uid(), base: c.version, document: this.workspace },
      });
    this.status = "待同步";
    this.onchange();
    void this.sync();
  }
}
export function download(
  name: string,
  body: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function backup(w: Workspace) {
  download(
    "study-backup-" + new Date().toISOString().slice(0, 10) + ".json",
    JSON.stringify(
      {
        format: "study-tracker-backup",
        exportedAt: new Date().toISOString(),
        workspace: w,
      },
      null,
      2,
    ),
  );
}
