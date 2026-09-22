export interface RealtimeEvent {
  eventId: string;
  type: string;
  databaseId: string;
  tableId?: string;
  actorUserId: string;
  actorUsername?: string;
  serverTimestamp: string;
  payload: Record<string, unknown>;
}

type Sink = (event: RealtimeEvent) => void;

const channels = new Map<string, Set<Sink>>();

function eventId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const realtimeHub = {
  subscribe(databaseId: string, sink: Sink): () => void {
    const ch = `database:${databaseId}`;
    let set = channels.get(ch);
    if (!set) {
      set = new Set();
      channels.set(ch, set);
    }
    set.add(sink);
    return () => {
      set!.delete(sink);
      if (set!.size === 0) channels.delete(ch);
    };
  },

  publish(
    databaseId: string,
    partial: {
      type: string;
      tableId?: string;
      actorUserId: string;
      actorUsername?: string;
      payload?: Record<string, unknown>;
    }
  ): RealtimeEvent {
    const event: RealtimeEvent = {
      eventId: eventId(),
      type: partial.type,
      databaseId,
      tableId: partial.tableId,
      actorUserId: partial.actorUserId,
      actorUsername: partial.actorUsername,
      serverTimestamp: new Date().toISOString(),
      payload: partial.payload ?? {},
    };
    const set = channels.get(`database:${databaseId}`);
    if (set) {
      for (const sink of set) {
        try {
          sink(event);
        } catch {
        }
      }
    }
    return event;
  },

  subscriberCount(databaseId: string): number {
    return channels.get(`database:${databaseId}`)?.size ?? 0;
  },
};
