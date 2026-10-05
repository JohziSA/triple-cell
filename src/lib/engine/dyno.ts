/** Crank dyno estimate for the even-fire inline-3. Wide-open throttle. */

import type { Character, PresetId } from "./i3-dsp";

export type FuelId = "ron95" | "ron98" | "e85";

export type Build = {
  boreMm: number;
  strokeMm: number;
  compression: number;
  /** Intake duration at 0.050 in, degrees. */
  camDeg: number;
  /** Port / manifold flow, 0.78 restrictive → 1.18 race. */
  intake: number;
  /** Exhaust flow, 0.74 muffled → 1.16 open. */
  exhaust: number;
  fuel: FuelId;
  turbo: boolean;
  /** Compressor inducer, mm. */
  inducerMm: number;
  /** Wastegate gauge target, bar. */
  boostBar: number;
  /** Intercooler effectiveness, 0–1. */
  intercooler: number;
  /** Fraction of the mechanical redline the limiter is set to. */
  limitPct: number;
  altitudeM: number;
  tempC: number;
};

export type Point = {
  rpm: number;
  torqueNm: number;
  powerKw: number;
  ps: number;
  boostBar: number;
  ve: number;
  bmepBar: number;
  bsfc: number;
  knock: number;
  pr: number;
};

export type Band = {
  value: number;
  rpmLo: number;
  rpmHi: number;
  at: Point;
};

export type Sheet = {
  cc: number;
  idle: number;
  redline: number;
  mechRpm: number;
  pistonMs: number;
  character: Character;
  points: Point[];
  power: Band;
  torque: Band;
  specificKw: number;
  warnings: string[];
  preset: PresetId | null;
};

const CYL = 3;
const R_AIR = 287.05;
const L_GAMMA = 1.4;

const FUEL: Record<FuelId, { stoich: number; lhv: number; octane: number; cool: number }> = {
  ron95: { stoich: 14.7, lhv: 43.4e6, octane: 95, cool: 0 },
  ron98: { stoich: 14.7, lhv: 43.4e6, octane: 98, cool: 0 },
  e85: { stoich: 9.76, lhv: 26.8e6, octane: 107, cool: 15 },
};

export const BUILDS: Record<PresetId, Build> = {
  sports: {
    boreMm: 76,
    strokeMm: 88,
    compression: 11,
    camDeg: 222,
    intake: 1.02,
    exhaust: 1.05,
    fuel: "ron95",
    turbo: false,
    inducerMm: 46,
    boostBar: 0.9,
    intercooler: 0.72,
    limitPct: 1,
    altitudeM: 0,
    tempC: 25,
  },
  turbo: {
    boreMm: 82,
    strokeMm: 94.5,
    compression: 10,
    camDeg: 204,
    intake: 1,
    exhaust: 0.96,
    fuel: "ron95",
    turbo: true,
    inducerMm: 44,
    boostBar: 0.95,
    intercooler: 0.74,
    limitPct: 1,
    altitudeM: 0,
    tempC: 25,
  },
  longstroke: {
    boreMm: 92,
    strokeMm: 120,
    compression: 9.4,
    camDeg: 192,
    intake: 0.9,
    exhaust: 0.8,
    fuel: "ron95",
    turbo: false,
    inducerMm: 54,
    boostBar: 0.7,
    intercooler: 0.62,
    limitPct: 1,
    altitudeM: 0,
    tempC: 25,
  },
};

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export function displacementCc(boreMm: number, strokeMm: number) {
  return (Math.PI / 4) * boreMm * boreMm * strokeMm * CYL / 1000;
}

export function boreForCc(cc: number, strokeMm: number) {
  return Math.sqrt((cc * 4000) / (Math.PI * strokeMm * CYL));
}

export function ambient(altitudeM: number, tempC: number) {
  const p = 101325 * Math.pow(1 - 2.25577e-5 * clamp(altitudeM, 0, 5000), 5.25588);
  return { p, t: tempC + 273.15 };
}

/** Valvetrain / piston-speed redline. Oversquare motors are allowed a bit more mean piston speed. */
export function mechanicalRedline(boreMm: number, strokeMm: number) {
  const ratio = boreMm / Math.max(40, strokeMm);
  const mps = 21.2 + clamp((ratio - 0.72) * 7.5, 0, 4.2);
  const rpm = (mps * 30) / (strokeMm / 1000);
  return clamp(Math.round(rpm / 10) * 10, 4200, 9800);
}

function idleRpm(strokeMm: number, cam: number, cc: number, turbo: boolean) {
  const base = 600 + 26500 / strokeMm;
  const camDrop = Math.max(0, cam - 206) * 2.1;
  const sizeDrop = Math.max(0, cc - 1100) * 0.09;
  const turboDrop = turbo ? 40 : 0;
  return clamp(Math.round((base - camDrop - sizeDrop - turboDrop) / 10) * 10, 640, 980);
}

function vePeak(build: Build) {
  const camLift = clamp((build.camDeg - 198) * 0.0014, -0.025, 0.055);
  return clamp(0.8 + (build.intake - 0.78) * 0.4 + (build.exhaust - 0.74) * 0.15 + camLift, 0.64, 1.05);
}

function vePeakRpm(build: Build, mech: number) {
  return clamp(2100 + (build.camDeg - 194) * 125 + (build.intake - 1) * 550, 2400, mech * 0.92);
}

/** 1 at the VE peak. Mild cams stay full early; long cams are a lump that dies upstairs. */
function veShape(rpm: number, peakRpm: number, cam: number, redline: number) {
  const mild = clamp((228 - cam) / 46, 0, 1);
  const floor = 0.6 + 0.28 * mild;
  if (rpm <= peakRpm) {
    const t = clamp((rpm - 800) / (peakRpm - 800), 0, 1);
    const p = 0.85 + (1 - mild) * 1.55;
    return floor + (1 - floor) * Math.pow(t, p);
  }
  const span = Math.max(700, redline - peakRpm + 700);
  const t = clamp((rpm - peakRpm) / span, 0, 1.45);
  const drop = 0.05 + (1 - mild) * 0.4;
  return clamp(1 - drop * Math.pow(t, 1.15), 0.4, 1);
}

function chokeLbMin(inducerMm: number) {
  return 0.00715 * Math.pow(inducerMm, 2.15);
}

function spoolFullRpm(inducerMm: number, cc: number, cam: number) {
  const liters = Math.max(0.55, cc / 1000);
  const ref = 2050 * Math.pow(inducerMm / 42, 2.45) * Math.pow(1.5 / liters, 0.72);
  const camLag = 1 + Math.max(0, cam - 208) * 0.0035;
  return ref * camLag;
}

function boostFrac(rpm: number, start: number, full: number) {
  if (rpm <= start) return 0;
  if (rpm >= full) return 1;
  const t = (rpm - start) / (full - start);
  return t * t * (3 - 2 * t);
}

function compressor(pr: number, flowFrac: number, ic: number, tAmb: number, cool: number) {
  const prUse = Math.max(1.01, pr);
  const prPen = Math.abs(Math.log(prUse / 1.85)) * 0.09;
  const edge = flowFrac < 0.22 ? (0.22 - flowFrac) * 0.12 : Math.max(0, flowFrac - 0.75) * 0.45;
  const eta = clamp(0.745 - prPen - edge, 0.5, 0.78);
  const t2s = tAmb * Math.pow(prUse, (L_GAMMA - 1) / L_GAMMA);
  const t2 = tAmb + (t2s - tAmb) / eta;
  let tMan = t2 - clamp(ic, 0, 0.95) * (t2 - tAmb);
  if (prUse > 1.08) tMan -= cool;
  return { tMan: Math.max(tAmb - 5, tMan), mapDrop: 1 - 0.012 * clamp(ic, 0, 0.95) };
}

type Sample = {
  torqueNm: number;
  powerKw: number;
  ps: number;
  boostBar: number;
  ve: number;
  bmepBar: number;
  bsfc: number;
  knock: number;
  pr: number;
};

function sampleAt(build: Build, rpm: number, cc: number, mech: number, veP: number, veRpm: number): Sample {
  const air = ambient(build.altitudeM, build.tempC);
  const fuel = FUEL[build.fuel];
  const vd = cc / 1e6;
  const shape = veShape(rpm, veRpm, build.camDeg, mech);
  const veVol = veP * shape;

  let pr = 1;
  let tMan = air.t;
  let map = air.p;
  let flowFrac = 0;

  if (build.turbo) {
    const full = spoolFullRpm(build.inducerMm, cc, build.camDeg);
    const start = Math.max(900, full * 0.5);
    const frac = boostFrac(rpm, start, full);
    const prTarget = (air.p + build.boostBar * 1e5) / air.p;
    pr = 1 + (prTarget - 1) * frac;
    const choke = chokeLbMin(build.inducerMm);
    for (let k = 0; k < 6; k++) {
      const rho = map / (R_AIR * tMan);
      const airKgS = vd * (rpm / 120) * veVol * rho;
      const lbMin = airKgS * 132.277;
      flowFrac = lbMin / Math.max(1, choke);
      if (flowFrac > 0.98 && pr > 1.04) pr = Math.max(1.02, pr * (0.95 / flowFrac));
      if (pr < 1.05) {
        tMan = air.t;
        map = air.p;
      } else {
        const comp = compressor(pr, flowFrac, build.intercooler, air.t, fuel.cool);
        tMan = comp.tMan;
        map = pr * air.p * comp.mapDrop;
      }
    }
  }

  let ve = veVol;
  let pmep = 0.1 + Math.max(0, 0.98 - build.exhaust) * 0.5;
  if (build.turbo) {
    pmep += Math.max(0, pr - 1) * 0.4;
    if (pr < 1.07) {
      pmep += 0.16;
      ve *= 0.94;
    }
  }

  const rho = map / (R_AIR * tMan);
  const airKgS = vd * (rpm / 120) * ve * rho;
  const lambda = build.fuel === "e85" ? 0.8 : 0.875 - Math.min(0.07, Math.max(0, pr - 1) * 0.055);
  const afr = fuel.stoich * lambda;
  const fuelKgS = airKgS / afr;

  const etaOtto = 1 - Math.pow(build.compression, 1 - 1.3);
  const heat = clamp(0.9 + 0.1 * Math.min(1, (rpm - 1100) / 2000), 0.9, 1);
  const burn = clamp(1 - Math.max(0, rpm - mech * 0.84) / (mech * 2.4), 0.84, 1);
  const knockLoad =
    Math.max(0, build.compression - 7.6) * (0.85 + Math.max(0, pr - 1) * 1.35) * (tMan / 300);
  const knockLimit = 5.55 + (fuel.octane - 95) * 0.42;
  const excess = Math.max(0, knockLoad - knockLimit);
  const etaKnock = clamp(1 - excess * 0.072, 0.55, 1);

  const indicated = fuelKgS * fuel.lhv * etaOtto * 0.69 * heat * burn * etaKnock;
  const mps = (2 * (build.strokeMm / 1000) * rpm) / 60;
  let fmep =
    0.5 +
    0.0135 * mps +
    0.00125 * mps * mps +
    Math.max(0, 1.02 - build.intake) * 0.28 +
    Math.max(0, 1.0 - build.exhaust) * 0.38;
  // High cylinder pressure costs ring friction.
  fmep += Math.max(0, pr - 1) * 0.08;

  const imepPa = (indicated * 120) / (vd * rpm);
  const bmepPa = Math.max(0, imepPa - fmep * 1e5 - pmep * 1e5);
  const powerW = (bmepPa * vd * rpm) / 120;
  const torqueNm = (powerW * 60) / (2 * Math.PI * rpm);
  const powerKw = powerW / 1000;
  const bsfc = powerW > 1200 ? (fuelKgS * 3.6e9) / powerW : 0;

  return {
    torqueNm,
    powerKw,
    ps: powerW / 735.49875,
    boostBar: Math.max(0, (map - air.p) / 1e5),
    ve,
    bmepBar: bmepPa / 1e5,
    bsfc,
    knock: 1 - etaKnock,
    pr,
  };
}

function bandOf(points: Point[], key: "torqueNm" | "powerKw", tol: number): Band {
  let value = 0;
  for (const p of points) value = Math.max(value, p[key]);
  const hit = points.filter((p) => p[key] >= value * (1 - tol));
  const at = hit[Math.floor((hit.length - 1) / 2)] ?? points[0];
  return {
    value,
    rpmLo: hit[0]?.rpm ?? at.rpm,
    rpmHi: hit[hit.length - 1]?.rpm ?? at.rpm,
    at,
  };
}

export function sameBuild(a: Build, b: Build) {
  return (
    Math.abs(a.boreMm - b.boreMm) < 0.26 &&
    Math.abs(a.strokeMm - b.strokeMm) < 0.26 &&
    Math.abs(a.compression - b.compression) < 0.06 &&
    Math.abs(a.camDeg - b.camDeg) < 1.2 &&
    Math.abs(a.intake - b.intake) < 0.02 &&
    Math.abs(a.exhaust - b.exhaust) < 0.02 &&
    a.fuel === b.fuel &&
    a.turbo === b.turbo &&
    (!a.turbo ||
      (Math.abs(a.inducerMm - b.inducerMm) < 0.6 &&
        Math.abs(a.boostBar - b.boostBar) < 0.03 &&
        Math.abs(a.intercooler - b.intercooler) < 0.025)) &&
    Math.abs(a.limitPct - b.limitPct) < 0.012 &&
    Math.abs(a.altitudeM - b.altitudeM) < 30 &&
    Math.abs(a.tempC - b.tempC) < 0.6
  );
}

export function matchedPreset(build: Build): PresetId | null {
  const ids: PresetId[] = ["sports", "turbo", "longstroke"];
  for (const id of ids) if (sameBuild(build, BUILDS[id])) return id;
  return null;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

export function turboClass(inducerMm: number) {
  if (inducerMm < 40) return "GT20 class";
  if (inducerMm < 45) return "GT22 class";
  if (inducerMm < 49) return "GT25 class";
  if (inducerMm < 53) return "GT28 class";
  if (inducerMm < 58) return "GT30 class";
  if (inducerMm < 64) return "GTX30 class";
  return "GTX35 class";
}

export function simulate(build: Build): Sheet {
  const cc = displacementCc(build.boreMm, build.strokeMm);
  const mech = mechanicalRedline(build.boreMm, build.strokeMm);
  const redline = clamp(Math.round((mech * clamp(build.limitPct, 0.62, 1)) / 10) * 10, 3600, mech);
  const idle = Math.min(idleRpm(build.strokeMm, build.camDeg, cc, build.turbo), redline - 1200);
  const veP = vePeak(build);
  const veRpm = vePeakRpm(build, mech);

  const points: Point[] = [];
  const start = Math.min(1200, Math.max(1000, Math.round(idle / 100) * 100));
  for (let rpm = start; rpm < redline; rpm += 100) {
    points.push({ rpm, ...sampleAt(build, rpm, cc, mech, veP, veRpm) });
  }
  points.push({ rpm: redline, ...sampleAt(build, redline, cc, mech, veP, veRpm) });

  const power = bandOf(points, "powerKw", 0.012);
  const torque = bandOf(points, "torqueNm", 0.015);
  const preset = matchedPreset(build);
  const pistonMs = (2 * (build.strokeMm / 1000) * redline) / 60;
  const specificKw = power.value / (cc / 1000);

  const muffler = clamp(1.48 - build.exhaust, 0.12, 0.84);
  const length = clamp(0.46 + build.strokeMm / 210 + muffler * 0.42, 0.62, 1.65);
  const size = clamp(Math.pow(cc / 1200, 0.82), 0.58, 2.7);
  const full = build.turbo ? spoolFullRpm(build.inducerMm, cc, build.camDeg) : 0;
  const labels: Record<PresetId, string> = {
    sports: "Sports",
    turbo: "Turbo",
    longstroke: "Long-stroke",
  };
  const label = preset ? labels[preset] : "Custom";
  const ccR = Math.round(cc);
  const turboBit = build.turbo
    ? `${Math.round(build.inducerMm)} mm ${turboClass(build.inducerMm)} at ${build.boostBar.toFixed(2)} bar`
    : "naturally aspirated";
  const blurb = `${ccR} cc inline-3, ${round1(build.boreMm)}×${round1(build.strokeMm)} mm, ${build.compression.toFixed(1)}:1, ${turboBit}.`;
  const air = ambient(build.altitudeM, build.tempC);
  const note = [
    `  Bore × stroke:   ${round1(build.boreMm)} × ${round1(build.strokeMm)} mm`,
    `  Displacement:    ${ccR} cc`,
    `  Compression:     ${build.compression.toFixed(1)} : 1`,
    `  Cam @ 0.050":    ${Math.round(build.camDeg)}° intake`,
    `  Fuel:            ${build.fuel === "e85" ? "E85" : build.fuel === "ron98" ? "98 RON" : "95 RON"}`,
    `  Induction:       ${turboBit}`,
    build.turbo ? `  Intercooler:     ${Math.round(build.intercooler * 100)}%` : "",
    `  Air:             ${Math.round(build.tempC)}°C, ${Math.round(build.altitudeM)} m (${(air.p / 100).toFixed(0)} hPa)`,
    `  Peak (estimate): ${power.value.toFixed(1)} kW at ${power.at.rpm} rpm, ${Math.round(torque.value)} Nm`,
  ]
    .filter(Boolean)
    .join("\n");

  const warnings: string[] = [];
  if (power.at.knock > 0.04) {
    warnings.push(
      power.at.knock > 0.12
        ? "Knock is pulling serious timing at peak power. Drop compression or boost, or move to 98 RON / E85."
        : "Mild knock retard at peak power. 98 RON or a touch less boost gives the timing back.",
    );
  }
  if (build.turbo) {
    const top = points[points.length - 1];
    const bestBoost = points.reduce((m, p) => Math.max(m, p.boostBar), 0);
    if (top.boostBar < build.boostBar * 0.72 && full > redline * 0.55) {
      warnings.push("Boost is still arriving at the limiter. A smaller inducer, or more displacement, spools this earlier.");
    } else if (bestBoost > 0.3 && top.boostBar < bestBoost * 0.8) {
      warnings.push("The compressor runs out of map before the limiter. Step up a turbo size if you want the top end.");
    }
  }
  const sea = ambient(0, 25);
  const here = ambient(build.altitudeM, build.tempC);
  const dens = (here.p / sea.p) * (sea.t / here.t);
  if (dens < 0.94) {
    const pct = Math.round(dens * 100);
    warnings.push(
      build.turbo
        ? `Local air is ${pct}% of a sea-level 25°C day. Gauge boost hides some of the loss. Pressure ratio does not.`
        : `Local air is ${pct}% of a sea-level 25°C day. This sheet is uncorrected — it is the power you actually get.`,
    );
  }
  if (pistonMs > 23.4) {
    warnings.push(
      `Mean piston speed at the limiter is ${pistonMs.toFixed(1)} m/s. That is race-bottom-end territory, not a street rebuild.`,
    );
  }

  const character: Character = {
    id: preset ?? "custom",
    label,
    blurb,
    idle,
    redline,
    turbo: build.turbo,
    size,
    length,
    muffler,
    spoolStart: build.turbo ? Math.round(Math.max(900, full * 0.5)) : undefined,
    spoolFull: build.turbo ? Math.round(full) : undefined,
    turboSpin: build.turbo ? clamp(46 / build.inducerMm, 0.55, 1.5) : undefined,
    note,
  };

  return {
    cc,
    idle,
    redline,
    mechRpm: mech,
    pistonMs,
    character,
    points,
    power,
    torque,
    specificKw,
    warnings,
    preset,
  };
}

export function pointAtRpm(points: Point[], rpm: number): Point | null {
  if (points.length === 0 || rpm < points[0].rpm) return null;
  const last = points[points.length - 1];
  if (rpm >= last.rpm) return last;
  let hi = 1;
  while (hi < points.length && points[hi].rpm < rpm) hi += 1;
  const a = points[hi - 1];
  const b = points[hi];
  const t = (rpm - a.rpm) / Math.max(1, b.rpm - a.rpm);
  const mix = (k: keyof Point) => a[k] + (b[k] - a[k]) * t;
  return {
    rpm,
    torqueNm: mix("torqueNm"),
    powerKw: mix("powerKw"),
    ps: mix("ps"),
    boostBar: mix("boostBar"),
    ve: mix("ve"),
    bmepBar: mix("bmepBar"),
    bsfc: mix("bsfc"),
    knock: mix("knock"),
    pr: mix("pr"),
  };
}

export function intakeWord(v: number) {
  if (v < 0.86) return "restrictive";
  if (v < 0.97) return "stock";
  if (v < 1.08) return "ported";
  if (v < 1.14) return "ITBs";
  return "race";
}

export function exhaustWord(v: number) {
  if (v < 0.84) return "quiet";
  if (v < 0.97) return "stock";
  if (v < 1.08) return "sports";
  return "open";
}

export function camWord(v: number) {
  if (v < 198) return "economy";
  if (v < 214) return "street";
  if (v < 232) return "fast road";
  return "race";
}

export function fuelLabel(id: FuelId) {
  if (id === "e85") return "E85";
  if (id === "ron98") return "98 RON";
  return "95 RON";
}
