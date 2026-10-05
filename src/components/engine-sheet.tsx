import { useEffect, useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BUILDS,
  boreForCc,
  camWord,
  displacementCc,
  exhaustWord,
  fuelLabel,
  intakeWord,
  pointAtRpm,
  turboClass,
  type Build,
  type FuelId,
  type Point,
  type Sheet,
} from "@/lib/engine/dyno";
import type { PresetId } from "@/lib/engine/i3-dsp";

const PRESET_ORDER: { id: PresetId; label: string }[] = [
  { id: "sports", label: "Sports" },
  { id: "turbo", label: "Turbo" },
  { id: "longstroke", label: "Long-stroke" },
];

function axisTop(max: number, step: number) {
  return Math.max(step, Math.ceil((max * 1.12) / step) * step);
}

function bandCopy(lo: number, hi: number, at: number) {
  if (hi - lo >= 300) return `${lo.toLocaleString("en-US")}–${hi.toLocaleString("en-US")} rpm`;
  return `${at.toLocaleString("en-US")} rpm`;
}

export function BrakeReadout({ sheet, rpm, running }: { sheet: Sheet; rpm: number; running: boolean }) {
  const now = running ? pointAtRpm(sheet.points, rpm) : null;
  return (
    <div className="flex flex-col gap-4 rounded-md border border-line bg-surface p-4">
      <div>
        <h2 className="font-display text-xl tracking-wide text-fg">Brake</h2>
        <p className="mt-1 text-sm text-muted">{sheet.character.blurb}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <figure>
          <figcaption className="text-sm text-muted">Peak power</figcaption>
          <p className="font-display text-4xl leading-none tabular-nums text-fg">{sheet.power.value.toFixed(1)}</p>
          <p className="text-sm text-muted">
            kW · {Math.round(sheet.power.at.ps)} PS · {bandCopy(sheet.power.rpmLo, sheet.power.rpmHi, sheet.power.at.rpm)}
          </p>
        </figure>
        <figure>
          <figcaption className="text-sm text-muted">Peak torque</figcaption>
          <p className="font-display text-4xl leading-none tabular-nums text-amber">{Math.round(sheet.torque.value)}</p>
          <p className="text-sm text-muted">
            Nm · {bandCopy(sheet.torque.rpmLo, sheet.torque.rpmHi, sheet.torque.at.rpm)}
          </p>
        </figure>
        <figure>
          <figcaption className="text-sm text-muted">Displacement</figcaption>
          <p className="font-display text-3xl leading-none tabular-nums text-fg">{Math.round(sheet.cc)}</p>
          <p className="text-sm text-muted">
            cc · {sheet.specificKw.toFixed(0)} kW/L
          </p>
        </figure>
        <figure>
          <figcaption className="text-sm text-muted">BMEP at peak torque</figcaption>
          <p className="font-display text-3xl leading-none tabular-nums text-fg">{sheet.torque.at.bmepBar.toFixed(1)}</p>
          <p className="text-sm text-muted">bar · BSFC {Math.round(sheet.torque.at.bsfc)} g/kWh</p>
        </figure>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-3 text-sm">
        <dt className="text-muted">Idle</dt>
        <dd className="text-right tabular-nums text-fg">{sheet.idle.toLocaleString("en-US")} rpm</dd>
        <dt className="text-muted">Limiter</dt>
        <dd className="text-right tabular-nums text-fg">{sheet.redline.toLocaleString("en-US")} rpm</dd>
        <dt className="text-muted">Piston speed</dt>
        <dd className="text-right tabular-nums text-fg">{sheet.pistonMs.toFixed(1)} m/s</dd>
        <dt className="text-muted">On the brake</dt>
        <dd className="text-right tabular-nums text-fg">
          {now
            ? `${now.powerKw.toFixed(1)} kW · ${Math.round(now.torqueNm)} Nm`
            : "Motor stopped"}
        </dd>
      </dl>
      {sheet.warnings.length > 0 ? (
        <ul className="flex flex-col gap-2 border-t border-line pt-3">
          {sheet.warnings.map((warning) => (
            <li key={warning} className="border-l-2 border-amber pl-3 text-sm text-muted">
              {warning}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

type TipRow = { payload?: Point };

function ChartTip({ active, payload }: { active?: boolean; payload?: TipRow[] }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-sm">
      <p className="font-display text-lg tabular-nums text-fg">{row.rpm.toLocaleString("en-US")} rpm</p>
      <p className="tabular-nums text-amber">{Math.round(row.torqueNm)} Nm</p>
      <p className="tabular-nums text-fg">
        {row.powerKw.toFixed(1)} kW · {Math.round(row.ps)} PS
      </p>
      <p className="text-muted">
        {row.boostBar > 0.02 ? `${row.boostBar.toFixed(2)} bar gauge · ` : ""}
        VE {Math.round(row.ve * 100)}% · BMEP {row.bmepBar.toFixed(1)} bar
      </p>
      {row.bsfc > 0 ? <p className="text-muted">BSFC {Math.round(row.bsfc)} g/kWh</p> : null}
      {row.knock > 0.03 ? <p className="text-amber">Timing pulled {Math.round(row.knock * 100)}%</p> : null}
    </div>
  );
}

export function BrakeChart({ sheet, rpm, running }: { sheet: Sheet; rpm: number; running: boolean }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const torqueTop = axisTop(Math.max(...sheet.points.map((p) => p.torqueNm)), 25);
  const powerTop = axisTop(Math.max(...sheet.points.map((p) => p.powerKw)), 10);
  const rows = useMemo(() => {
    const list = sheet.points.filter((p) => p.rpm % 500 === 0);
    const last = sheet.points[sheet.points.length - 1];
    if (last && list[list.length - 1]?.rpm !== last.rpm) list.push(last);
    return list;
  }, [sheet.points]);

  return (
    <section className="rounded-md border border-line bg-surface p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-3xl tracking-wide text-fg">Crank sheet</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Wide-open throttle at the crank. Friction, knock and compressor choke are in the curve. Amber is
            torque, the light line is power. Boost, if any, is in the table. Air is not corrected to sea level.
          </p>
        </div>
      </div>
      <div className="mt-3 h-72 w-full sm:h-80">
        {ready ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={sheet.points} margin={{ top: 28, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--color-line)" vertical={false} />
              <XAxis
                dataKey="rpm"
                type="number"
                domain={["dataMin", "dataMax"]}
                tick={{ fill: "var(--color-muted)", fontSize: 12 }}
                axisLine={{ stroke: "var(--color-line)" }}
                tickLine={{ stroke: "var(--color-line)" }}
                tickFormatter={(value: number) => `${Math.round(value / 100) / 10}`}
              />
              <YAxis
                yAxisId="nm"
                domain={[0, torqueTop]}
                width={44}
                tick={{ fill: "var(--color-muted)", fontSize: 12 }}
                axisLine={{ stroke: "var(--color-line)" }}
                tickLine={false}
              />
              <YAxis
                yAxisId="kw"
                orientation="right"
                domain={[0, powerTop]}
                width={40}
                tick={{ fill: "var(--color-muted)", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<ChartTip />} />
              <Legend verticalAlign="top" height={24} wrapperStyle={{ fontSize: 13, color: "var(--color-muted)" }} />
              <Area
                yAxisId="nm"
                type="monotone"
                dataKey="torqueNm"
                name="Torque Nm"
                stroke="var(--color-amber)"
                fill="var(--color-amber)"
                fillOpacity={0.16}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                yAxisId="kw"
                type="monotone"
                dataKey="powerKw"
                name="Power kW"
                stroke="var(--color-fg)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <ReferenceDot
                yAxisId="nm"
                x={sheet.torque.at.rpm}
                y={sheet.torque.at.torqueNm}
                r={3.5}
                fill="var(--color-amber)"
                stroke="none"
              />
              <ReferenceDot
                yAxisId="kw"
                x={sheet.power.at.rpm}
                y={sheet.power.at.powerKw}
                r={3.5}
                fill="var(--color-fg)"
                stroke="none"
              />
              {running && rpm >= sheet.points[0].rpm ? (
                <ReferenceLine yAxisId="nm" x={rpm} stroke="var(--color-amber)" strokeDasharray="2 3" />
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full rounded-md bg-bg" />
        )}
      </div>
      <p className="mt-1 text-xs text-muted">RPM in thousands. Left axis Nm, right axis kW.</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-xl text-sm">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-2 pr-3 font-medium">RPM</th>
              <th className="py-2 pr-3 font-medium">Nm</th>
              <th className="py-2 pr-3 font-medium">kW</th>
              <th className="py-2 pr-3 font-medium">PS</th>
              <th className="py-2 pr-3 font-medium">Boost</th>
              <th className="py-2 pr-3 font-medium">VE</th>
              <th className="py-2 font-medium">BMEP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const hot = row.rpm === sheet.power.at.rpm;
              return (
                <tr key={row.rpm} className={"border-t border-line tabular-nums " + (hot ? "text-amber" : "text-fg")}>
                  <td className="py-2 pr-3">{row.rpm.toLocaleString("en-US")}</td>
                  <td className="py-2 pr-3">{Math.round(row.torqueNm)}</td>
                  <td className="py-2 pr-3">{row.powerKw.toFixed(1)}</td>
                  <td className="py-2 pr-3">{Math.round(row.ps)}</td>
                  <td className="py-2 pr-3">{row.boostBar > 0.02 ? row.boostBar.toFixed(2) : "—"}</td>
                  <td className="py-2 pr-3">{Math.round(row.ve * 100)}%</td>
                  <td className="py-2">{row.bmepBar.toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sheet.character.note?.includes("E85") ? (
        <p className="mt-2 text-xs text-muted">E85 BSFC counts ethanol mass, so it sits well above a petrol number for the same efficiency.</p>
      ) : null}
    </section>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  note,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  note?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className={"block " + (disabled ? "opacity-40" : "")}>
      <span className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-fg">{label}</span>
        <span className="tabular-nums text-muted">{display}</span>
      </span>
      {note ? <span className="mt-0.5 block text-xs text-muted">{note}</span> : null}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-label={label}
        value={Math.min(max, Math.max(min, value))}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function BuildForm({
  build,
  sheet,
  onChange,
}: {
  build: Build;
  sheet: Sheet;
  onChange: (next: Build) => void;
}) {
  const cc = displacementCc(build.boreMm, build.strokeMm);
  const ccMin = displacementCc(64, build.strokeMm);
  const ccMax = displacementCc(100, build.strokeMm);
  const set = (patch: Partial<Build>) => onChange({ ...build, ...patch });

  return (
    <section className="rounded-md border border-line bg-surface p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-3xl tracking-wide text-fg">Short block</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Inline-3 only — the firing order stays 1–2–3, which is what you hear. Displacement edits the bore and leaves the stroke alone.
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Starting spec">
          {PRESET_ORDER.map((item) => {
            const on = sheet.preset === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(BUILDS[item.id])}
                className={
                  "h-11 rounded-md border px-3 text-sm font-medium " +
                  (on ? "border-amber bg-amber text-bg" : "border-line bg-surface-2 text-fg hover:border-amber")
                }
              >
                {item.label}
              </button>
            );
          })}
          {sheet.preset ? null : (
            <span className="inline-flex h-11 items-center px-1 text-sm text-amber">Custom</span>
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2">
        <Slider
          label="Bore"
          min={64}
          max={100}
          step={0.5}
          value={build.boreMm}
          display={`${build.boreMm.toFixed(1)} mm`}
          onChange={(boreMm) => set({ boreMm })}
        />
        <Slider
          label="Stroke"
          min={68}
          max={120}
          step={0.5}
          value={build.strokeMm}
          display={`${build.strokeMm.toFixed(1)} mm`}
          note="Longer stroke lowers the redline. Mean piston speed is the limit."
          onChange={(strokeMm) => set({ strokeMm })}
        />
        <Slider
          label="Displacement"
          min={Math.round(ccMin)}
          max={Math.round(ccMax)}
          step={1}
          value={cc}
          display={`${Math.round(cc)} cc`}
          note="Scales the bore. Stroke stays."
          onChange={(next) => set({ boreMm: Math.min(100, Math.max(64, boreForCc(next, build.strokeMm))) })}
        />
        <Slider
          label="Compression"
          min={8}
          max={13.5}
          step={0.1}
          value={build.compression}
          display={`${build.compression.toFixed(1)} : 1`}
          note="High compression plus boost knocks on pump fuel."
          onChange={(compression) => set({ compression })}
        />
        <Slider
          label="Cam duration"
          min={186}
          max={256}
          step={2}
          value={build.camDeg}
          display={`${Math.round(build.camDeg)}° · ${camWord(build.camDeg)}`}
          note="Intake duration at 0.050 in. Longer moves the lump up the range."
          onChange={(camDeg) => set({ camDeg })}
        />
        <Slider
          label="Rev limiter"
          min={70}
          max={100}
          step={1}
          value={Math.round(build.limitPct * 100)}
          display={`${sheet.redline.toLocaleString("en-US")} rpm`}
          note={`Head and piston speed allow ${sheet.mechRpm.toLocaleString("en-US")} rpm.`}
          onChange={(pct) => set({ limitPct: pct / 100 })}
        />
        <Slider
          label="Intake"
          min={0.78}
          max={1.18}
          step={0.01}
          value={build.intake}
          display={intakeWord(build.intake)}
          onChange={(intake) => set({ intake })}
        />
        <Slider
          label="Exhaust"
          min={0.74}
          max={1.16}
          step={0.01}
          value={build.exhaust}
          display={exhaustWord(build.exhaust)}
          note="Also changes how muffled the pipe sounds."
          onChange={(exhaust) => set({ exhaust })}
        />
      </div>

      <div className="mt-6 border-t border-line pt-4">
        <h3 className="font-display text-xl tracking-wide text-fg">Air and fuel</h3>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Fuel">
          {(["ron95", "ron98", "e85"] as FuelId[]).map((id) => {
            const on = build.fuel === id;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={on}
                onClick={() => set({ fuel: id })}
                className={
                  "h-11 rounded-md border px-3 text-sm font-medium " +
                  (on ? "border-amber bg-amber text-bg" : "border-line bg-surface-2 text-fg hover:border-amber")
                }
              >
                {fuelLabel(id)}
              </button>
            );
          })}
        </div>
        <div className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <Slider
            label="Altitude"
            min={0}
            max={3000}
            step={25}
            value={build.altitudeM}
            display={`${Math.round(build.altitudeM)} m`}
            note="1750 m is highveld air. The sheet is not corrected back to sea level."
            onChange={(altitudeM) => set({ altitudeM })}
          />
          <Slider
            label="Intake temperature"
            min={0}
            max={45}
            step={1}
            value={build.tempC}
            display={`${Math.round(build.tempC)}°C`}
            onChange={(tempC) => set({ tempC })}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => set({ altitudeM: 0, tempC: 25 })}
            className="h-11 rounded-md border border-line bg-surface-2 px-3 text-sm text-fg hover:border-amber"
          >
            Sea level, 25°C
          </button>
          <button
            type="button"
            onClick={() => set({ altitudeM: 1750, tempC: 28 })}
            className="h-11 rounded-md border border-line bg-surface-2 px-3 text-sm text-fg hover:border-amber"
          >
            Highveld, 28°C
          </button>
        </div>
      </div>

      <div className="mt-6 border-t border-line pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-display text-xl tracking-wide text-fg">Turbo</h3>
          <button
            type="button"
            aria-pressed={build.turbo}
            onClick={() => set({ turbo: !build.turbo })}
            className={
              "h-11 rounded-md border px-3 text-sm font-medium " +
              (build.turbo ? "border-amber bg-amber text-bg" : "border-line bg-surface-2 text-fg hover:border-amber")
            }
          >
            {build.turbo ? "Turbocharged" : "Naturally aspirated"}
          </button>
        </div>
        <div className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <Slider
            label="Inducer"
            min={36}
            max={68}
            step={1}
            disabled={!build.turbo}
            value={build.inducerMm}
            display={`${Math.round(build.inducerMm)} mm · ${turboClass(build.inducerMm)}`}
            note="Smaller spools sooner and runs out of air first."
            onChange={(inducerMm) => set({ inducerMm })}
          />
          <Slider
            label="Wastegate"
            min={0.2}
            max={2.2}
            step={0.05}
            disabled={!build.turbo}
            value={build.boostBar}
            display={`${build.boostBar.toFixed(2)} bar gauge`}
            onChange={(boostBar) => set({ boostBar })}
          />
          <Slider
            label="Intercooler"
            min={0.4}
            max={0.92}
            step={0.01}
            disabled={!build.turbo}
            value={build.intercooler}
            display={`${Math.round(build.intercooler * 100)}%`}
            note="How much of the compressor heat it pulls back out."
            onChange={(intercooler) => set({ intercooler })}
          />
        </div>
      </div>
    </section>
  );
}
