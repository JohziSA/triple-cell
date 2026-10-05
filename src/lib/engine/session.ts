import { assetsFor, integrationText, makeDrive, shutdownDrive, shutdownSeconds, startupDrive, STARTUP_SEC, type Asset } from "./catalog";
import {
  FULL_LAYERS,
  PRESETS,
  createVoice,
  makeupFor,
  type Character,
  type Drive,
  type Layers,
  type PresetId,
  type Voice,
} from "./i3-dsp";
import { downloadBytes, encodeWav, textBytes, zipFiles } from "./wav";

export type Mode = "off" | "start" | "run" | "stop";

export type Live = {
  rpm: number;
  throttle: number;
  combust: number;
  starter: number;
  limiter: boolean;
  pops: boolean;
  pop: number;
  crank: number;
  layers: Layers;
};

export type Session = {
  live: Live;
  getMode: () => Mode;
  getCharacter: () => Character;
  step: (dt: number) => void;
  unlock: () => void;
  ignition: () => void;
  setHeld: (held: boolean) => void;
  setPreset: (id: PresetId) => void;
  setCharacter: (next: Character) => void;
  setLayer: (key: keyof Layers, value: number) => void;
  setVolume: (value: number) => void;
  getAnalyser: () => AnalyserNode | null;
  isHeld: () => boolean;
  audioNote: () => string;
  play: (pcm: Float32Array, loop: boolean) => boolean;
  stopPlay: () => void;
  downloadAsset: (asset: Asset) => { name: string; url: string };
  downloadKit: (onProgress: (label: string) => void) => Promise<{ name: string; url: string }>;
};

export function createSession(): Session {
  const live: Live = {
    rpm: 0,
    throttle: 0,
    combust: 0,
    starter: 0,
    limiter: false,
    pops: false,
    pop: 0,
    crank: 18,
    layers: { ...FULL_LAYERS },
  };

  let mode: Mode = "off";
  let modeT = 0;
  let held = false;
  let rpm = 0;
  let throttle = 0;
  let stopFrom = 0;
  let character: Character = PRESETS.sports;

  let ctx: AudioContext | null = null;
  let voice: Voice | null = null;
  let master: GainNode | null = null;
  let previewGain: GainNode | null = null;
  let analyser: AnalyserNode | null = null;
  let preview: AudioBufferSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let volume = 0.8;
  let note = "";
  let makeupTimer = 0;
  let pumped = false;

  function applyLive(d: Drive) {
    live.rpm = d.rpm;
    live.throttle = d.throttle;
    live.combust = d.combust;
    live.starter = d.starter;
    live.limiter = d.limiter;
    live.pops = d.pops;
    live.pop = d.pop;
  }

  function silence() {
    applyLive(makeDrive(0, { throttle: 0, combust: 0, layers: live.layers }));
  }

  function step(dt: number) {
    const c = character;
    if (mode === "start") {
      modeT += dt;
      if (modeT >= STARTUP_SEC) {
        mode = "run";
        rpm = c.idle;
        throttle = held ? 1 : 0.08;
        live.limiter = false;
        live.pop = 0;
        live.pops = false;
        live.starter = 0;
        live.combust = 1;
        live.rpm = rpm;
        live.throttle = throttle;
      } else {
        applyLive(startupDrive(modeT, c, live.layers));
      }
    } else if (mode === "stop") {
      modeT += dt;
      const dur = shutdownSeconds(stopFrom);
      if (modeT >= dur) {
        mode = "off";
        rpm = 0;
        throttle = 0;
        silence();
      } else {
        applyLive(shutdownDrive(modeT, stopFrom, live.layers));
      }
    } else if (mode === "run") {
      const target = held ? 1 : 0;
      throttle += (target - throttle) * Math.min(1, dt * 9);
      if (held) {
        rpm += (2200 + 5600 * throttle) * dt;
        if (rpm >= c.redline - 30) {
          const bounce = 0.5 + 0.5 * Math.sin(performance.now() / 38);
          rpm = c.redline - 20 - bounce * 230;
          live.limiter = true;
        } else {
          live.limiter = false;
        }
      } else {
        live.limiter = false;
        rpm -= (1100 + rpm * 0.45) * dt;
        if (rpm < c.idle) rpm = c.idle;
      }
      live.rpm = rpm;
      live.throttle = throttle;
      live.combust = 1;
      live.starter = 0;
      live.pop = 0;
      live.pops = throttle < 0.08 && rpm > 2900;
    } else {
      silence();
    }
    if (live.rpm > 1) live.crank = (live.crank + live.rpm * 6 * dt) % 720;
  }

  function currentDrive(): Drive {
    return {
      rpm: live.rpm,
      throttle: live.throttle,
      combust: live.combust,
      limiter: live.limiter,
      starter: live.starter,
      pop: live.pop,
      pops: live.pops,
      single: false,
      beds: true,
      layers: live.layers,
    };
  }

  function scheduleMakeup() {
    if (typeof window === "undefined" || !voice || !ctx) return;
    window.clearTimeout(makeupTimer);
    const sr = ctx.sampleRate;
    const snap = character;
    makeupTimer = window.setTimeout(() => {
      if (!voice) return;
      try {
        voice.makeup = makeupFor(sr, snap);
      } catch {
        /* keep the provisional gain */
      }
    }, 40);
  }

  function wireVoice(context: AudioContext) {
    master = context.createGain();
    master.gain.value = volume * volume;
    previewGain = context.createGain();
    analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.72;
    previewGain.connect(master);
    master.connect(analyser);
    analyser.connect(context.destination);

    voice = createVoice(context.sampleRate, character);
    voice.compress = true;
    voice.clip = true;
    voice.makeup = 0.32;
    scheduleMakeup();

    try {
      const proc = context.createScriptProcessor(2048, 0, 1);
      processor = proc;
      proc.onaudioprocess = (event) => {
        const out = event.outputBuffer.getChannelData(0);
        const v = voice;
        if (!v || mode === "off") {
          out.fill(0);
          return;
        }
        v.process(out, currentDrive());
      };
      proc.connect(master);
    } catch {
      processor = null;
      startPump(context);
    }
  }

  function startPump(context: AudioContext) {
    if (pumped) return;
    pumped = true;
    let next = 0;
    const tick = () => {
      if (!ctx || !voice || !master) return;
      if (mode !== "off" && next - context.currentTime < 0.22) {
        const seconds = 0.12;
        const n = Math.max(1, Math.floor(context.sampleRate * seconds));
        const data = new Float32Array(n);
        voice.process(data, currentDrive());
        const buffer = context.createBuffer(1, n, context.sampleRate);
        buffer.copyToChannel(data, 0);
        const src = context.createBufferSource();
        src.buffer = buffer;
        src.connect(master);
        const when = Math.max(context.currentTime + 0.03, next);
        src.start(when);
        next = when + seconds;
      }
      window.setTimeout(tick, 40);
    };
    window.setTimeout(tick, 0);
  }

  function unlock() {
    if (typeof window === "undefined") return;
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) {
      note = "This browser cannot play sound.";
      return;
    }
    try {
      if (!ctx) {
        try {
          ctx = new AC({ latencyHint: "interactive" });
        } catch {
          ctx = new AC();
        }
        if (ctx.state === "suspended") void ctx.resume();
        const silent = ctx.createBuffer(1, 1, ctx.sampleRate);
        const kick = ctx.createBufferSource();
        kick.buffer = silent;
        kick.connect(ctx.destination);
        kick.start();
        wireVoice(ctx);
      } else if (ctx.state === "suspended") {
        void ctx.resume();
      }
      if (!note.startsWith("Could not")) note = "";
    } catch {
      note = "Could not start audio. Tap the button again.";
      ctx = null;
      voice = null;
      master = null;
      processor = null;
    }
  }

  function ignition() {
    unlock();
    if (mode === "off" || mode === "stop") {
      mode = "start";
      modeT = 0;
      rpm = 0;
      return;
    }
    stopFrom = Math.max(live.rpm, character.idle * 0.5);
    mode = "stop";
    modeT = 0;
    held = false;
  }

  function setHeld(next: boolean) {
    if (next) unlock();
    held = next;
    if (next && mode === "off") ignition();
  }

  function setCharacter(next: Character) {
    character = next;
    if (voice) {
      voice.setCharacter(character);
      scheduleMakeup();
    }
    if (mode === "run") rpm = Math.max(character.idle, Math.min(rpm, character.redline));
  }

  function setPreset(id: PresetId) {
    setCharacter(PRESETS[id]);
  }

  function setLayer(key: keyof Layers, value: number) {
    live.layers[key] = value;
  }

  function setVolume(value: number) {
    volume = value;
    if (master && ctx) master.gain.setTargetAtTime(value * value, ctx.currentTime, 0.03);
  }

  function stopPlay() {
    if (preview) {
      try {
        preview.stop();
      } catch {
        /* already stopped */
      }
      preview.disconnect();
      preview = null;
    }
  }

  function bufferFrom(context: AudioContext, pcm: Float32Array, fromRate: number) {
    const copy = new Float32Array(pcm);
    try {
      const buffer = context.createBuffer(1, copy.length, fromRate);
      buffer.copyToChannel(copy, 0);
      return buffer;
    } catch {
      const toRate = context.sampleRate;
      const n = Math.max(1, Math.round((copy.length * toRate) / fromRate));
      const out = new Float32Array(n);
      const last = copy.length - 1;
      for (let i = 0; i < n; i++) {
        const x = (i * fromRate) / toRate;
        const i0 = Math.min(last, Math.floor(x));
        const i1 = Math.min(last, i0 + 1);
        const f = x - i0;
        out[i] = copy[i0] * (1 - f) + copy[i1] * f;
      }
      const buffer = context.createBuffer(1, n, toRate);
      buffer.copyToChannel(out, 0);
      return buffer;
    }
  }

  function play(pcm: Float32Array, loop: boolean) {
    unlock();
    if (!ctx || !previewGain) return false;
    stopPlay();
    const buffer = bufferFrom(ctx, pcm, 48000);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = loop;
    src.connect(previewGain);
    src.onended = () => {
      if (preview === src) preview = null;
    };
    src.start();
    preview = src;
    return true;
  }

  function downloadAsset(asset: Asset) {
    const { pcm } = asset.render(character);
    const name = asset.path.split("/").pop() ?? "sample.wav";
    return { name, url: downloadBytes(encodeWav(pcm, 48000), name, "audio/wav") };
  }

  async function downloadKit(onProgress: (label: string) => void) {
    const assets = assetsFor(character);
    const files: Record<string, Uint8Array> = {};
    const manifestFiles = [];
    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      onProgress(`${i + 1} / ${assets.length} · ${asset.name}`);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const rendered = asset.render(character);
      files[`triple-cell/${asset.path}`] = encodeWav(rendered.pcm, 48000);
      manifestFiles.push({
        file: asset.path,
        name: asset.name,
        group: asset.group,
        loop: asset.loop,
        mixGain: rendered.mixGain,
      });
    }
    const manifest = {
      engine: "inline-3",
      cycle: "4-stroke",
      firing: "even, 240 crank degrees",
      firingOrder: [1, 2, 3],
      firingHz: "rpm / 40",
      sampleRate: 48000,
      channels: 1,
      bits: 16,
      preset: character.id,
      label: character.label,
      idleRpm: character.idle,
      redlineRpm: character.redline,
      turbo: character.turbo,
      note: character.note ?? "",
      files: manifestFiles,
    };
    files["triple-cell/manifest.json"] = textBytes(JSON.stringify(manifest, null, 2));
    files["triple-cell/INTEGRATION.txt"] = textBytes(integrationText(character));
    onProgress("Packing the kit…");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const zipped = zipFiles(files);
    const name = `triple-cell-${character.id}.zip`;
    const url = downloadBytes(zipped, name, "application/zip");
    onProgress("");
    return { name, url };
  }

  return {
    live,
    getMode: () => mode,
    getCharacter: () => character,
    step,
    unlock,
    ignition,
    setHeld,
    setPreset,
    setCharacter,
    setLayer,
    setVolume,
    getAnalyser: () => analyser,
    isHeld: () => held,
    audioNote: () => {
      if (ctx?.state === "suspended") return "Sound is blocked. Tap Start motor again.";
      return note;
    },
    play,
    stopPlay,
    downloadAsset,
    downloadKit,
  };
}
