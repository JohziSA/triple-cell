/** Even-fire inline-3, four-stroke. Firing rate = rpm / 40 (three combustions per two crank revolutions). */

export type PresetId = "sports" | "turbo" | "longstroke";

export type Character = {
  id: string;
  label: string;
  blurb: string;
  idle: number;
  redline: number;
  turbo: boolean;
  /** Relative displacement. Bigger = heavier pulses, slightly lower pitch. */
  size: number;
  /** Exhaust length. Higher = longer pipe, lower resonances. */
  length: number;
  /** 0 = open pipe, 1 = quiet muffler. */
  muffler: number;
  /** RPM where the compressor starts to make boost. */
  spoolStart?: number;
  /** RPM where the wastegate target is reached, before choke. */
  spoolFull?: number;
  /** Blade speed versus a 46 mm inducer. Smaller turbo, higher whistle. */
  turboSpin?: number;
  /** Printed into the sample-kit notes. */
  note?: string;
};

export const PRESETS: Record<PresetId, Character> = {
  sports: {
    id: "sports",
    label: "Sports",
    blurb: "1.2 L even-fire triple, short sports muffler. Raspy, eager, no boost.",
    idle: 880,
    redline: 7600,
    turbo: false,
    size: 1,
    length: 0.84,
    muffler: 0.32,
  },
  turbo: {
    id: "turbo",
    label: "Turbo",
    blurb: "1.5 L boosted triple. Softer off-boost, hard bark on song, whistle and dump valve.",
    idle: 820,
    redline: 7000,
    turbo: true,
    size: 1.22,
    length: 1.12,
    muffler: 0.52,
  },
  longstroke: {
    id: "longstroke",
    label: "Long-stroke",
    blurb: "2.4 L low-tune triple. Heavy pulses, long pipe, a lazier idle.",
    idle: 700,
    redline: 5400,
    turbo: false,
    size: 1.85,
    length: 1.42,
    muffler: 0.68,
  },
};

export type Layers = {
  exhaust: number;
  gas: number;
  intake: number;
  mechanical: number;
  turbo: number;
};

export const FULL_LAYERS: Layers = {
  exhaust: 1,
  gas: 1,
  intake: 1,
  mechanical: 1,
  turbo: 1,
};

export type Drive = {
  rpm: number;
  throttle: number;
  /** Combustion strength. 0 while cranking before it catches, 1 when running. */
  combust: number;
  limiter: boolean;
  /** 0..1 starter-motor mix. */
  starter: number;
  /** Edge-triggered afterfire. >0.5 fires once per rising edge. Strength is the value. */
  pop: number;
  /** Closed-throttle crackle while this is true. Leave false on seamless loops. */
  pops: boolean;
  /** Fire a single cylinder and let it ring. */
  single: boolean;
  /**
   * Continuous beds: firing buzz, gas rush, intake roar, gear whine.
   * Set false for one-shot transients. Omitted means true.
   */
  beds?: boolean;
  layers: Layers;
};

export const SILENT_DRIVE: Drive = {
  rpm: 0,
  throttle: 0,
  combust: 0,
  limiter: false,
  starter: 0,
  pop: 0,
  pops: false,
  single: false,
  layers: FULL_LAYERS,
};

type Biq = {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
};

type Res = { c: number; r2: number; y1: number; y2: number; g: number };

const CYL_AMP = [0.84, 1, 1.14];
const CYL_LEN = [1.14, 0.96, 0.9];

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

function makeBiq(
  b0: number,
  b1: number,
  b2: number,
  a0: number,
  a1: number,
  a2: number,
): Biq {
  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
    x1: 0,
    x2: 0,
    y1: 0,
    y2: 0,
  };
}

function makeLP(freq: number, q: number, sr: number): Biq {
  const w0 = (2 * Math.PI * freq) / sr;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * q);
  return makeBiq((1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
}

function makeHP(freq: number, q: number, sr: number): Biq {
  const w0 = (2 * Math.PI * freq) / sr;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * q);
  return makeBiq((1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
}

function makeBP(freq: number, q: number, sr: number): Biq {
  const w0 = (2 * Math.PI * freq) / sr;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * q);
  return makeBiq(alpha, 0, -alpha, 1 + alpha, -2 * cos, 1 - alpha);
}

function retuneBP(f: Biq, freq: number, q: number, sr: number) {
  const w0 = (2 * Math.PI * clamp(freq, 30, sr * 0.45)) / sr;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * q);
  const a0 = 1 + alpha;
  f.b0 = alpha / a0;
  f.b1 = 0;
  f.b2 = -alpha / a0;
  f.a1 = (-2 * cos) / a0;
  f.a2 = (1 - alpha) / a0;
}

function tickBiq(f: Biq, x: number) {
  const y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
  f.x2 = f.x1;
  f.x1 = x;
  f.y2 = f.y1;
  f.y1 = y;
  return y;
}

function clearBiq(f: Biq) {
  f.x1 = f.x2 = f.y1 = f.y2 = 0;
}

export type Voice = {
  process: (out: Float32Array, drive: Drive) => void;
  setCharacter: (c: Character) => void;
  reset: () => void;
  prime: (p: { spool?: number; rpm?: number; fireIndex?: number }) => void;
  makeup: number;
  compress: boolean;
  /** Safety ceiling. Turn off while measuring makeup gain. */
  clip: boolean;
};

export function createVoice(sampleRate: number, initial: Character): Voice {
  const sr = sampleRate;
  let char = initial;

  let resonators: Res[] = [];
  let outLP = makeLP(8000, 0.7, sr);
  let tickHP = makeHP(2400, 0.707, sr);
  let gasBP = makeBP(220, 0.7, sr);
  let chuffBP = makeBP(480, 1.3, sr);
  let intakeBP = makeBP(640, 1.15, sr);
  let turboBP = makeBP(3200, 1.6, sr);
  let starterLP = makeLP(900, 0.7, sr);
  let bodyA = 0.01;
  const puffDecay = Math.exp(-1 / (sr * 0.042));
  const bovDecay = Math.exp(-1 / (sr * 0.18));
  const boomDecay = Math.exp(-1 / (sr * 0.055));
  const spoolUp = 1 - Math.exp(-1 / (sr * 0.42));
  const spoolDn = 1 - Math.exp(-1 / (sr * 0.22));
  const flutterK = 1 - Math.exp(-1 / (sr * 0.08));
  const dcR = 0.9982;

  function build() {
    const fScale = 1 / char.length / Math.pow(char.size, 0.3);
    const muff = char.muffler;
    const bandG = [1 - muff * 0.1, 1 - muff * 0.34, 1 - muff * 0.72];
    const base: { f: number; dec: number; g: number; band: 0 | 1 | 2 }[] = [
      { f: 52, dec: 0.048, g: 1.35, band: 0 },
      { f: 84, dec: 0.04, g: 1.15, band: 0 },
      { f: 124, dec: 0.034, g: 0.95, band: 0 },
      { f: 188, dec: 0.028, g: 0.72, band: 1 },
      { f: 275, dec: 0.022, g: 0.55, band: 1 },
      { f: 420, dec: 0.018, g: 0.42, band: 1 },
      { f: 690, dec: 0.013, g: 0.32, band: 2 },
      { f: 1120, dec: 0.01, g: 0.22, band: 2 },
      { f: 1860, dec: 0.008, g: 0.12, band: 2 },
      { f: 3050, dec: 0.006, g: 0.06, band: 2 },
    ];
    resonators = base.map((b) => {
      const f = clamp(b.f * fScale, 28, 14000);
      const dec = b.dec * 0.58 * (0.85 + 0.2 * char.length) * (1 - muff * (b.band === 2 ? 0.4 : 0.1));
      const r = Math.exp(-1 / (Math.max(0.004, dec) * sr));
      const w = (2 * Math.PI * f) / sr;
      const lowBoost = b.band === 0 ? 0.8 + 0.3 * char.size : 1;
      // (1-r) keeps resonant sine gain near unity instead of Q*thousands.
      const norm = (1 - r) * 4.5;
      return {
        c: 2 * r * Math.cos(w),
        r2: r * r,
        y1: 0,
        y2: 0,
        g: b.g * bandG[b.band] * lowBoost * norm,
      };
    });
    const lpF = clamp(9800 - muff * 6200, 2400, 14000);
    outLP = makeLP(lpF, 0.7, sr);
    tickHP = makeHP(clamp(2600 + muff * 800, 1800, 6000), 0.707, sr);
    gasBP = makeBP(clamp(180 * fScale, 70, 500), 0.65, sr);
    chuffBP = makeBP(clamp(420 * fScale, 160, 1400), 1.35, sr);
    intakeBP = makeBP(700, 1.1, sr);
    turboBP = makeBP(clamp(3000 * (char.turboSpin ?? 1), 1600, 8200), 2.2, sr);
    starterLP = makeLP(880, 0.707, sr);
    const bodyF = clamp(88 / Math.pow(char.size, 0.22), 40, 160);
    bodyA = 1 - Math.exp((-2 * Math.PI * bodyF) / sr);
  }

  build();

  let rpmS = initial.idle;
  let thS = 0;
  let combS = 0;
  let fireAcc = 0;
  let fireIndex = 0;
  let didSingle = false;
  let pulseLeft = 0;
  let pulseLen = 1;
  let pulseAmp = 0;
  let popLeft = 0;
  let popLen = 1;
  let popAmp = 0;
  let popLatch = false;
  let popBoom = 0;
  let popPh = 0;
  let puffEnv = 0;
  let crank = 0;
  let whistle = 0;
  let starterPh = 0;
  let spool = 0;
  let bov = 0;
  let flutter = 0;
  let flutterPh = 0;
  let body = 0;
  let gasLp = 0;
  let dcX = 0;
  let dcY = 0;
  let env = 0;
  let prevTh = 0;
  let rng = 0x6d2b79f5;
  const gasLpA = 1 - Math.exp((-2 * Math.PI * 150) / sr);

  function rnd() {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return rng / 4294967296;
  }

  function triggerFire(rpm: number, throttle: number, combust: number, limiter: boolean, cyl: number) {
    fireIndex += 1;
    if (limiter && fireIndex % 4 === 0) {
      if ((fireIndex & 7) === 0) triggerPop(0.7 + (fireIndex % 3) * 0.15);
      return;
    }
    const open =
      (0.0021 + 0.0054 * throttle) *
      Math.min(1, 2400 / Math.max(220, rpm)) *
      CYL_LEN[cyl] *
      (0.82 + 0.18 * char.size);
    pulseLen = Math.max(6, Math.floor(sr * open));
    pulseLeft = pulseLen;
    const load = 0.22 + 0.78 * throttle;
    // Overlap grows with rpm; pull each pulse down so high revs get louder, not exploded.
    const rateComp = Math.pow(Math.max(rpm, char.idle) / 1600, -0.38);
    pulseAmp =
      combust *
      load *
      CYL_AMP[cyl] *
      rateComp *
      (0.42 + 0.2 * Math.min(1, char.size)) *
      0.55;
    puffEnv = Math.max(puffEnv, (0.35 + 0.8 * throttle) * combust);
  }

  function triggerPop(strength: number) {
    popAmp = 0.25 + strength * 0.42;
    popLen = Math.floor(sr * (0.018 + 0.045 * Math.min(strength, 1.6)));
    popLeft = popLen;
    popBoom = Math.min(1.4, 0.35 + strength * 0.7);
  }

  function clearRes() {
    for (const r of resonators) r.y1 = r.y2 = 0;
  }

  const voice: Voice = {
    makeup: 1,
    compress: true,
    clip: true,
    setCharacter(c) {
      char = c;
      build();
    },
    reset() {
      rpmS = char.idle;
      thS = 0;
      combS = 0;
      fireAcc = 0;
      fireIndex = 0;
      didSingle = false;
      pulseLeft = 0;
      popLeft = 0;
      popLatch = false;
      popBoom = 0;
      popPh = 0;
      puffEnv = 0;
      crank = 0;
      whistle = 0;
      starterPh = 0;
      spool = 0;
      bov = 0;
      flutter = 0;
      flutterPh = 0;
      body = 0;
      gasLp = 0;
      dcX = 0;
      dcY = 0;
      env = 0;
      prevTh = 0;
      clearRes();
      clearBiq(outLP);
      clearBiq(tickHP);
      clearBiq(gasBP);
      clearBiq(chuffBP);
      clearBiq(intakeBP);
      clearBiq(turboBP);
      clearBiq(starterLP);
    },
    prime(p) {
      if (p.spool != null) spool = p.spool;
      if (p.rpm != null) rpmS = p.rpm;
      if (p.fireIndex != null) fireIndex = p.fireIndex;
    },
    process(out, drive) {
      const n = out.length;
      const rpm1 = Math.max(0, drive.rpm);
      const th1 = clamp(drive.throttle, 0, 1);
      const c1 = clamp(drive.combust, 0, 1);
      const starter = clamp(drive.starter, 0, 1);
      const beds = drive.beds !== false;
      const gE = drive.layers.exhaust;
      const gG = drive.layers.gas;
      const gI = drive.layers.intake;
      const gM = drive.layers.mechanical;
      const gT = drive.layers.turbo;
      const turboOn = char.turbo && gT > 0.001;

      if (turboOn && th1 - prevTh < -0.16 && spool > 0.25) {
        bov = Math.max(bov, Math.min(1, (prevTh - th1) * 1.35) * Math.min(1, spool * 1.2));
      }
      prevTh = th1;

      if (drive.pop > 0.5 && !popLatch) {
        triggerPop(drive.pop);
        popLatch = true;
      } else if (drive.pop <= 0.5) popLatch = false;

      retuneBP(intakeBP, clamp(260 + rpm1 * 0.17, 140, 2600), 1.15, sr);
      retuneBP(gasBP, clamp(150 / char.length + rpm1 * 0.028, 70, 760), 0.7, sr);

      const boomF = (62 + char.size * 18) / sr;

      for (let i = 0; i < n; i++) {
        const a = n > 1 ? i / (n - 1) : 1;
        const rpm = rpmS + (rpm1 - rpmS) * a;
        const throttle = thS + (th1 - thS) * a;
        const combust = combS + (c1 - combS) * a;

        const spin = char.turboSpin ?? 1;
        const spoolIn = char.spoolStart ?? 1500;
        const spoolDone = Math.max(spoolIn + 500, char.spoolFull ?? char.redline);
        const spoolTarget = turboOn
          ? Math.max(0, (rpm - spoolIn) / (spoolDone - spoolIn)) * Math.pow(throttle, 0.6)
          : 0;
        const up = spoolUp * clamp(spin, 0.5, 1.55);
        spool += (spoolTarget - spool) * (spoolTarget > spool ? up : spoolDn);

        if (bov > 0.0008) bov *= bovDecay;
        else bov = 0;

        const flutterTarget = turboOn && throttle < 0.08 && spool > 0.42 ? spool : 0;
        flutter += (flutterTarget - flutter) * flutterK;

        crank += rpm / 60 / sr;
        if (crank >= 1) crank -= 1;
        const crankAng = 2 * Math.PI * crank;
        const s1 = Math.sin(crankAng);

        if (drive.single) {
          if (!didSingle) {
            triggerFire(Math.max(rpm, 400), throttle, Math.max(combust, 0.2), false, fireIndex % 3);
            didSingle = true;
          }
        } else if (rpm > 48 && combust > 0.02) {
          fireAcc += 1;
          const cyl = fireIndex % 3;
          const skew = cyl === 0 ? 1.012 : cyl === 1 ? 0.986 : 1.002;
          const interval = ((sr * 40) / rpm) * skew;
          if (fireAcc >= interval) {
            fireAcc -= interval;
            if (drive.pops && throttle < 0.07 && rpm > 2800 && rnd() < 0.16) {
              triggerPop(0.45 + rnd() * 0.7);
            }
            triggerFire(rpm, throttle, combust, drive.limiter, cyl);
          }
        } else {
          fireAcc = 0;
        }

        let exc = 0;
        if (pulseLeft > 0) {
          const u = 1 - pulseLeft / pulseLen;
          const attack = u < 0.07 ? u / 0.07 : 1;
          const envp = attack * Math.exp(-u * 3.1);
          const crack = Math.sin((u * 18 + fireIndex) * 13.7) * Math.exp(-u * 9);
          exc = pulseAmp * (envp + crack * 0.85);
          pulseLeft -= 1;
        }
        if (popLeft > 0) {
          const u = 1 - popLeft / popLen;
          const attack = u < 0.04 ? u / 0.04 : 1;
          const envp = attack * Math.exp(-u * 2.4);
          const crack = Math.sin(u * 90 + fireIndex) * Math.exp(-u * 4.5);
          exc += popAmp * (envp * 0.65 + crack * 0.85);
          popLeft -= 1;
        }

        puffEnv *= puffDecay;

        body += (exc - body) * bodyA;
        let exhaust = body * (1.15 + 0.45 * char.size);

        exhaust += tickBiq(tickHP, exc) * (0.42 + (1 - char.muffler) * 0.38);

        let resSum = 0;
        for (let r = 0; r < resonators.length; r++) {
          const res = resonators[r];
          const y = exc * res.g + res.c * res.y1 - res.r2 * res.y2;
          res.y2 = res.y1;
          res.y1 = y;
          resSum += y;
        }
        // Tame pipe modes when a firing harmonic sits right on them, and add a little bark.
        exhaust += Math.tanh(resSum * 0.7) / 0.7;

        if (popBoom > 0.001) {
          popPh += boomF;
          if (popPh >= 1) popPh -= 1;
          exhaust += Math.sin(2 * Math.PI * popPh) * popBoom * 0.55;
          popBoom *= boomDecay;
        }

        const rockDepth = 0.13 * Math.min(1, 1700 / Math.max(rpm, 180)) * (1 - char.muffler * 0.35);
        const fp = crank * 1.5;
        const frac = fp - Math.floor(fp);
        if (beds && combust > 0.08) {
          const buzz = Math.tanh(2.2 * Math.sin(2 * Math.PI * frac));
          exhaust +=
            buzz *
            (0.2 + 0.34 * throttle) *
            Math.pow(Math.max(rpm, 200) / 2800, 0.45) *
            (0.8 + 0.18 * char.size);
        }
        exhaust *= 1 + rockDepth * s1;
        exhaust *= gE;

        const white = rnd() * 2 - 1;
        gasLp += (white - gasLp) * gasLpA;
        const flow =
          Math.sqrt(Math.max(rpm, 1) / 3200) * (0.18 + 0.82 * throttle) * (0.75 + 0.35 * Math.min(spool, 1));
        const rush = beds ? (gasLp * 0.9 + tickBiq(gasBP, white) * 0.55) * flow : 0;
        const chuff = tickBiq(chuffBP, white * puffEnv) * (0.55 + 0.2 * char.size);
        const gas = (rush * 0.7 + chuff * 1.15) * 1.8 * gG;

        const intakeN = tickBiq(intakeBP, rnd() * 2 - 1);
        const intake = beds
          ? intakeN * Math.pow(throttle, 1.3) * (0.1 + rpm / 8000) * 0.85 * gI +
            s1 * s1 * (1 - throttle) * Math.min(rpm / 2500, 1) * 0.02 * gI
          : 0;

        const teeth = 13 + char.size * 5;
        const whine = beds
          ? Math.sin(crankAng * teeth) * Math.pow(Math.min(rpm / char.redline, 1.05), 1.35) * 0.028
          : 0;
        const cam = beds ? Math.sin(crankAng * 0.5) * Math.min(rpm / 1800, 1) * 0.012 : 0;
        const crankRumble = beds ? s1 * Math.min(rpm / 1600, 1) * 0.018 * char.size : 0;
        const tick = tickBiq(tickHP, exc) * 0.05;
        const mech = (whine + cam + crankRumble + tick) * gM;

        let turbo = 0;
        if (turboOn || bov > 0.001 || spool > 0.002) {
          const spin = char.turboSpin ?? 1;
          const wf = (980 * spin + spool * 5000 * spin + rpm * 0.04) / sr;
          whistle += wf;
          if (whistle >= 1) whistle -= 1;
          const wAng = 2 * Math.PI * whistle;
          let tone = 0;
          if (beds) {
            tone = (Math.sin(wAng) + 0.28 * Math.sin(wAng * 2)) * spool * spool;
          }
          flutterPh += (16 + flutter * 18) / sr;
          if (flutterPh >= 1) flutterPh -= 1;
          let fmod = 1;
          if (flutter > 0.03) {
            const sq = Math.sin(2 * Math.PI * flutterPh) > 0.15 ? 1 : 0.12;
            fmod = 1 - flutter * 0.9 * (1 - sq);
          }
          const hiss = tickBiq(turboBP, rnd() * 2 - 1) * (spool * 0.22 + bov * 0.65);
          const blow = tickBiq(gasBP, rnd() * 2 - 1) * bov * 0.8;
          turbo = (tone * 0.16 * fmod + hiss * fmod + blow) * Math.max(gT, bov > 0 ? 0.85 : 0);
        }

        let starterSig = 0;
        if (starter > 0.001) {
          const sf = (48 + starter * 70 + Math.min(rpm, 420) * 0.28) / sr;
          starterPh += sf;
          if (starterPh >= 1) starterPh -= 1;
          const saw = 2 * (starterPh - Math.floor(starterPh)) - 1;
          starterSig =
            tickBiq(starterLP, saw) * starter * 0.22 + (rnd() * 2 - 1) * starter * starter * 0.05;
        }

        let y = exhaust + gas + intake + mech + turbo + starterSig;
        const x = tickBiq(outLP, y);
        const hp = x - dcX + dcR * dcY;
        dcX = x;
        dcY = hp;
        y = hp * voice.makeup;

        if (voice.compress) {
          const ad = y < 0 ? -y : y;
          env += (ad - env) * (ad > env ? 0.02 : 0.0006);
          if (env > 0.58) y *= 0.58 / env;
        }
        if (voice.clip) {
          if (y > 0.98) y = 0.98;
          else if (y < -0.98) y = -0.98;
        }
        out[i] = y;
      }

      rpmS = rpm1;
      thS = th1;
      combS = c1;
    },
  };

  return voice;
}

const makeupCache = new Map<string, number>();

export function makeupFor(sampleRate: number, c: Character) {
  const quick = c.id === "custom";
  const key = [
    c.id,
    c.idle,
    c.redline,
    c.turbo ? 1 : 0,
    c.size.toFixed(3),
    c.length.toFixed(3),
    c.muffler.toFixed(3),
    c.spoolStart ?? 0,
    c.spoolFull ?? 0,
    (c.turboSpin ?? 1).toFixed(3),
    sampleRate,
    quick ? "q" : "f",
  ].join("|");
  const hit = makeupCache.get(key);
  if (hit != null) return hit;
  const tests = quick
    ? [{ rpm: Math.max(c.idle + 400, Math.min(c.redline * 0.72, 5200)), throttle: 1 }]
    : [
        { rpm: c.idle, throttle: 0.14 },
        { rpm: 2200, throttle: 0.55 },
        { rpm: 3000, throttle: 1 },
        { rpm: Math.min(5200, c.redline * 0.92), throttle: 1 },
        { rpm: c.redline * 0.84, throttle: 1 },
      ];
  const seconds = quick ? 0.32 : 1.05;
  const skip = Math.floor(sampleRate * (quick ? 0.1 : 0.45));
  let peak = 1e-5;
  for (const t of tests) {
    const v = createVoice(sampleRate, c);
    v.compress = false;
    v.clip = false;
    v.makeup = 1;
    const n = Math.floor(sampleRate * seconds);
    const buf = new Float32Array(n);
    v.process(buf, {
      rpm: t.rpm,
      throttle: t.throttle,
      combust: 1,
      limiter: false,
      starter: 0,
      pop: 0,
      pops: false,
      single: false,
      layers: {
        exhaust: 1,
        gas: 1,
        intake: 1,
        mechanical: 1,
        turbo: c.turbo ? 1 : 0,
      },
    });
    const p = peakOf(buf, skip);
    if (p > peak) peak = p;
  }
  const g = 0.72 / peak;
  makeupCache.set(key, g);
  return g;
}

export function renderBlocks(
  sampleRate: number,
  seconds: number,
  c: Character,
  driveAt: (t: number) => Drive,
  opts?: { primeSpool?: number; primeRpm?: number; warmup?: number; makeup?: number },
): Float32Array {
  const v = createVoice(sampleRate, c);
  v.compress = false;
  v.clip = true;
  v.makeup = opts?.makeup ?? makeupFor(sampleRate, c);
  if (opts?.primeSpool != null || opts?.primeRpm != null) {
    v.prime({ spool: opts?.primeSpool, rpm: opts?.primeRpm });
  }
  const warmup = Math.max(0, opts?.warmup ?? 0);
  const total = Math.floor(sampleRate * (seconds + warmup));
  const buf = new Float32Array(total);
  const block = 256;
  for (let i = 0; i < total; i += block) {
    const m = Math.min(block, total - i);
    const t = (i - Math.floor(sampleRate * warmup)) / sampleRate;
    // During warmup, hold the drive at t=0 so resonators settle on the loop's start state.
    v.process(buf.subarray(i, i + m), driveAt(t < 0 ? 0 : t));
  }
  if (warmup <= 0) return buf;
  return buf.subarray(Math.floor(sampleRate * warmup));
}

/** Record a periodic-enough loop and equal-power crossfade the join. */
export function renderLoop(
  sampleRate: number,
  seconds: number,
  c: Character,
  drive: Drive,
  opts?: { primeSpool?: number },
): Float32Array {
  const rpm = Math.max(drive.rpm, 1);
  const fires = Math.max(3, Math.round((rpm / 40) * seconds));
  const aligned = Math.max(3, fires - (fires % 3));
  const n = Math.max(8, Math.round((aligned * 40 * sampleRate) / rpm));
  const fade = Math.floor(sampleRate * 0.04);
  const warmupN = Math.min(sampleRate, n);
  const v = createVoice(sampleRate, c);
  v.compress = false;
  v.clip = true;
  v.makeup = makeupFor(sampleRate, c);
  v.prime({ spool: opts?.primeSpool, rpm: drive.rpm });
  const buf = new Float32Array(warmupN + n + fade);
  const block = 256;
  for (let i = 0; i < buf.length; i += block) {
    const m = Math.min(block, buf.length - i);
    v.process(buf.subarray(i, i + m), drive);
  }
  return crossfadeLoop(buf.subarray(warmupN), fade);
}

export function crossfadeLoop(rec: Float32Array, fade: number): Float32Array {
  const n = rec.length - fade;
  if (n < fade + 8) return rec.slice();
  const out = new Float32Array(n);
  out.set(rec.subarray(0, n));
  for (let i = 0; i < fade; i++) {
    const w = i / fade;
    out[i] = out[i] * w + rec[n + i] * (1 - w);
  }
  return out;
}

export function fadeEdges(x: Float32Array, sampleRate: number, inSec = 0.006, outSec = 0.04) {
  const inn = Math.min(x.length, Math.floor(sampleRate * inSec));
  const outn = Math.min(x.length, Math.floor(sampleRate * outSec));
  for (let i = 0; i < inn; i++) x[i] *= i / inn;
  for (let i = 0; i < outn; i++) x[x.length - 1 - i] *= i / outn;
  return x;
}

export function peakOf(x: Float32Array, from = 0) {
  let p = 1e-8;
  for (let i = from; i < x.length; i++) {
    const a = x[i] < 0 ? -x[i] : x[i];
    if (a > p) p = a;
  }
  return p;
}

export function normalizePeak(x: Float32Array, peak = 0.89) {
  const p = peakOf(x);
  const g = peak / p;
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return x;
}

export const EXPORT_RATE = 48000;
