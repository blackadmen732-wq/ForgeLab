/**
 * The realtime transport a project session runs over. The web app adapts Supabase
 * Realtime to this interface (a private channel authorised by RLS); tests use the
 * in-memory hub below. Nothing received through a transport is trusted: every payload
 * is a signed envelope that the session verifies.
 */
export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export interface ChannelHandlers {
  /** The complete current set of presence payloads on the topic (including this client's). */
  presence(payloads: readonly unknown[]): void;
  /** One broadcast payload from another client. */
  broadcast(payload: unknown): void;
  status(status: ConnectionStatus): void;
}

export interface ProjectChannel {
  /** Replaces this client's presence payload. */
  track(payload: unknown): Promise<void>;
  untrack(): Promise<void>;
  broadcast(payload: unknown): Promise<void>;
  close(): Promise<void>;
}

export interface RealtimeTransport {
  open(topic: string, handlers: ChannelHandlers): ProjectChannel;
}

/* ---------------------------------------------------------------------------------- */

interface MemoryClient {
  readonly topic: string;
  readonly handlers: ChannelHandlers;
  payload: unknown;
  tracked: boolean;
  connected: boolean;
}

/**
 * An in-process realtime hub with the same delivery semantics the session relies on:
 * presence is a full-state sync to every client on the topic, broadcasts go to everyone
 * but the sender, and a dropped client's presence disappears.
 */
export function createMemoryRealtime() {
  const clients = new Set<MemoryClient>();

  const syncTopic = (topic: string) => {
    const peers = [...clients].filter((c) => c.topic === topic && c.connected);
    const payloads = peers.filter((c) => c.tracked).map((c) => c.payload);
    for (const peer of peers) peer.handlers.presence(payloads);
  };

  const transport: RealtimeTransport = {
    open(topic, handlers) {
      const client: MemoryClient = {
        topic,
        handlers,
        payload: null,
        tracked: false,
        connected: true,
      };
      clients.add(client);
      queueMicrotask(() => {
        handlers.status("connected");
        syncTopic(topic);
      });
      return {
        async track(payload) {
          client.payload = structuredClone(payload);
          client.tracked = true;
          syncTopic(topic);
        },
        async untrack() {
          client.tracked = false;
          syncTopic(topic);
        },
        async broadcast(payload) {
          for (const peer of clients) {
            if (peer !== client && peer.topic === topic && peer.connected)
              peer.handlers.broadcast(structuredClone(payload));
          }
        },
        async close() {
          clients.delete(client);
          syncTopic(topic);
        },
      };
    },
  };

  return {
    transport,
    /** Simulates a dropped socket: the client's presence vanishes for everyone else. */
    drop(topic: string) {
      for (const client of clients) {
        if (client.topic !== topic || !client.connected) continue;
        client.connected = false;
        client.handlers.status("disconnected");
        syncTopic(topic);
        return;
      }
    },
    /** Injects a raw presence payload, as a hostile member could. */
    inject(topic: string, payload: unknown) {
      const handlers: ChannelHandlers = {
        presence: () => undefined,
        broadcast: () => undefined,
        status: () => undefined,
      };
      clients.add({ topic, handlers, payload, tracked: true, connected: true });
      syncTopic(topic);
    },
    /** Delivers a raw broadcast to every client on the topic. */
    injectBroadcast(topic: string, payload: unknown) {
      for (const c of clients)
        if (c.topic === topic && c.connected) c.handlers.broadcast(structuredClone(payload));
    },
    get size() {
      return clients.size;
    },
  };
}
