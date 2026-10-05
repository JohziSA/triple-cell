import { memo, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import {
  Cog,
  Download,
  Flame,
  Gauge,
  Play,
  Power,
  Square,
  Waves,
  Wind,
} from "lucide-react";
import { BrakeChart, BrakeReadout, BuildForm } from "@/components/engine-sheet";
import { EngineCutaway } from "@/components/engine-view";
import { EngineStage } from "@/components/engine-3d-view";
import { assetsFor, integrationText, rpmAt } from "@/lib/engine/catalog";
import { BUILDS, simulate, type Build } from "@/lib/engine/dyno";
import type { Character, Layers } from "@/lib/engine/i3-dsp";
import { createSession, type Mode, type Session } from "@/lib/engine/session";

const LAYER_META: { key: keyof Layers; label: string; hint: string; icon: typeof Flame }[] = [
  { key: "exhaust", label: "Exhaust", hint: "Pipe and bark", icon: Flame },
  { key: "gas", label: "Exhaust gas", hint: "Rush and chuff", icon: Wind },
  { key: "intake", label: "Intake", hint: "Throttle roar", icon: Waves },
  { key: "mechanical", label: "Mechanical", hint: "Block and whine", icon: Cog },
  { key: "turbo", label: "Turbo", hint: "Whistle and dump", icon: Gauge },
];

function useSession() {
  const ref = useRef<Session | null>(null);
  if (!ref.current) ref.current = createSession();
  return ref.current;
}

export function Bench() {
  const session = useSession();
  const [build, setBuild] = useState<Build>(BUILDS.sports);
  const [layers, setLayers] = useState<Layers>({ exhaust: 1, gas: 1, intake: 1, mechanical: 1, turbo: 1 });
  const [volume, setVolume] = useState(0.8);
  const [playing, setPlaying] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [kit, setKit] = useState("");
  const [saved, setSaved] = useState<{ name: string; url: string } | null>(null);
  const [fault, setFault] = useState("");
  const [needle, setNeedle] = useState({ rpm: 0, mode: "off" as Mode });

  const sheet = useMemo(() => simulate(build), [build]);
  const preset = sheet.character;
  const assets = useMemo(() => assetsFor(preset), [preset]);
  const groups = useMemo(() => {
    const order: string[] = [];
    for (const asset of assets) if (!order.includes(asset.group)) order.push(asset.group);
    return order;
  }, [assets]);

  useEffect(() => {
    const timer = window.setTimeout(() => session.setCharacter(preset), 140);
    return () => window.clearTimeout(timer);
  }, [preset, session]);

  const onLive = useCallback((rpm: number, mode: Mode) => {
    setNeedle((prev) => {
      const next = Math.round(rpm);
      if (prev.mode === mode && Math.abs(prev.rpm - next) < 20) return prev;
      return { rpm: next, mode };
    });
  }, []);

  function setLayer(key: keyof Layers, value: number) {
    setLayers((prev) => ({ ...prev, [key]: value }));
    session.setLayer(key, value);
  }

  async function audition(id: string) {
    if (playing === id) {
      session.stopPlay();
      setPlaying(null);
      return;
    }
    const asset = assets.find((item) => item.id === id);
    if (!asset || busy) return;
    session.unlock();
    setFault("");
    setBusy(id);
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const { pcm } = asset.render(preset);
      const ok = session.play(pcm, asset.loop);
      if (!ok) {
        setFault(session.audioNote() || "Sound did not start. Tap the button again.");
        setPlaying(null);
      } else {
        setPlaying(id);
      }
    } catch {
      setFault("That sample did not render. Try it again.");
      setPlaying(null);
    } finally {
      setBusy(null);
    }
  }

  async function saveOne(id: string) {
    const asset = assets.find((item) => item.id === id);
    if (!asset || kit) return;
    setFault("");
    setBusy(id);
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const file = session.downloadAsset(asset);
      setSaved((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return file;
      });
    } catch {
      setFault("Could not build that WAV.");
    } finally {
      setBusy(null);
    }
  }

  async function saveKit() {
    if (kit) return;
    setFault("");
    setKit("Warming the cell…");
    try {
      const file = await session.downloadKit(setKit);
      setSaved((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return file;
      });
    } catch {
      setFault("The kit did not pack. Try again.");
    } finally {
      setKit("");
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div className="max-w-2xl">
          <p className="font-display text-sm tracking-widest text-amber">INLINE-3 DYNO</p>
          <h1 className="font-display text-5xl leading-none text-fg sm:text-6xl">TRIPLE CELL</h1>
          <p className="mt-3 text-muted">
            Even-fire inline-3, a pulse every 240° of crank. Set bore, stroke, cam and turbo — the sheet and the
            motor both follow. Firing rate is RPM ÷ 40.
          </p>
        </div>
        <label className="flex w-full max-w-xs items-center gap-3 text-sm text-muted sm:w-56">
          <span className="shrink-0">Level</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            aria-label="Output level"
            onChange={(event) => {
              const next = Number(event.target.value) / 100;
              setVolume(next);
              session.setVolume(next);
            }}
          />
        </label>
      </header>

      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <DynoFace session={session} preset={preset} onLive={onLive} />
        <BrakeReadout sheet={sheet} rpm={needle.rpm} running={needle.mode !== "off"} />
      </section>

      <div className="mt-6">
        <EngineStage session={session} build={build} />
      </div>

      <div className="mt-6">
        <EngineCutaway session={session} build={build} />
      </div>

      <div className="mt-6">
        <BrakeChart sheet={sheet} rpm={needle.rpm} running={needle.mode !== "off"} />
      </div>

      <div className="mt-6">
        <BuildForm
          build={build}
          sheet={sheet}
          onChange={setBuild}
        />
      </div>

      <section className="mt-6 rounded-md border border-line bg-surface p-4">
        <h2 className="font-display text-xl tracking-wide text-fg">Close-mic mix</h2>
        <p className="mt-1 text-sm text-muted">These only change what you hear, not the sheet.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {LAYER_META.map((layer) => {
            const Icon = layer.icon;
            const disabled = layer.key === "turbo" && !preset.turbo;
            return (
              <label key={layer.key} className={"block " + (disabled ? "opacity-40" : "")}>
                <span className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="inline-flex items-center gap-2 text-fg">
                    <Icon className="size-4 text-amber" aria-hidden="true" />
                    {layer.label}
                  </span>
                  <span className="text-muted">{disabled ? "NA" : layer.hint}</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  disabled={disabled}
                  aria-label={layer.label}
                  value={Math.round(layers[layer.key] * 100)}
                  onChange={(event) => setLayer(layer.key, Number(event.target.value) / 100)}
                />
              </label>
            );
          })}
        </div>
      </section>

      <section className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-3xl tracking-wide text-fg">Sample library</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              Loops are gain-matched. One-shots are normalized — the kit’s manifest lists the mix gain that
              puts them back in proportion. Anchors for this spec: idle {preset.idle}, low {rpmAt(preset, 0.22)},
              mid {rpmAt(preset, 0.5)}, high {rpmAt(preset, 0.9)} rpm.
            </p>
          </div>
          <button
            type="button"
            disabled={Boolean(kit)}
            onClick={() => void saveKit()}
            className="inline-flex h-12 items-center gap-2 rounded-md bg-amber px-4 text-sm font-semibold text-bg disabled:opacity-50"
          >
            <Download className="size-4" aria-hidden="true" />
            Download kit
          </button>
        </div>
        {saved ? (
          <p className="mt-3 text-sm text-muted">
            If the file did not save, use{" "}
            <a className="font-medium text-amber underline" href={saved.url} download={saved.name}>
              {saved.name}
            </a>
            .
          </p>
        ) : null}
        {fault ? (
          <p className="mt-3 text-sm text-danger" role="alert">
            {fault}
          </p>
        ) : null}
        {kit ? (
          <p className="mt-3 text-sm text-amber" role="status">
            {kit}
          </p>
        ) : null}

        <div className="mt-4 flex flex-col gap-8">
          {groups.map((group) => (
            <div key={group}>
              <h3 className="font-display text-xl tracking-wide text-amber">{group}</h3>
              <ul className="mt-2 divide-y divide-line border-y border-line">
                {assets
                  .filter((asset) => asset.group === group)
                  .map((asset) => {
                    const active = playing === asset.id;
                    const working = busy === asset.id;
                    return (
                      <li key={asset.id} className="flex flex-wrap items-center gap-3 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-fg">{asset.name}</p>
                          <p className="text-sm text-muted">{asset.detail}</p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={Boolean(kit) || (Boolean(busy) && !working)}
                            onClick={() => void audition(asset.id)}
                            className="inline-flex h-11 items-center gap-2 rounded-md border border-line bg-surface-2 px-3 text-sm text-fg hover:border-amber disabled:opacity-40"
                          >
                            {active ? (
                              <Square className="size-4" aria-hidden="true" />
                            ) : (
                              <Play className="size-4" aria-hidden="true" />
                            )}
                            {working ? "Rendering" : active ? "Stop" : asset.loop ? "Loop" : "Play"}
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(kit) || Boolean(busy)}
                            onClick={() => void saveOne(asset.id)}
                            className="inline-flex h-11 items-center gap-2 rounded-md border border-line bg-surface-2 px-3 text-sm text-fg hover:border-amber disabled:opacity-40"
                          >
                            <Download className="size-4" aria-hidden="true" />
                            WAV
                          </button>
                        </div>
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8 mb-10 rounded-md border border-line bg-surface">
        <details className="group p-4">
          <summary className="cursor-pointer font-display text-xl tracking-wide text-fg">
            How to assemble this in a game
          </summary>
          <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap font-sans text-sm leading-relaxed text-muted">
            {integrationText(preset)}
          </pre>
        </details>
      </section>
    </main>
  );
}

const DynoFace = memo(function DynoFace({
  session,
  preset,
  onLive,
}: {
  session: Session;
  preset: Character;
  onLive?: (rpm: number, mode: Mode) => void;
}) {
  const [snap, setSnap] = useState({
    rpm: 0,
    throttle: 0,
    limiter: false,
    held: false,
    mode: "off" as Mode,
    audio: "",
  });
  const [lamps, setLamps] = useState(0);
  const phase = useRef(0);
  const waveRef = useRef<SVGPolylineElement>(null);
  const barsRef = useRef<SVGGElement>(null);
  const timeBuf = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const freqBuf = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const onLiveRef = useRef(onLive);
  onLiveRef.current = onLive;

  useEffect(() => {
    const onDown = (event: KeyboardEvent) => {
      if (event.code !== "ArrowUp" && event.code !== "Space") return;
      if (event.repeat) return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (event.code === "Space" && tag === "BUTTON") return;
      event.preventDefault();
      session.setHeld(true);
    };
    const onUp = (event: KeyboardEvent) => {
      if (event.code !== "ArrowUp" && event.code !== "Space") return;
      session.setHeld(false);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [session]);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let acc = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      session.step(dt);
      const live = session.live;
      if (live.rpm > 40 && session.getMode() !== "off") {
        phase.current = (phase.current + (live.rpm / 40) * dt) % 3;
      }
      acc += dt;
      if (acc >= 0.05) {
        acc = 0;
        setSnap({
          rpm: live.rpm,
          throttle: live.throttle,
          limiter: live.limiter,
          held: session.isHeld(),
          mode: session.getMode(),
          audio: session.audioNote(),
        });
        setLamps(Math.floor(phase.current));
        onLiveRef.current?.(live.rpm, session.getMode());
      }
      drawScope(waveRef.current, barsRef.current, session.getAnalyser(), timeBuf, freqBuf);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [session]);

  const mode = snap.mode;
  const firing = snap.rpm > 40 ? snap.rpm / 40 : 0;
  const gap = firing > 0 ? 1000 / firing : 0;
  const label = mode === "start" ? "Cranking" : mode === "run" ? "Kill motor" : mode === "stop" ? "Stopping" : "Start motor";

  return (
    <div className="rounded-md border border-line bg-surface p-4">
      <Tach rpm={snap.rpm} redline={preset.redline} limiter={snap.limiter} />
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-display text-5xl leading-none tabular-nums text-amber sm:text-6xl">
            {Math.round(snap.rpm).toLocaleString("en-US")}
          </p>
          <p className="mt-1 text-sm text-muted">
            {firing > 0 ? `${firing.toFixed(1)} fires/s · ${gap.toFixed(1)} ms gap` : "Motor stopped"}
            {snap.limiter ? <span className="ml-2 text-danger">Limiter</span> : null}
          </p>
        </div>
        <div className="flex gap-2" aria-label="Firing order">
          {[1, 2, 3].map((cyl, index) => {
            const lit = mode !== "off" && snap.rpm > 40 && lamps === index;
            return (
              <div key={cyl} className="flex flex-col items-center gap-1">
                <span
                  className={"size-8 rounded-full border " + (lit ? "border-amber bg-amber" : "border-line bg-surface-2")}
                />
                <span className="font-display text-sm text-muted">{cyl}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full bg-amber" style={{ width: `${Math.round(snap.throttle * 100)}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted">Throttle</p>
      <svg viewBox="0 0 200 56" preserveAspectRatio="none" className="mt-3 h-16 w-full rounded-md bg-bg sm:h-24" aria-hidden="true">
        <line x1="0" y1="28" x2="200" y2="28" className="stroke-line" strokeWidth="0.4" />
        <polyline
          ref={waveRef}
          points="0,28 200,28"
          fill="none"
          className="stroke-amber"
          strokeWidth="0.6"
          vectorEffect="non-scaling-stroke"
        />
        <g ref={barsRef} />
      </svg>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          onPointerDown={() => session.unlock()}
          onClick={() => session.ignition()}
          className="inline-flex h-12 touch-manipulation items-center justify-center gap-2 rounded-md border border-line bg-surface-2 text-sm font-medium text-fg hover:border-amber"
        >
          <Power className="size-4 text-amber" aria-hidden="true" />
          {label}
        </button>
        <button
          type="button"
          aria-pressed={snap.held}
          onPointerDown={() => session.unlock()}
          onClick={() => session.setHeld(!session.isHeld())}
          className="inline-flex h-12 touch-manipulation items-center justify-center gap-2 rounded-md bg-amber text-sm font-semibold text-bg"
        >
          {snap.held ? "Lift throttle" : "Rev"}
        </button>
      </div>
      {snap.audio ? (
        <p className="mt-2 text-xs text-danger" role="status">
          {snap.audio}
        </p>
      ) : null}
      <p className="mt-2 text-xs text-muted">Tap Rev to hold the throttle open. Tap again to lift. Up arrow does the same while held.</p>
    </div>
  );
});

function Tach({ rpm, redline, limiter }: { rpm: number; redline: number; limiter: boolean }) {
  const start = 198;
  const sweep = 144;
  const t = Math.max(0, Math.min(1, rpm / Math.max(1, redline)));
  const deg = start + sweep * t;
  const rad = (deg * Math.PI) / 180;
  const r = (v: number) => Math.round(v * 100) / 100;
  const x2 = r(100 + Math.cos(rad) * 62);
  const y2 = r(100 + Math.sin(rad) * 62);
  const ticks = [];
  const steps = Math.max(4, Math.round(redline / 1000));
  for (let i = 0; i <= steps; i++) {
    const frac = i / steps;
    const a = ((start + sweep * frac) * Math.PI) / 180;
    ticks.push(
      <line
        key={i}
        x1={r(100 + Math.cos(a) * 66)}
        y1={r(100 + Math.sin(a) * 66)}
        x2={r(100 + Math.cos(a) * 76)}
        y2={r(100 + Math.sin(a) * 76)}
        className={frac > 0.86 ? "stroke-danger" : "stroke-muted"}
        strokeWidth="1.6"
      />,
    );
  }
  const arc = (a0: number, a1: number, radius: number) => {
    const p0 = (a0 * Math.PI) / 180;
    const p1 = (a1 * Math.PI) / 180;
    const x0 = r(100 + Math.cos(p0) * radius);
    const y0 = r(100 + Math.sin(p0) * radius);
    const x1 = r(100 + Math.cos(p1) * radius);
    const y1 = r(100 + Math.sin(p1) * radius);
    return `M ${x0} ${y0} A ${radius} ${radius} 0 0 1 ${x1} ${y1}`;
  };
  const track = arc(start, start + sweep, 74);
  const red = arc(start + sweep * 0.86, start + sweep, 74);

  return (
    <svg viewBox="0 0 200 118" className="mx-auto h-36 w-full sm:h-44" role="img" aria-label="Tachometer">
      <path d={track} className="fill-none stroke-line" strokeWidth="6" strokeLinecap="round" />
      <path d={red} className="fill-none stroke-danger" strokeWidth="6" strokeLinecap="round" />
      {ticks}
      <line
        x1="100"
        y1="100"
        x2={x2}
        y2={y2}
        className={limiter ? "stroke-danger" : "stroke-amber"}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="100" cy="100" r="4" className="fill-fg" />
    </svg>
  );
}

function drawScope(
  wave: SVGPolylineElement | null,
  bars: SVGGElement | null,
  analyser: AnalyserNode | null,
  timeBuf: MutableRefObject<Uint8Array<ArrayBuffer> | null>,
  freqBuf: MutableRefObject<Uint8Array<ArrayBuffer> | null>,
) {
  if (!wave || !bars || !analyser) return;
  if (!timeBuf.current || timeBuf.current.length !== analyser.fftSize) {
    timeBuf.current = new Uint8Array(new ArrayBuffer(analyser.fftSize));
  }
  const bins = analyser.frequencyBinCount;
  if (!freqBuf.current || freqBuf.current.length !== bins) {
    freqBuf.current = new Uint8Array(new ArrayBuffer(bins));
  }
  analyser.getByteTimeDomainData(timeBuf.current);
  analyser.getByteFrequencyData(freqBuf.current);
  const time = timeBuf.current;
  const freq = freqBuf.current;
  let points = "";
  const step = 8;
  for (let i = 0; i < time.length; i += step) {
    const x = (i / (time.length - 1)) * 200;
    const y = (time[i] / 255) * 56;
    points += `${x.toFixed(1)},${y.toFixed(1)} `;
  }
  wave.setAttribute("points", points);

  const count = 28;
  while (bars.childNodes.length < count) {
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("fill", "#f0a202");
    rect.setAttribute("opacity", "0.45");
    bars.appendChild(rect);
  }
  for (let i = 0; i < count; i++) {
    const rect = bars.childNodes[i] as SVGRectElement;
    const idx = Math.min(bins - 1, 2 + i * 4);
    const mag = freq[idx] / 255;
    const h = Math.max(0.4, mag * 50);
    const w = 100 / count;
    rect.setAttribute("x", String(100 + i * w));
    rect.setAttribute("y", String(56 - h));
    rect.setAttribute("width", String(w * 0.7));
    rect.setAttribute("height", String(h));
  }
}
