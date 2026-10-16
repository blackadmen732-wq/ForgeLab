import type { NewWorkOrder, WorkOrder, WorkStatus } from "@forgelab/protocol";

export interface WorkOrderPort {
  list(projectId: string): Promise<readonly WorkOrder[]>;
  create(projectId: string, draft: NewWorkOrder): Promise<WorkOrder>;
  transition(order: WorkOrder, status: WorkStatus): Promise<WorkOrder>;
  subscribe(projectId: string, changed: () => void): Promise<() => void>;
}
export interface WorkOrderState {
  readonly orders: readonly WorkOrder[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly notice: WorkOrder | null;
}

/** Project-scoped durable work cache; events only invalidate it. Never changes focus. */
export class WorkOrderStore {
  private state: WorkOrderState = { orders: [], loading: true, error: null, notice: null };
  private readonly listeners = new Set<() => void>();
  private cleanup: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private generation = 0;
  private inFlight: Promise<void> | null = null;
  private dirty = false;
  private initialized = false;
  constructor(
    readonly projectId: string,
    readonly userId: string,
    private readonly port: WorkOrderPort,
  ) {}
  getState = (): WorkOrderState => this.state;
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  async start(): Promise<void> {
    this.stop();
    const generation = this.generation;
    try {
      const cleanup = await this.port.subscribe(this.projectId, () => {
        void this.refresh();
      });
      if (generation !== this.generation) {
        cleanup();
        return;
      }
      this.cleanup = cleanup;
    } catch {
      /* Durable reads still work without Realtime. */
    }
    if (generation !== this.generation) return;
    // Recovery when broadcasts are unavailable/missed; never queried from a render frame.
    this.timer = setInterval(() => {
      void this.refresh();
    }, 30_000);
    await this.refresh();
  }
  stop(): void {
    this.generation += 1;
    this.cleanup?.();
    this.cleanup = null;
    clearInterval(this.timer);
    this.inFlight = null;
    this.dirty = false;
  }
  refresh = (): Promise<void> => {
    if (this.inFlight !== null) {
      this.dirty = true;
      return this.inFlight;
    }
    const generation = this.generation;
    const run = async () => {
      do {
        this.dirty = false;
        try {
          const orders = await this.port.list(this.projectId);
          if (generation !== this.generation) return;
          const old = new Map(this.state.orders.map((w) => [w.id, w]));
          const notice = orders.find(
            (w) =>
              w.assignedTo === this.userId &&
              w.status === "offered" &&
              (!old.has(w.id) || old.get(w.id)!.status !== "offered"),
          );
          this.set({
            orders,
            loading: false,
            error: null,
            notice: notice ?? (this.initialized ? this.currentNotice(orders) : null),
          });
          this.initialized = true;
        } catch (error) {
          if (generation === this.generation) this.set({ loading: false, error: errorText(error) });
        }
      } while (this.dirty && generation === this.generation);
    };
    const request = run().finally(() => {
      if (generation === this.generation) this.inFlight = null;
    });
    this.inFlight = request;
    return request;
  };
  async create(draft: NewWorkOrder): Promise<WorkOrder> {
    const generation = this.generation;
    const order = await this.port.create(this.projectId, draft);
    if (generation === this.generation) await this.refresh();
    return order;
  }
  async transition(order: WorkOrder, status: WorkStatus): Promise<void> {
    const generation = this.generation;
    try {
      await this.port.transition(order, status);
    } finally {
      if (generation === this.generation) await this.refresh();
    }
  }
  dismissNotice = (): void => this.set({ notice: null });
  private currentNotice(orders: readonly WorkOrder[]): WorkOrder | null {
    return orders.find((w) => w.id === this.state.notice?.id && w.status === "offered") ?? null;
  }
  private set(patch: Partial<WorkOrderState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }
}
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
