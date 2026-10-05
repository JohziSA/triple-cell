import { memo, useEffect, useRef, useState } from "react";
import type { Build } from "@/lib/engine/dyno";
import type { Session } from "@/lib/engine/session";

export const EngineStage = memo(function EngineStage({ session, build }: { session: Session; build: Build }) {
  const host = useRef<HTMLDivElement>(null);
  const buildRef = useRef(build);
  buildRef.current = build;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let dispose = () => {};
    let cancel = false;
    void import("./engine-3d-scene")
      .then((mod) => {
        if (cancel || !host.current) return;
        dispose = mod.mountEngine(host.current, session, () => buildRef.current);
      })
      .catch(() => {
        if (!cancel) setFailed(true);
      });
    return () => {
      cancel = true;
      dispose();
    };
  }, [session]);

  return (
    <section className="rounded-md border border-line bg-surface p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-3xl tracking-wide text-fg">In the round</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Same crank as the cutaway. Drag to orbit, scroll to zoom, double-click to reset the camera.
          </p>
        </div>
        <p className="text-sm text-muted">
          {build.boreMm.toFixed(1)} × {build.strokeMm.toFixed(1)} mm
          {build.turbo ? " · turbo" : ""}
        </p>
      </div>
      <div ref={host} className="relative mt-3 h-80 overflow-hidden rounded-md border border-line bg-bg sm:h-[28rem]">
        {failed ? (
          <p className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-muted">
            This browser could not start the 3D view.
          </p>
        ) : null}
      </div>
    </section>
  );
});
