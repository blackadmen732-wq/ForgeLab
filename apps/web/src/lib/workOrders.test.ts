import { afterEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => {
  const channel = { on: vi.fn(), subscribe: vi.fn() };
  return {
    channel,
    db: {
      channel: vi.fn(() => channel),
      realtime: { setAuth: vi.fn(async () => {}) },
      removeChannel: vi.fn(async () => {}),
    },
  };
});
vi.mock("./supabase.js", () => ({ requireSupabase: async () => fake.db }));
import { subscribeWorkOrders } from "./workOrders.js";
afterEach(() => vi.clearAllMocks());
describe("database work invalidations", () => {
  it("uses a private project-scoped channel, ignores foreign payloads and re-reads on reconnect", async () => {
    const changed = vi.fn();
    const close = await subscribeWorkOrders("project-a", changed);
    expect(fake.db.channel).toHaveBeenCalledWith("work:project-a", { config: { private: true } });
    const incoming = fake.channel.on.mock.calls[0]![2] as (event: { payload: unknown }) => void;
    incoming({ payload: { project_id: "project-b", status: "completed" } });
    expect(changed).not.toHaveBeenCalled();
    incoming({ payload: { project_id: "project-a", status: "completed" } });
    expect(changed).toHaveBeenCalledOnce();
    const status = fake.channel.subscribe.mock.calls[0]![0] as (status: string) => void;
    status("CHANNEL_ERROR");
    status("SUBSCRIBED");
    status("SUBSCRIBED");
    expect(changed).toHaveBeenCalledTimes(3);
    close();
    expect(fake.db.removeChannel).toHaveBeenCalledWith(fake.channel);
  });
  it("removes a half-open channel when authentication fails", async () => {
    fake.db.realtime.setAuth.mockRejectedValueOnce(new Error("Offline"));
    await expect(subscribeWorkOrders("project-a", vi.fn())).rejects.toThrow("Offline");
    expect(fake.db.removeChannel).toHaveBeenCalledWith(fake.channel);
  });
});
