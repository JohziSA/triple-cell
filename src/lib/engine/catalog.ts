import {
  EXPORT_RATE,
  FULL_LAYERS,
  createVoice,
  fadeEdges,
  makeupFor,
  normalizePeak,
  peakOf,
  renderBlocks,
  renderLoop,
  type Character,
  type Drive,
  type Layers,
} from "./i3-dsp";

export const SAMPLE_RATE = EXPORT_RATE;

export type Rendered = { pcm: Float32Array; mixGain: number };

export type Asset = {
  id: string;
  group: string;
  name: string;
  path: string;
  detail: string;
  loop: boolean;
  render: (c: Character) => Rendered;
};

const EX = { exhaust: 1, gas: 0, intake: 0, mechanical: 0, turbo: 0 } satisfies Layers;
const GAS = { exhaust: 0, gas: 1, intake: 0, mechanical: 0, turbo: 0 } satisfies Layers;
const INTAKE = { exhaust: 0, gas: 0, intake: 1, mechanical: 0, turbo: 0 } satisfies Layers;
const MECH = { exhaust: 0, gas: 0, intake: 0, mechanical: 1, turbo: 0 } satisfies Layers;
const TURBO = { exhaust: 0, gas: 0, intake: 0, mechanical: 0, turbo: 1 } satisfies Layers;

export function makeDrive(rpm: number, extra: Partial<Drive> = {}): Drive {
  return {
    rpm,
    throttle: extra.throttle ?? 1,
    combust: extra.combust ?? 1,
    limiter: extra.limiter ?? false,
    starter: extra.starter ?? 0,
    pop: extra.pop ?? 0,
    pops: extra.pops ?? false,
    single: extra.single ?? false,
    beds: extra.beds ?? true,
    layers: extra.layers ?? FULL_LAYERS,
  };
}

function shot(pcm: Float32Array): Rendered {
  fadeEdges(pcm, SAMPLE_RATE, 0.004, 0.05);
  const pre = peakOf(pcm);
  normalizePeak(pcm, 0.89);
  return { pcm, mixGain: Number((pre / 0.89).toFixed(4)) };
}

function kept(pcm: Float32Array): Rendered {
  return { pcm, mixGain: 1 };
}

export function rpmAt(c: Character, unit: number) {
  return Math.round(c.idle + (c.redline - c.idle) * unit);
}

function renderOneShot(c: Character, seconds: number, drive: Drive, prime?: { spool?: number; fireIndex?: number; rpm?: number }) {
  const v = createVoice(SAMPLE_RATE, c);
  v.compress = false;
  v.clip = true;
  v.makeup = makeupFor(SAMPLE_RATE, c);
  if (prime) v.prime(prime);
  const n = Math.floor(SAMPLE_RATE * seconds);
  const pcm = new Float32Array(n);
  const block = 256;
  for (let i = 0; i < n; i += block) {
    v.process(pcm.subarray(i, Math.min(n, i + block)), drive);
  }
  return pcm;
}

function pulseAsset(cyl: number, unit: number, throttle: number, label: string, slug: string): Asset {
  return {
    id: `pulse-${slug}-c${cyl + 1}`,
    group: "Cylinder pulses",
    name: `Cylinder ${cyl + 1} · ${label}`,
    path: `pulses/cyl${cyl + 1}_${slug}.wav`,
    detail: `${label} exhaust pulse, cylinder ${cyl + 1} of 3. Play them in order 1–2–3, one per fire.`,
    loop: false,
    render: (c) => {
      const rpm = rpmAt(c, unit);
      return shot(
        renderOneShot(
          c,
          0.36,
          makeDrive(rpm, { throttle, single: true, beds: false, layers: EX }),
          { fireIndex: cyl, rpm },
        ),
      );
    },
  };
}

export const STARTUP_SEC = 2.65;

export function startupDrive(t: number, c: Character, layers: Layers = FULL_LAYERS): Drive {
  let rpm = 0;
  let throttle = 0.15;
  let combust = 0;
  let starter = 0;
  if (t < 0.16) {
    const u = t / 0.16;
    starter = u;
    rpm = 30 + u * 90;
  } else if (t < 0.58) {
    const u = (t - 0.16) / 0.42;
    starter = 1;
    rpm = 120 + u * 280;
    combust = t > 0.46 ? 0.35 : 0.04;
    throttle = 0.22;
  } else if (t < 0.95) {
    const u = (t - 0.58) / 0.37;
    starter = 1 - u;
    rpm = 400 + u * 980;
    combust = 0.6 + 0.4 * u;
    throttle = 0.4;
  } else if (t < 1.5) {
    const u = (t - 0.95) / 0.55;
    rpm = 1380 + Math.sin(u * Math.PI) * 140;
    combust = 1;
    throttle = 0.26 * (1 - u) + 0.1;
    starter = 0;
  } else {
    const u = Math.min(1, (t - 1.5) / 0.7);
    rpm = 1380 + (c.idle - 1380) * u;
    combust = 1;
    throttle = 0.09;
    starter = 0;
  }
  return makeDrive(Math.max(0, rpm), { throttle, combust, starter, layers });
}

export function shutdownSeconds(fromRpm: number) {
  return Math.min(2.5, 0.55 + fromRpm / 3200);
}

export function shutdownDrive(t: number, fromRpm: number, layers: Layers = FULL_LAYERS): Drive {
  const combust = t < 0.07 ? 1 - t / 0.07 : 0;
  const rpm = Math.max(0, fromRpm * Math.exp(-t * 2.15));
  const pop = t > 0.2 && t < 0.26 ? 0.85 : 0;
  return makeDrive(rpm, { throttle: 0, combust, pop, layers });
}

function blipDrive(t: number, c: Character): Drive {
  const idle = c.idle;
  const top = Math.min(c.redline * 0.68, rpmAt(c, 0.62));
  let rpm = idle;
  let throttle = 0.1;
  let pops = false;
  if (t < 0.16) {
    rpm = idle;
  } else if (t < 0.58) {
    const u = (t - 0.16) / 0.42;
    const e = 1 - (1 - u) * (1 - u);
    rpm = idle + (top - idle) * e;
    throttle = 1;
  } else if (t < 0.74) {
    rpm = top;
    throttle = 1;
  } else {
    const u = Math.min(1, (t - 0.74) / 1.45);
    rpm = idle + (top - idle) * Math.pow(1 - u, 1.3);
    throttle = 0;
    pops = rpm > 2600;
  }
  return makeDrive(rpm, { throttle, pops });
}

function pullDrive(t: number, c: Character): Drive {
  const red = c.redline - 60;
  const second = Math.max(c.idle + 900, red * 0.58);
  const start = rpmAt(c, 0.18);
  let rpm = start;
  let throttle = 0.4;
  let pops = false;
  let combust = 1;
  if (t < 0.18) {
    rpm = start;
    throttle = 0.45;
  } else if (t < 1.65) {
    const u = (t - 0.18) / 1.47;
    rpm = start + (red - start) * Math.pow(u, 0.85);
    throttle = 1;
  } else if (t < 1.84) {
    const u = (t - 1.65) / 0.19;
    rpm = red + (second - red) * u;
    throttle = 0.05;
    combust = 0.35;
  } else if (t < 3.45) {
    const u = (t - 1.84) / 1.61;
    rpm = second + (red - second) * Math.pow(u, 0.9);
    throttle = 1;
  } else {
    const u = Math.min(1, (t - 3.45) / 1.25);
    rpm = red + (rpmAt(c, 0.22) - red) * (1 - Math.pow(1 - u, 1.4));
    throttle = 0;
    pops = rpm > 2800;
  }
  return makeDrive(rpm, { throttle, combust, pops, limiter: throttle > 0.8 && rpm > c.redline - 120 });
}

function limiterDrive(t: number, c: Character): Drive {
  const red = c.redline;
  const low = rpmAt(c, 0.72);
  let rpm = low;
  let throttle = 1;
  let limiter = false;
  let pops = false;
  if (t < 0.4) {
    const u = t / 0.4;
    rpm = low + (red - low) * u;
  } else if (t < 2.25) {
    const bounce = 0.5 + 0.5 * Math.sin((t - 0.4) * 34);
    rpm = red - 30 - bounce * 240;
    limiter = true;
  } else {
    const u = Math.min(1, (t - 2.25) / 0.9);
    rpm = red + (rpmAt(c, 0.4) - red) * u;
    throttle = 0;
    pops = true;
  }
  return makeDrive(rpm, { throttle, limiter, pops });
}

function overrunDrive(t: number, c: Character): Drive {
  const top = rpmAt(c, 0.86);
  const u = Math.min(1, t / 2.15);
  const rpm = c.idle + (top - c.idle) * Math.pow(1 - u, 1.15);
  return makeDrive(rpm, { throttle: 0, pops: rpm > 2400 });
}

function span(c: Character, seconds: number, at: (t: number) => Drive, outFade = 0.06): Rendered {
  const pcm = renderBlocks(SAMPLE_RATE, seconds, c, at, { warmup: 0 });
  fadeEdges(pcm, SAMPLE_RATE, 0.01, outFade);
  return kept(pcm);
}

export function assetsFor(c: Character): Asset[] {
  const low = 0.22;
  const mid = 0.5;
  const high = 0.9;
  const list: Asset[] = [];

  for (const cyl of [0, 1, 2]) {
    list.push(pulseAsset(cyl, low, 0.38, "cruise", "cruise"));
    list.push(pulseAsset(cyl, mid, 1, "wide open", "wot"));
    list.push(pulseAsset(cyl, high, 1, "high", "high"));
    list.push(
      {
        id: `pulse-over-c${cyl + 1}`,
        group: "Cylinder pulses",
        name: `Cylinder ${cyl + 1} · overrun`,
        path: `pulses/cyl${cyl + 1}_overrun.wav`,
        detail: "Closed-throttle exhaust stroke. Thinner, less bass. Use these on lift-off instead of the wide-open pulses.",
        loop: false,
        render: (cc) =>
          shot(
            renderOneShot(
              cc,
              0.36,
              makeDrive(rpmAt(cc, mid), { throttle: 0, single: true, beds: false, layers: EX }),
              { fireIndex: cyl, rpm: rpmAt(cc, mid) },
            ),
          ),
      },
    );
  }

  list.push({
    id: "pop-light",
    group: "Afterfire",
    name: "Pop, light",
    path: "pops/pop_light.wav",
    detail: "Small exhaust crackle. Sprinkle these on overrun, not on a clock.",
    loop: false,
    render: (cc) =>
      shot(renderOneShot(cc, 0.4, makeDrive(rpmAt(cc, 0.55), { throttle: 0, combust: 0, pop: 0.7, beds: false, layers: EX }))),
  });
  list.push({
    id: "pop-heavy",
    group: "Afterfire",
    name: "Pop, heavy",
    path: "pops/pop_heavy.wav",
    detail: "Hard afterfire with a low boom. One of these after a big lift sells the overrun.",
    loop: false,
    render: (cc) =>
      shot(
        renderOneShot(cc, 0.5, makeDrive(rpmAt(cc, 0.7), { throttle: 0, combust: 0, pop: 1.35, beds: false, layers: EX })),
      ),
  });

  list.push({
    id: "gas-puff",
    group: "Exhaust gas",
    name: "Single gas puff",
    path: "gas/gas_puff.wav",
    detail: "The slug of exhaust gas from one cylinder, without the pipe bark. Layer it under each pulse.",
    loop: false,
    render: (cc) =>
      shot(
        renderOneShot(
          cc,
          0.4,
          makeDrive(rpmAt(cc, 0.45), { throttle: 0.85, single: true, beds: false, layers: GAS }),
          { rpm: rpmAt(cc, 0.45) },
        ),
      ),
  });

  for (const [unit, slug, throttle, name] of [
    [0, "idle", 0.16, "Idle rush"],
    [mid, "mid", 1, "Mid rush"],
    [high, "high", 1, "High rush"],
  ] as const) {
    list.push({
      id: `gas-${slug}`,
      group: "Exhaust gas",
      name,
      path: `gas/gas_${slug}.wav`,
      detail: "Steady exhaust-gas rush with a chuff on every firing. Loop it and follow RPM with a crossfade, not by pitching.",
      loop: true,
      render: (cc) => {
        const rpm = slug === "idle" ? cc.idle : rpmAt(cc, unit);
        return kept(renderLoop(SAMPLE_RATE, 1.6, cc, makeDrive(rpm, { throttle, layers: GAS })));
      },
    });
  }

  for (const [unit, slug, name] of [
    [mid, "mid", "Intake, mid"],
    [high, "high", "Intake, high"],
  ] as const) {
    list.push({
      id: `intake-${slug}`,
      group: "Intake",
      name,
      path: `intake/intake_${slug}.wav`,
      detail: "Throttle-body roar. Follows load hard — keep it near silent on a closed throttle.",
      loop: true,
      render: (cc) => kept(renderLoop(SAMPLE_RATE, 1.5, cc, makeDrive(rpmAt(cc, unit), { throttle: 1, layers: INTAKE }))),
    });
  }

  for (const [unit, slug, throttle, name] of [
    [0, "idle", 0.1, "Mechanical, idle"],
    [mid, "mid", 1, "Mechanical, mid"],
    [high, "high", 1, "Mechanical, high"],
  ] as const) {
    list.push({
      id: `mech-${slug}`,
      group: "Mechanical",
      name,
      path: `mechanical/mech_${slug}.wav`,
      detail: "Block, cam, and a little gear whine. Sits under the exhaust. Do not pitch this with the exhaust pulses.",
      loop: true,
      render: (cc) => {
        const rpm = slug === "idle" ? cc.idle : rpmAt(cc, unit);
        return kept(renderLoop(SAMPLE_RATE, 1.5, cc, makeDrive(rpm, { throttle, layers: MECH })));
      },
    });
  }

  list.push({
    id: "starter",
    group: "Mechanical",
    name: "Starter spin",
    path: "mechanical/starter_spin.wav",
    detail: "Bendix whine at cranking speed, no combustion. Loop it under the start, then cut it the moment the engine catches.",
    loop: true,
    render: (cc) =>
      kept(renderLoop(SAMPLE_RATE, 1.1, cc, makeDrive(260, { throttle: 0, combust: 0, starter: 1, layers: MECH }))),
  });

  list.push({
    id: "loop-idle",
    group: "Full engine loops",
    name: "Idle",
    path: "loops/loop_idle.wav",
    detail: `Assembled motor at ${c.idle} rpm. Seamless loop. Easiest way to get the triple into a game.`,
    loop: true,
    render: (cc) => kept(renderLoop(SAMPLE_RATE, 1.7, cc, makeDrive(cc.idle, { throttle: 0.1 }))),
  });

  const bands: { unit: number; slug: string; name: string }[] = [
    { unit: low, slug: "low", name: "Low" },
    { unit: mid, slug: "mid", name: "Mid" },
    { unit: high, slug: "high", name: "High" },
  ];
  for (const b of bands) {
    list.push({
      id: `loop-${b.slug}-on`,
      group: "Full engine loops",
      name: `${b.name}, on throttle`,
      path: `loops/loop_${b.slug}_on.wav`,
      detail: "Full mix, throttle open. Crossfade to the neighbor loop as RPM moves. These are gain-matched to each other.",
      loop: true,
      render: (cc) =>
        kept(renderLoop(SAMPLE_RATE, 1.45, cc, makeDrive(rpmAt(cc, b.unit), { throttle: b.unit < 0.3 ? 0.4 : 1 }))),
    });
    list.push({
      id: `loop-${b.slug}-off`,
      group: "Full engine loops",
      name: `${b.name}, overrun`,
      path: `loops/loop_${b.slug}_off.wav`,
      detail: "Full mix, throttle shut. Crossfade against the on-throttle loop with the pedal.",
      loop: true,
      render: (cc) => kept(renderLoop(SAMPLE_RATE, 1.45, cc, makeDrive(rpmAt(cc, b.unit), { throttle: 0 }))),
    });
  }

  if (c.turbo) {
    list.push({
      id: "turbo-mid",
      group: "Turbo",
      name: "Whistle, mid spool",
      path: "turbo/whistle_mid.wav",
      detail: "Compressor whistle around half spool. Loop under the exhaust and open it with boost, not with RPM alone.",
      loop: true,
      render: (cc) =>
        kept(
          renderLoop(SAMPLE_RATE, 1.4, cc, makeDrive(rpmAt(cc, 0.45), { throttle: 0.85, layers: TURBO }), {
            primeSpool: 0.48,
          }),
        ),
    });
    list.push({
      id: "turbo-high",
      group: "Turbo",
      name: "Whistle, full spool",
      path: "turbo/whistle_high.wav",
      detail: "Small-turbo blade whistle on song. It should lag the pedal by a third of a second in-game.",
      loop: true,
      render: (cc) =>
        kept(
          renderLoop(SAMPLE_RATE, 1.3, cc, makeDrive(rpmAt(cc, 0.88), { throttle: 1, layers: TURBO }), {
            primeSpool: 0.9,
          }),
        ),
    });
    list.push({
      id: "turbo-bov",
      group: "Turbo",
      name: "Dump valve",
      path: "turbo/dump_valve.wav",
      detail: "Throttle snap shut with the compressor still spinning. Play once on a fast lift from boost.",
      loop: false,
      render: (cc) => {
        const pcm = renderBlocks(
          SAMPLE_RATE,
          0.75,
          cc,
          (t) =>
            makeDrive(rpmAt(cc, 0.7) - t * 900, {
              throttle: t < 0.06 ? 1 : 0,
              layers: { exhaust: 0.35, gas: 0.45, intake: 0, mechanical: 0, turbo: 1 },
            }),
          { warmup: 0, primeSpool: 0.92, primeRpm: rpmAt(cc, 0.7) },
        );
        return shot(pcm);
      },
    });
  }

  list.push(
    {
      id: "perf-start",
      group: "Performances",
      name: "Cold start to idle",
      path: "performances/startup.wav",
      detail: "Starter, a cough, the flare, then idle. Drop-in if you do not want to build the start from parts.",
      loop: false,
      render: (cc) => span(cc, STARTUP_SEC, (t) => startupDrive(t, cc), 0.08),
    },
    {
      id: "perf-stop",
      group: "Performances",
      name: "Shutdown from idle",
      path: "performances/shutdown.wav",
      detail: "Ignition off, a dying spin, one afterfire.",
      loop: false,
      render: (cc) => span(cc, shutdownSeconds(cc.idle) + 0.2, (t) => shutdownDrive(t, cc.idle), 0.1),
    },
    {
      id: "perf-blip",
      group: "Performances",
      name: "Throttle blip",
      path: "performances/rev_blip.wav",
      detail: "Neutral blip and the fall back through overrun.",
      loop: false,
      render: (cc) => span(cc, 2.4, (t) => blipDrive(t, cc)),
    },
    {
      id: "perf-over",
      group: "Performances",
      name: "Lift-off crackle",
      path: "performances/overrun_crackle.wav",
      detail: "Closed throttle from high RPM with scattered pops. Reference for how dense the crackle should be.",
      loop: false,
      render: (cc) => span(cc, 2.3, (t) => overrunDrive(t, cc)),
    },
    {
      id: "perf-limit",
      group: "Performances",
      name: "Rev limiter",
      path: "performances/rev_limiter.wav",
      detail: "Ignition cut on the redline, then a lift.",
      loop: false,
      render: (cc) => span(cc, 3.15, (t) => limiterDrive(t, cc)),
    },
    {
      id: "perf-pull",
      group: "Performances",
      name: "Two-gear pull",
      path: "performances/gear_pull.wav",
      detail: "Wide-open pull, one upshift, then a lift. This is the layers already summed — use it as a mix reference.",
      loop: false,
      render: (cc) => span(cc, 4.75, (t) => pullDrive(t, cc), 0.08),
    },
  );

  return list;
}

export function integrationText(c: Character): string {
  const low = rpmAt(c, 0.22);
  const mid = rpmAt(c, 0.5);
  const high = rpmAt(c, 0.9);
  return `TRIPLE CELL — inline-3 sample kit
Spec: ${c.label}
${c.blurb}

ENGINE
  Layout:          inline 3, four-stroke
  Firing:          even-fire, every 240 degrees of crank
  Firing order:    1 - 2 - 3
  Idle:            ${c.idle} rpm
  Redline:         ${c.redline} rpm
  Sample rate:     ${SAMPLE_RATE} Hz
  Channels:        1 (mono — pan and distance-filter in the game)
  Bit depth:       16
  Turbo:           ${c.turbo ? "yes — whistle, lag, dump valve" : "no"}
${c.note ? `\nTHIS BUILD\n${c.note}\n` : ""}
THE ONE FORMULA
  Fires per second = RPM / 40
  Gap between fires = 40 / RPM seconds

  ${c.idle} rpm → ${(c.idle / 40).toFixed(1)} fires/s, gap ${((40 / c.idle) * 1000).toFixed(1)} ms
  ${mid} rpm → ${(mid / 40).toFixed(1)} fires/s, gap ${((40 / mid) * 1000).toFixed(1)} ms
  ${high} rpm → ${(high / 40).toFixed(1)} fires/s, gap ${((40 / high) * 1000).toFixed(1)} ms

WHY IT SOUNDS LIKE A TRIPLE
  An inline-4 fires every 180° (RPM / 30). This fires every 240°.
  The exhaust fundamental is 1.5× crank speed, which does not octave-align
  with the crank. That 1.5-order, plus the primary rocking couple (a slow
  pulse-to-pulse volume wobble, stronger at idle), is the odd triple rasp.
  Do not "fix" it into an even four. The uneven cylinder-to-cylinder bark
  is the manifold, not a misfire: play cyl1, cyl2, cyl3 in order.

TWO WAYS TO BUILD THE MOTOR

A. Loops (fast, stable)
   Crossfade the full-engine loops by RPM and by throttle.
   On throttle:  loop_low_on / loop_mid_on / loop_high_on, plus loop_idle.
   Off throttle: the matching _off loops.
   Equal-power crossfade between the two nearest RPM loops.
   Do not varispeed a loop by more than about ±8%. Pipe resonances are
   fixed hardware; pitching them makes it sound like a toy.

   Loop RPM anchors for this spec:
     idle     ${c.idle}
     low      ${low}
     mid      ${mid}
     high     ${high}

B. Pulses (what the layers are for)
   Every fire, play one one-shot:
     RPM below ${(low + mid) / 2}     → cyl*_cruise
     RPM below ${(mid + high) / 2}    → cyl*_wot
     else                             → cyl*_high
     throttle under ~8%               → cyl*_overrun
   Advance the cylinder each fire: 1, then 2, then 3, then 1.
   Randomize gain ±6% and timing ±0.4% so it does not machine-gun.
   Keep polyphony — the ring of one pulse must overlap the next.

   Under that, loop and crossfade:
     gas/gas_*.wav          exhaust gas rush, follows airflow
     intake/intake_*.wav    throttle roar, gain = throttle^1.3
     mechanical/mech_*.wav  block and whine, always on, quieter than exhaust

   One-shots are peak-normalized so they are easy to audition.
   manifest.json → mixGain is the linear gain that puts a one-shot back
   at the level it had inside the full-engine loops (loops use mixGain 1).
   Start with pulses at mixGain, gas around 0.8, intake 0.7, mechanical 0.5,
   then mix by ear. The performances/ files are the summed reference.

OVERRUN AND THE LIMITER
   On a fast lift above ~3000 rpm, keep playing overrun pulses and
   occasionally pop_light or pop_heavy (a handful per second, not every fire).
   Rev limiter: skip about one fire in four and drop in pop_heavy.
   performances/overrun_crackle.wav and rev_limiter.wav are the density reference.

START AND STOP
   Either play performances/startup.wav and shutdown.wav,
   or: loop starter_spin.wav, fade it out as the first strong fires land,
   flare to ~1400 rpm, settle to idle.

TURBO
   ${
     c.turbo
       ? `Whistle loops lag the throttle. A simple spool follower:
   spool += (target - spool) * dt / 0.4
   target = throttle * how far RPM is above ~1500.
   Play dump_valve.wav once when throttle falls hard while spool is high.`
       : "This spec is naturally aspirated. Switch the dyno to Turbo and export again for whistle and dump-valve files."
   }

IN THE MIX
   These are dry and close-mic'd. In-game, lowpass with distance, add a short
   exhaust slapback (40–80 ms) and a little body resonance. Do not add a long
   hall — it turns the triple into a wash and you lose the firing order.
`;
}
