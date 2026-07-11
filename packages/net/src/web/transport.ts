import type { ClientTransport } from "../client.js";

/** The one-liner real transport — a browser WebSocket wrapped as ClientTransport. */
export function webSocketTransport(url: string): ClientTransport {
  const ws = new WebSocket(url);
  let messageHandler: ((raw: string) => void) | undefined;
  let closeHandler: ((info?: { code?: string; message?: string }) => void) | undefined;
  const sendQueue: string[] = [];

  ws.addEventListener("open", () => {
    for (const raw of sendQueue.splice(0)) ws.send(raw);
  });
  ws.addEventListener("message", (event: MessageEvent) => {
    messageHandler?.(String(event.data));
  });
  ws.addEventListener("close", () => {
    closeHandler?.();
  });
  ws.addEventListener("error", () => {
    // Surfaced to the app via the eventual close event; WebSocket's "error"
    // carries no useful detail (browser security model), so it is not
    // separately reported here.
  });

  return {
    send(raw: string): void {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(raw);
      } else {
        sendQueue.push(raw);
      }
    },
    onMessage(handler: (raw: string) => void): void {
      messageHandler = handler;
    },
    onClose(handler: (info?: { code?: string; message?: string }) => void): void {
      closeHandler = handler;
    },
    close(): void {
      ws.close();
    },
  };
}
