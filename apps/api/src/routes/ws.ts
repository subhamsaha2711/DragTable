import type { FastifyPluginAsync } from "fastify";
import { getControlStore } from "@dragtable/db-control";
import { realtimeHub } from "@dragtable/realtime";
import { SESSION_COOKIE } from "../lib/session.js";

/**
 * WebSocket: /ws/databases/:databaseId
 * Auth via session cookie; only members of the DB's team may subscribe.
 */
const wsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/ws/databases/:databaseId",
    { websocket: true },
    async (socket, req) => {
      const { databaseId } = req.params as { databaseId: string };
      const token = req.cookies?.[SESSION_COOKIE];
      if (!token) {
        socket.send(JSON.stringify({ type: "ERROR", code: "AUTH_EXPIRED", message: "Authentication required" }));
        socket.close();
        return;
      }
      const store = getControlStore();
      const session = await store.resolveSession(token);
      if (!session) {
        socket.send(JSON.stringify({ type: "ERROR", code: "AUTH_EXPIRED", message: "Session invalid" }));
        socket.close();
        return;
      }
      const database = await store.getDatabase({ userId: session.user.id, databaseId });
      if (!database) {
        socket.send(JSON.stringify({ type: "ERROR", code: "FORBIDDEN", message: "No access" }));
        socket.close();
        return;
      }

      const unsub = realtimeHub.subscribe(databaseId, (event) => {
        try {
          socket.send(JSON.stringify({ type: "EVENT", event }));
        } catch {
          /* closed */
        }
      });

      socket.send(
        JSON.stringify({
          type: "SUBSCRIBED",
          databaseId,
          userId: session.user.id,
          liveViewers: realtimeHub.subscriberCount(databaseId),
        })
      );

      // notify others of presence (lightweight)
      realtimeHub.publish(databaseId, {
        type: "PRESENCE_JOIN",
        actorUserId: session.user.id,
        actorUsername: session.user.username,
        payload: { liveViewers: realtimeHub.subscriberCount(databaseId) },
      });

      socket.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
        try {
          const msg = JSON.parse(String(raw));
          if (msg?.type === "PING") {
            socket.send(JSON.stringify({ type: "PONG", t: Date.now() }));
          }
        } catch {
          /* ignore */
        }
      });

      socket.on("close", () => {
        unsub();
        realtimeHub.publish(databaseId, {
          type: "PRESENCE_LEAVE",
          actorUserId: session.user.id,
          actorUsername: session.user.username,
          payload: { liveViewers: realtimeHub.subscriberCount(databaseId) },
        });
      });
    }
  );
};

export default wsRoutes;
