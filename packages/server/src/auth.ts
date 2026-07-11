import { createHmac, timingSafeEqual } from "node:crypto";

/** "Boring, standard, pluggable" (docs/DESIGN.md) — one async method. */
export interface AuthProvider {
  authenticate(token: string): Promise<{ playerId: string } | null>;
}

interface TicketPayload {
  playerId: string;
  exp: number; // epoch ms
}

function sign(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

/** Mints an HMAC-signed, expiring ticket (Node crypto — no new dependency). */
export function issueTicket(secret: string, playerId: string, opts: { ttlMs?: number } = {}): string {
  const exp = Date.now() + (opts.ttlMs ?? 60_000);
  const payload: TicketPayload = { playerId, exp };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(secret, body)}`;
}

export function ticketAuth(secret: string): AuthProvider {
  return {
    async authenticate(token: string): Promise<{ playerId: string } | null> {
      const dot = token.lastIndexOf(".");
      if (dot === -1) return null;
      const body = token.slice(0, dot);
      const sig = token.slice(dot + 1);

      const expectedSig = sign(secret, body);
      const sigBuf = Buffer.from(sig, "utf8");
      const expectedBuf = Buffer.from(expectedSig, "utf8");
      if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
        return null;
      }

      let payload: TicketPayload;
      try {
        payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TicketPayload;
      } catch {
        return null;
      }
      if (typeof payload.playerId !== "string" || typeof payload.exp !== "number") return null;
      if (Date.now() > payload.exp) return null;
      return { playerId: payload.playerId };
    },
  };
}

/** Accepts "dev:<name>". Explicit opt-in only — never a default — per
 *  CLAUDE.md's no-dev-in-prod convention; dev/demo/harness soak use. */
export function devAuth(): AuthProvider {
  return {
    async authenticate(token: string): Promise<{ playerId: string } | null> {
      if (!token.startsWith("dev:")) return null;
      const playerId = token.slice(4);
      return playerId ? { playerId } : null;
    },
  };
}
