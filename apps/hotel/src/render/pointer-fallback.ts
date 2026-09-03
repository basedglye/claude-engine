/**
 * Hover-look fallback for sandboxes that refuse `requestPointerLock()`
 * (e.g. an embedded iframe that throws `WrongDocumentError`, or any host
 * that silently never grants lock). Plain DOM only — no `three`,
 * `@claude-engine/*`, or `./sim/**` imports.
 *
 * On the canvas's first click we ask for real pointer lock. If it fails
 * (throws, rejects, `pointerlockerror` fires, or lock still isn't held a
 * couple of frames later) we fall back to synthesising look deltas from
 * cursor position relative to the canvas centre. The instant real lock is
 * observed, fallback mode is torn down permanently so the two paths never
 * both feed deltas.
 */

export interface PointerLockAdapter {
  /** Ask the browser for pointer lock. May throw or reject; the fallback
   *  must survive either. */
  requestLock(): void | Promise<void>;
  /** True when real pointer lock is currently held. */
  isLocked(): boolean;
  /** Feed a look delta in the same units a real mousemove would produce
   *  (movementX / movementY pixels). */
  onLook(dx: number, dy: number): void;
  /** Tell the controller whether it should treat itself as locked. */
  setLocked(locked: boolean): void;
}

// Dead zone in the middle of each axis (fraction of half-extent), then a
// linear ramp out to the capped rate at the edges.
const DEAD_ZONE = 0.3;
const MAX_RATE_PX_PER_FRAME = 12;

/** Installs a hover-look fallback on `canvas`. Returns a teardown fn. */
export function installHoverLookFallback(
  canvas: HTMLElement,
  adapter: PointerLockAdapter,
): () => void {
  let torndown = false;
  let realLockConfirmed = false;
  let fallbackActive = false;
  let rafHandle: number | null = null;
  let pendingDx = 0;
  let pendingDy = 0;
  let hasPending = false;
  let attemptToken = 0;

  function stopFallback(): void {
    if (!fallbackActive) return;
    fallbackActive = false;
    hasPending = false;
    if (rafHandle !== null) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
    adapter.setLocked(false);
  }

  function tick(): void {
    if (!fallbackActive || realLockConfirmed) {
      rafHandle = null;
      return;
    }
    if (hasPending) {
      adapter.onLook(pendingDx, pendingDy);
      pendingDx = 0;
      pendingDy = 0;
      hasPending = false;
    }
    rafHandle = requestAnimationFrame(tick);
  }

  function startFallback(): void {
    if (torndown || realLockConfirmed || fallbackActive) return;
    fallbackActive = true;
    adapter.setLocked(true);
    if (rafHandle === null) rafHandle = requestAnimationFrame(tick);
  }

  function confirmRealLock(): void {
    if (realLockConfirmed) return;
    realLockConfirmed = true;
    stopFallback();
  }

  function onMouseMove(ev: MouseEvent): void {
    if (adapter.isLocked()) {
      confirmRealLock();
      return;
    }
    if (!fallbackActive) return;
    ev.preventDefault();
    const rect = (canvas as HTMLElement).getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const halfW = rect.width / 2 || 1;
    const halfH = rect.height / 2 || 1;
    const nx = (ev.clientX - cx) / halfW; // -1..1
    const ny = (ev.clientY - cy) / halfH;
    pendingDx += rampAxis(nx) * MAX_RATE_PX_PER_FRAME;
    pendingDy += rampAxis(ny) * MAX_RATE_PX_PER_FRAME;
    hasPending = true;
  }

  function rampAxis(n: number): number {
    const mag = Math.abs(n);
    if (mag <= DEAD_ZONE) return 0;
    const t = Math.min(1, (mag - DEAD_ZONE) / (1 - DEAD_ZONE));
    return Math.sign(n) * t;
  }

  function onMouseLeave(): void {
    stopFallback();
  }

  function onPointerLockError(): void {
    startFallback();
  }

  function onPointerLockChange(): void {
    if (adapter.isLocked()) {
      confirmRealLock();
    }
  }

  function onClick(): void {
    if (torndown || realLockConfirmed) return;
    const token = ++attemptToken;
    let settled = false;
    const proceedToFallback = (): void => {
      if (settled || token !== attemptToken) return;
      settled = true;
      // Give real lock a couple of frames to land before deciding it failed.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (torndown || token !== attemptToken) return;
          if (!adapter.isLocked()) {
            startFallback();
          } else {
            confirmRealLock();
          }
        });
      });
    };
    try {
      const result = adapter.requestLock();
      if (result && typeof (result as Promise<void>).then === "function") {
        (result as Promise<void>).then(
          () => proceedToFallback(),
          () => proceedToFallback(),
        );
      } else {
        proceedToFallback();
      }
    } catch {
      proceedToFallback();
    }
  }

  canvas.addEventListener("click", onClick);
  canvas.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("mouseleave", onMouseLeave);
  document.addEventListener("pointerlockerror", onPointerLockError, false);
  document.addEventListener("pointerlockchange", onPointerLockChange, false);

  return function teardown(): void {
    torndown = true;
    stopFallback();
    canvas.removeEventListener("click", onClick);
    canvas.removeEventListener("mousemove", onMouseMove);
    canvas.removeEventListener("mouseleave", onMouseLeave);
    document.removeEventListener("pointerlockerror", onPointerLockError, false);
    document.removeEventListener("pointerlockchange", onPointerLockChange, false);
  };
}
