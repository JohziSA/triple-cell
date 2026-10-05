import { memo, useEffect, useRef, type RefObject } from "react";
import type { Build } from "@/lib/engine/dyno";
import type { Session } from "@/lib/engine/session";

/** Even-fire inline-3. Pins are 120° apart; these offsets put each piston at TDC on its power stroke. */
const PIN = [0, 240, 120];
const FIRE = [0, 240, 480];
const ROD_RATIO = 3.4;
const PISTON_H = 28;
const CLEARANCE = 16;
const WRIST_TDC = 132;
const CX = [128, 292, 456];

const PHASE = ["Power", "Exhaust", "Intake", "Compression"] as const;

function mod(n: number, m: number) {
  return ((n % m) + m) % m;
}

function geometry(boreMm: number, strokeMm: number) {
  const bore = Math.min(100, Math.max(64, boreMm)) * 0.76;
  const stroke = Math.min(120, Math.max(68, strokeMm)) * 0.58;
  const radius = stroke / 2;
  const rod = radius * ROD_RATIO;
  const crankY = WRIST_TDC + radius + rod;
  const deck = WRIST_TDC - PISTON_H - CLEARANCE;
  return { bore, stroke, radius, rod, crankY, deck };
}

/** Slider-crank. θ = 0 is TDC. Wrist Y grows as the piston falls. */
export function pistonPose(angleDeg: number, offsetDeg: number, radius: number, rod: number, cx: number, crankY: number) {
  const theta = mod(angleDeg - offsetDeg, 360) * (Math.PI / 180);
  const pinX = cx + radius * Math.sin(theta);
  const pinY = crankY - radius * Math.cos(theta);
  const dx = pinX - cx;
  const reach = Math.sqrt(Math.max(1, rod * rod - dx * dx));
  const wristY = pinY - reach;
  return { theta, pinX, pinY, wristY, crownY: wristY - PISTON_H };
}

function pistonSpeed(strokeMm: number, rpm: number, theta: number) {
  const radiusM = strokeMm / 2000;
  const omega = (rpm * Math.PI) / 30;
  const ds = radiusM * (Math.sin(theta) + Math.sin(2 * theta) / (2 * ROD_RATIO));
  return ds * omega;
}

function valve(cycle: number, open: number, close: number) {
  if (cycle < open || cycle > close) return 0;
  const u = (cycle - open) / (close - open);
  return Math.sin(Math.PI * u);
}

export const EngineCutaway = memo(function EngineCutaway({ session, build }: { session: Session; build: Build }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const crankRef = useRef<HTMLSpanElement>(null);
  const fireRef = useRef<HTMLSpanElement>(null);
  const speedRef = useRef<HTMLSpanElement>(null);
  const spoolRef = useRef<HTMLSpanElement>(null);
  const buildRef = useRef(build);
  buildRef.current = build;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    let turbo = 0;
    let last = performance.now();
    let frame = 0;

    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const live = session.live;
      const running = session.getMode() !== "off";
      const angle = live.crank;
      const spec = buildRef.current;
      const g = geometry(spec.boreMm, spec.strokeMm);
      const spoolIn = 1200 + spec.inducerMm * 48;
      const spool = spec.turbo
        ? Math.max(0, Math.min(1, (live.rpm - spoolIn * 0.42) / spoolIn)) * Math.pow(Math.max(live.throttle, 0), 0.55)
        : 0;
      if (running) turbo = mod(turbo + (40 + spool * 2200) * dt, 360);
      paint(svg, angle, g, spec, live.throttle, live.combust, running, spool, turbo);

      let fire = "—";
      let speed = 0;
      let speedCyl = 0;
      for (let i = 0; i < 3; i++) {
        const cycle = mod(angle - FIRE[i], 720);
        const pose = pistonPose(angle, PIN[i], g.radius, g.rod, CX[i], g.crankY);
        const v = pistonSpeed(spec.strokeMm, live.rpm, pose.theta);
        if (running && cycle < 180 && (fire === "—" || cycle < mod(angle - FIRE[speedCyl], 720))) {
          fire = String(i + 1);
          speed = v;
          speedCyl = i;
        }
      }
      if (crankRef.current) crankRef.current.textContent = `${Math.round(angle)}°`;
      if (fireRef.current) fireRef.current.textContent = fire === "—" ? "—" : `Cyl ${fire}`;
      if (speedRef.current) {
        speedRef.current.textContent = running && live.rpm > 40 ? `${Math.abs(speed).toFixed(1)} m/s` : "0 m/s";
      }
      if (spoolRef.current) spoolRef.current.textContent = spec.turbo ? `${Math.round(spool * 100)}%` : "NA";
    };

    step(last);
    const loop = (now: number) => {
      step(now);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [session]);

  return (
    <section className="rounded-md border border-line bg-surface p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-3xl tracking-wide text-fg">Cutaway</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Slider-crank on a 120° crank. Firing order 1–2–3, power stroke every 240°. Bore and stroke change the
            piston travel.
          </p>
        </div>
        <p className="text-sm text-muted">
          {build.boreMm.toFixed(1)} × {build.strokeMm.toFixed(1)} mm · rod {ROD_RATIO.toFixed(1)} : 1
        </p>
      </div>

      <svg
        ref={svgRef}
        viewBox="0 0 780 400"
        className="mt-3 h-52 w-full sm:h-72"
        role="img"
        aria-label="Inline-3 piston and crank simulation"
      >
        <Crankcase />
        <line data-part="shaft" className="stroke-muted" strokeWidth="8" strokeLinecap="round" />
        {CX.map((cx, i) => (
          <g key={cx} data-cyl={i}>
            <rect data-part="jacket" className="fill-surface-2" />
            <rect data-part="liner" className="fill-bg" />
            <line data-part="wall-l" className="stroke-line" strokeWidth="3" />
            <line data-part="wall-r" className="stroke-line" strokeWidth="3" />
            <ellipse data-part="flame" className="fill-danger" />
            <line data-part="rod" className="stroke-muted" strokeWidth="5" strokeLinecap="round" />
            <g data-part="web">
              <ellipse data-part="weight" className="fill-surface-2 stroke-muted" strokeWidth="2" />
              <circle data-part="pin" r="6.5" className="fill-amber" />
            </g>
            <g data-part="piston">
              <rect data-part="skirt" className="fill-fg" rx="2" />
              <line data-part="ring" className="stroke-bg" strokeWidth="2" />
              <circle data-part="wrist" r="4" className="fill-surface stroke-muted" strokeWidth="1.5" />
            </g>
            <rect data-part="head" className="fill-surface-2 stroke-line" strokeWidth="1.5" />
            <line data-part="in-stem" className="stroke-fg" strokeWidth="2" />
            <line data-part="in-head" className="stroke-fg" strokeWidth="3" strokeLinecap="round" />
            <line data-part="ex-stem" className="stroke-muted" strokeWidth="2" />
            <line data-part="ex-head" className="stroke-muted" strokeWidth="3" strokeLinecap="round" />
            <line data-part="plug" className="stroke-amber" strokeWidth="2" />
            <circle data-part="ex-gas" r="5" className="fill-amber" />
            <text data-part="name" className="fill-muted font-display text-sm" textAnchor="middle">
              {i + 1}
            </text>
            <text data-part="phase" className="fill-fg font-display text-sm" textAnchor="middle" />
          </g>
        ))}
        <g data-part="plenum">
          <rect data-part="plenum-bar" className="fill-surface-2 stroke-line" strokeWidth="1.5" rx="6" />
          <circle data-part="throttle-body" r="11" className="fill-bg stroke-line" strokeWidth="2" />
          <line data-part="butterfly" className="stroke-amber" strokeWidth="2.5" strokeLinecap="round" />
        </g>
        <g data-part="end">
          <circle data-part="end-case" className="fill-bg stroke-line" strokeWidth="3" />
          <g data-part="end-crank">
            <circle r="10" className="fill-muted" />
            <line data-part="end-arm-0" className="stroke-muted" strokeWidth="4" strokeLinecap="round" />
            <line data-part="end-arm-1" className="stroke-muted" strokeWidth="4" strokeLinecap="round" />
            <line data-part="end-arm-2" className="stroke-muted" strokeWidth="4" strokeLinecap="round" />
            <circle data-part="end-pin-0" r="5" className="fill-amber" />
            <circle data-part="end-pin-1" r="5" className="fill-amber" />
            <circle data-part="end-pin-2" r="5" className="fill-amber" />
          </g>
          <text data-part="end-label" className="fill-muted font-display text-sm" textAnchor="middle">
            Crank end
          </text>
        </g>
        <g data-part="turbo">
          <circle data-part="turbo-house" className="fill-surface-2 stroke-line" strokeWidth="2" />
          <g data-part="turbo-wheel">
            <circle r="7" className="fill-muted" />
            <line x1="0" y1="-22" x2="0" y2="22" className="stroke-fg" strokeWidth="2" />
            <line x1="-22" y1="0" x2="22" y2="0" className="stroke-fg" strokeWidth="2" />
            <line x1="-16" y1="-16" x2="16" y2="16" className="stroke-muted" strokeWidth="2" />
            <line x1="16" y1="-16" x2="-16" y2="16" className="stroke-muted" strokeWidth="2" />
          </g>
          <text data-part="turbo-label" className="fill-muted font-display text-sm" textAnchor="middle">
            Compressor
          </text>
        </g>
      </svg>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Readout label="Crank" valueRef={crankRef} initial="0°" />
        <Readout label="On the power stroke" valueRef={fireRef} initial="—" />
        <Readout label="That piston" valueRef={speedRef} initial="0 m/s" />
        <Readout label="Compressor" valueRef={spoolRef} initial={build.turbo ? "0%" : "NA"} />
      </div>
    </section>
  );
});

function Readout({
  label,
  valueRef,
  initial,
}: {
  label: string;
  valueRef: RefObject<HTMLSpanElement | null>;
  initial: string;
}) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="font-display text-2xl leading-none text-amber">
        <span ref={valueRef}>{initial}</span>
      </p>
    </div>
  );
}

function Crankcase() {
  return <rect data-part="sump" className="fill-bg stroke-line" strokeWidth="1.5" rx="8" />;
}

function paint(
  svg: SVGSVGElement,
  angle: number,
  g: ReturnType<typeof geometry>,
  spec: Build,
  throttle: number,
  combust: number,
  running: boolean,
  spool: number,
  turboAng: number,
) {
  const q = (sel: string) => svg.querySelector(sel);
  const sump = q('[data-part="sump"]') as SVGRectElement | null;
  const bottom = Math.min(392, g.crankY + g.radius * 1.35 + 18);
  if (sump) {
    sump.setAttribute("x", "36");
    sump.setAttribute("y", String(g.deck - 36));
    sump.setAttribute("width", "500");
    sump.setAttribute("height", String(Math.max(40, bottom - (g.deck - 36))));
  }

  CX.forEach((cx, i) => {
    const root = svg.querySelector(`[data-cyl="${i}"]`);
    if (!root) return;
    const pose = pistonPose(angle, PIN[i], g.radius, g.rod, cx, g.crankY);
    const cycle = mod(angle - FIRE[i], 720);
    const half = g.bore / 2;
    const linerTop = g.deck;
    const linerBot = WRIST_TDC + g.stroke + 10;
    const set = (part: string, attrs: Record<string, string>) => {
      const el = root.querySelector(`[data-part="${part}"]`);
      if (!el) return;
      for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    };

    set("jacket", {
      x: String(cx - half - 10),
      y: String(g.deck - 34),
      width: String(g.bore + 20),
      height: String(linerBot - (g.deck - 34)),
      rx: "4",
    });
    set("liner", {
      x: String(cx - half),
      y: String(linerTop),
      width: String(g.bore),
      height: String(Math.max(8, linerBot - linerTop)),
    });
    set("wall-l", { x1: String(cx - half), y1: String(linerTop), x2: String(cx - half), y2: String(linerBot) });
    set("wall-r", { x1: String(cx + half), y1: String(linerTop), x2: String(cx + half), y2: String(linerBot) });

    const gap = Math.max(0, pose.crownY - g.deck);
    const flame = cycle < 100 && running && combust > 0.2 ? (1 - cycle / 100) * combust * (0.35 + 0.65 * throttle) : 0;
    set("flame", {
      cx: String(cx),
      cy: String(g.deck + Math.min(gap, 36) / 2),
      rx: String(half * 0.55),
      ry: String(Math.max(0.8, Math.min(gap, 36) / 2)),
      opacity: String(flame),
    });

    set("rod", {
      x1: pose.pinX.toFixed(2),
      y1: pose.pinY.toFixed(2),
      x2: String(cx),
      y2: pose.wristY.toFixed(2),
    });

    const web = root.querySelector('[data-part="web"]');
    web?.setAttribute("transform", `translate(${cx} ${g.crankY}) rotate(${pose.theta * (180 / Math.PI)})`);
    set("weight", { cx: "0", cy: (g.radius * 0.42).toFixed(2), rx: (g.radius * 0.48).toFixed(2), ry: (g.radius * 0.78).toFixed(2) });
    set("pin", { cx: "0", cy: (-g.radius).toFixed(2) });

    const piston = root.querySelector('[data-part="piston"]');
    piston?.setAttribute("transform", `translate(${cx} ${pose.crownY.toFixed(2)})`);
    set("skirt", { x: String(-half + 3), y: "0", width: String(g.bore - 6), height: String(PISTON_H) });
    set("ring", { x1: String(-half + 5), y1: "7", x2: String(half - 5), y2: "7" });
    set("wrist", { cx: "0", cy: String(PISTON_H) });

    set("head", {
      x: String(cx - half - 8),
      y: String(g.deck - 32),
      width: String(g.bore + 16),
      height: "32",
    });

    const inLift = valve(cycle, 350, 560);
    const exLift = valve(cycle, 130, 370);
    const inX = cx - half * 0.38;
    const exX = cx + half * 0.38;
    const inY = g.deck + inLift * 11;
    const exY = g.deck + exLift * 11;
    set("in-stem", { x1: String(inX), y1: String(g.deck - 26), x2: String(inX), y2: String(inY) });
    set("in-head", { x1: String(inX - 7), y1: String(inY), x2: String(inX + 7), y2: String(inY) });
    set("ex-stem", { x1: String(exX), y1: String(g.deck - 26), x2: String(exX), y2: String(exY) });
    set("ex-head", { x1: String(exX - 7), y1: String(exY), x2: String(exX + 7), y2: String(exY) });

    const spark = running && combust > 0.15 && cycle < 24 ? 1 : 0.2;
    set("plug", {
      x1: String(cx),
      y1: String(g.deck - 28),
      x2: String(cx),
      y2: String(g.deck - 2),
      opacity: String(spark),
    });
    set("ex-gas", {
      cx: String(cx + half + 14),
      cy: String(g.deck - 8),
      opacity: String(running ? exLift * 0.85 : 0),
    });

    const phase = root.querySelector('[data-part="phase"]');
    if (phase) {
      phase.setAttribute("x", String(cx));
      phase.setAttribute("y", String(Math.min(386, bottom + 16)));
      phase.textContent = running ? PHASE[cycle < 180 ? 0 : cycle < 360 ? 1 : cycle < 540 ? 2 : 3] : "Stopped";
    }
    const name = root.querySelector('[data-part="name"]');
    if (name) {
      name.setAttribute("x", String(cx));
      name.setAttribute("y", "22");
    }
  });

  const shaft = q('[data-part="shaft"]');
  shaft?.setAttribute("x1", String(CX[0]));
  shaft?.setAttribute("x2", String(CX[2]));
  shaft?.setAttribute("y1", g.crankY.toFixed(2));
  shaft?.setAttribute("y2", g.crankY.toFixed(2));

  const bar = q('[data-part="plenum-bar"]') as SVGRectElement | null;
  if (bar) {
    bar.setAttribute("x", "108");
    bar.setAttribute("y", String(g.deck - 52));
    bar.setAttribute("width", "400");
    bar.setAttribute("height", "16");
  }
  const plate = (1 - throttle) * 78;
  const butterfly = q('[data-part="butterfly"]');
  const by = g.deck - 44;
  const body = q('[data-part="throttle-body"]');
  body?.setAttribute("cx", "96");
  body?.setAttribute("cy", String(by));
  butterfly?.setAttribute("transform", `translate(96 ${by}) rotate(${plate.toFixed(1)})`);
  butterfly?.setAttribute("x1", "-9");
  butterfly?.setAttribute("y1", "0");
  butterfly?.setAttribute("x2", "9");
  butterfly?.setAttribute("y2", "0");

  const endR = 58;
  const endX = 662;
  const endY = 150;
  const endCase = q('[data-part="end-case"]');
  endCase?.setAttribute("cx", String(endX));
  endCase?.setAttribute("cy", String(endY));
  endCase?.setAttribute("r", String(endR));
  q('[data-part="end-crank"]')?.setAttribute("transform", `translate(${endX} ${endY}) rotate(${mod(angle, 360)})`);
  PIN.forEach((offset, i) => {
    const rad = (-offset * Math.PI) / 180;
    const arm = q(`[data-part="end-arm-${i}"]`);
    const pin = q(`[data-part="end-pin-${i}"]`);
    const px = Math.sin(rad) * (endR - 14);
    const py = -Math.cos(rad) * (endR - 14);
    arm?.setAttribute("x1", "0");
    arm?.setAttribute("y1", "0");
    arm?.setAttribute("x2", px.toFixed(2));
    arm?.setAttribute("y2", py.toFixed(2));
    pin?.setAttribute("cx", px.toFixed(2));
    pin?.setAttribute("cy", py.toFixed(2));
  });
  const endLabel = q('[data-part="end-label"]');
  endLabel?.setAttribute("x", String(endX));
  endLabel?.setAttribute("y", String(endY + endR + 18));

  const house = q('[data-part="turbo-house"]');
  const wheel = q('[data-part="turbo-wheel"]');
  const turboLabel = q('[data-part="turbo-label"]');
  const tx = 662;
  const ty = 310;
  house?.setAttribute("cx", String(tx));
  house?.setAttribute("cy", String(ty));
  house?.setAttribute("r", "36");
  house?.setAttribute("opacity", spec.turbo ? String(0.45 + spool * 0.55) : "0.28");
  wheel?.setAttribute("transform", `translate(${tx} ${ty}) rotate(${spec.turbo ? turboAng.toFixed(1) : 0})`);
  wheel?.setAttribute("opacity", spec.turbo ? "1" : "0.25");
  if (turboLabel) {
    turboLabel.setAttribute("x", String(tx));
    turboLabel.setAttribute("y", String(ty + 54));
    turboLabel.textContent = spec.turbo ? "Compressor" : "No turbo";
  }
}
