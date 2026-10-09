import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { chatTopic } from "@forgelab/protocol";
import type { ChannelHandlers, ProjectChannel, RealtimeTransport } from "@forgelab/multiplayer";

/**
 * Supabase Realtime as the project session's transport. Channels are *private*: Realtime
 * checks each subscriber against the RLS policies on realtime.messages (project members
 * only), and every payload is additionally signed, so the roster never trusts the socket.
 */
export function supabaseTransport(supabase: SupabaseClient): RealtimeTransport {
  return {
    open(topic: string, handlers: ChannelHandlers): ProjectChannel {
      let channel: RealtimeChannel | null = null;
      let closed = false;
      let attempt = 0;
      let retry: ReturnType<typeof setTimeout> | undefined;

      const connect = () => {
        const current = supabase.channel(topic, {
          config: { private: true, broadcast: { self: false } },
        });
        channel = current;
        current
          .on("presence", { event: "sync" }, () => {
            handlers.presence(Object.values(current.presenceState()).flat());
          })
          .on("broadcast", { event: "collab" }, ({ payload }) => handlers.broadcast(payload));
        handlers.status("connecting");
        // Private channels authorise with the user's JWT, not the publishable key.
        void supabase.realtime
          .setAuth()
          .catch(() => undefined)
          .then(() =>
            current.subscribe((state) => {
              if (closed || current !== channel) return;
              if (state === "SUBSCRIBED") {
                attempt = 0;
                handlers.status("connected");
                return;
              }
              handlers.status("disconnected");
              // The server can close a channel outright (for example over a rate limit);
              // realtime-js does not rejoin a closed channel, so start a fresh one.
              if (state === "CLOSED" || state === "CHANNEL_ERROR") reconnect(current);
            }),
          );
      };

      const reconnect = (stale: RealtimeChannel) => {
        if (retry !== undefined) return;
        const delay = Math.min(30_000, 1000 * 2 ** attempt);
        attempt += 1;
        retry = setTimeout(() => {
          retry = undefined;
          if (closed) return;
          channel = null;
          void supabase.removeChannel(stale);
          connect();
        }, delay);
      };

      connect();
      return {
        async track(payload) {
          await channel?.track(payload as Record<string, unknown>);
        },
        async untrack() {
          await channel?.untrack();
        },
        async broadcast(payload) {
          await channel?.send({ type: "broadcast", event: "collab", payload });
        },
        async close() {
          closed = true;
          clearTimeout(retry);
          if (channel !== null) await supabase.removeChannel(channel);
        },
      };
    },
  };
}

/**
 * New messages in one text channel, as the database delivers them after each insert
 * (see after_message_insert). Returns an unsubscribe function.
 */
export function subscribeChat(
  supabase: SupabaseClient,
  channelId: string,
  onRow: (row: unknown) => void,
  onStatus: (connected: boolean) => void,
): () => void {
  const channel = supabase.channel(chatTopic(channelId), { config: { private: true } });
  channel.on("broadcast", { event: "message" }, ({ payload }) => onRow(payload));
  void supabase.realtime
    .setAuth()
    .catch(() => undefined)
    .then(() => channel.subscribe((state) => onStatus(state === "SUBSCRIBED")));
  return () => void supabase.removeChannel(channel);
}
