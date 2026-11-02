import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { fresh, startTimer } from "../src/domain";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), query: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: mock.rpc,
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: mock.query }) }),
    }),
  }),
}));
const memory = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => memory.set(k, v),
  removeItem: (k: string) => memory.delete(k),
});
vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
const { Store } = await import("../src/storage");
beforeEach(() => {
  memory.clear();
  vi.useFakeTimers();
  mock.rpc.mockReset();
  mock.query.mockReset();
});
afterEach(() => vi.useRealTimers());
describe("durable offline queue and conflict handling", () => {
  it("persists offline edits across reload, retries same id after response loss", async () => {
    const s = new Store("a", true);
    s.update((w) => ({
      ...w,
      tasks: [{ id: "task", title: "Offline note", repeat: "none" }],
    }));
    const id = s.cache.pending!.id;
    mock.rpc.mockResolvedValue({ error: { message: "offline" } });
    await s.sync();
    expect(s.cache.pending?.id).toBe(id);
    const recovered = new Store("a", true);
    expect(recovered.workspace.tasks[0].title).toBe("Offline note");
    mock.rpc.mockResolvedValue({
      data: { version: 1, document: recovered.workspace, conflict: false },
    });
    await recovered.sync();
    expect(mock.rpc.mock.calls.at(-1)![1].operation_id).toBe(id);
    expect(recovered.cache.pending).toBeUndefined();
    expect(recovered.cache.version).toBe(1);
  });
  it("keeps conflicting local state and requires explicit resolution", async () => {
    const s = new Store("a", true);
    s.update((w) => ({
      ...w,
      tasks: [{ id: "a", title: "Local", repeat: "none" }],
    }));
    const cloud = fresh();
    mock.rpc.mockResolvedValue({
      data: { conflict: true, version: 2, document: cloud },
    });
    await s.sync();
    expect(s.workspace.tasks).toHaveLength(1);
    expect(s.conflict?.version).toBe(2);
    expect(() => s.update((w) => w)).toThrow();
    s.resolve("cloud");
    expect(s.workspace).toEqual(cloud);
    expect(s.cache.pending).toBeUndefined();
  });
  it("rebase additional edits made during in-flight commit, without dropping them", async () => {
    const s = new Store("a", true);
    s.update((w) => ({
      ...w,
      tasks: [{ id: "a", title: "first", repeat: "none" }],
    }));
    let release!: (r: unknown) => void;
    const doc = structuredClone(s.workspace);
    mock.rpc.mockImplementation(() => new Promise((r) => (release = r)));
    const request = s.sync();
    s.update((w) => ({
      ...w,
      tasks: [...w.tasks, { id: "b", title: "second", repeat: "none" }],
    }));
    release({ data: { conflict: false, version: 1, document: doc } });
    await request;
    expect(s.workspace.tasks).toHaveLength(2);
    expect(s.cache.pending?.base).toBe(1);
  });
  it("poll cannot overwrite an edit made while the read was pending", async () => {
    const s = new Store("a", true);
    let release!: (r: unknown) => void;
    mock.query.mockImplementation(() => new Promise((r) => (release = r)));
    const request = s.sync();
    s.update((w) => ({
      ...w,
      tasks: [{ id: "a", title: "keep me", repeat: "none" }],
    }));
    release({ data: { version: 99, document: fresh() } });
    await request;
    expect(s.workspace.tasks[0].title).toBe("keep me");
    expect(s.cache.pending).toBeDefined();
  });
  it("user caches isolated and local two-tab start rechecks shared durable state", () => {
    const a = new Store("a", false),
      b = new Store("b", false);
    a.update((w) => ({
      ...w,
      tasks: [{ id: "a", title: "private", repeat: "none" }],
    }));
    expect(b.workspace.tasks).toHaveLength(0);
    const tab = new Store("a", false);
    a.update((w) => startTimer(w, w.subjects[0].id));
    expect(() => tab.update((w) => startTimer(w, w.subjects[0].id))).toThrow(
      "已有活动计时器",
    );
    expect(new Store("a", false).workspace.timer).not.toBeNull();
  });
  it("storage write failure does not report unsaved mutation as saved", () => {
    const s = new Store("a", false),
      old = s.workspace;
    const spy = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() =>
      s.update((w) => ({
        ...w,
        tasks: [{ id: "x", title: "x", repeat: "none" }],
      })),
    ).toThrow("quota");
    expect(s.workspace).toBe(old);
    spy.mockRestore();
  });
});
