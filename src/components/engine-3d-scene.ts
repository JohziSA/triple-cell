import {
  ACESFilmicToneMapping,
  AmbientLight,
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PointLight,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
  type Material,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Build } from "@/lib/engine/dyno";
import type { Session } from "@/lib/engine/session";

const PIN = [0, 240, 120];
const FIRE = [0, 240, 480];
const ROD_RATIO = 3.4;

const up = new Vector3(0, 1, 0);
const rodDir = new Vector3();

function mod(n: number, m: number) {
  return ((n % m) + m) % m;
}

function valve(cycle: number, open: number, close: number) {
  if (cycle < open || cycle > close) return 0;
  return Math.sin((Math.PI * (cycle - open)) / (close - open));
}

function disposeTree(root: Object3D) {
  const geometries = new Set<object>();
  const materials = new Set<Material>();
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (mesh.geometry && !geometries.has(mesh.geometry)) {
      geometries.add(mesh.geometry);
      mesh.geometry.dispose();
    }
    const material = mesh.material as Material | Material[] | undefined;
    const list = Array.isArray(material) ? material : material ? [material] : [];
    for (const item of list) {
      if (!materials.has(item)) {
        materials.add(item);
        item.dispose();
      }
    }
  });
}

type Rig = {
  root: Group;
  webs: Group[];
  pistons: Group[];
  rods: Mesh[];
  inValves: Group[];
  exValves: Group[];
  flames: Mesh[];
  turbo: Group | null;
  radius: number;
  rod: number;
  wristDrop: number;
  deck: number;
};

function makeRig(build: Build): Rig {
  const bore = Math.min(100, Math.max(64, build.boreMm));
  const stroke = Math.min(120, Math.max(68, build.strokeMm));
  const radius = stroke / 2;
  const rod = radius * ROD_RATIO;
  const pistonH = bore * 0.78;
  const wristDrop = pistonH * 0.62;
  const clearance = Math.max(5, stroke * 0.09);
  const wristTdc = radius + rod;
  const deck = wristTdc + wristDrop + clearance;
  const spacing = bore * 1.22 + 16;
  const linerBottom = wristTdc - stroke - pistonH * 0.45;
  const span = spacing * 2 + bore * 1.35;

  const root = new Group();
  const blockMat = new MeshStandardMaterial({ color: 0x3a342c, metalness: 0.72, roughness: 0.38 });
  const alum = new MeshStandardMaterial({ color: 0xe6e0d4, metalness: 0.55, roughness: 0.34 });
  const steel = new MeshStandardMaterial({ color: 0x6d675e, metalness: 0.88, roughness: 0.32 });
  const dark = new MeshStandardMaterial({ color: 0x171410, metalness: 0.4, roughness: 0.7 });
  const glass = new MeshStandardMaterial({
    color: 0x9a9388,
    metalness: 0.2,
    roughness: 0.08,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });
  const hot = new MeshStandardMaterial({
    color: 0xe23d2b,
    emissive: 0xe23d2b,
    emissiveIntensity: 0,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });

  const sump = new Mesh(new BoxGeometry(span, radius * 0.7, bore * 1.7), dark);
  sump.position.set(0, -radius * 1.85, 0);
  root.add(sump);

  const rear = new Mesh(new BoxGeometry(span, deck + radius * 1.6, bore * 0.22), blockMat);
  rear.position.set(0, (deck - radius) / 2, -bore * 0.82);
  root.add(rear);

  const cheekGeo = new BoxGeometry(bore * 0.16, deck * 0.72, bore * 1.05);
  const leftCheek = new Mesh(cheekGeo, blockMat);
  leftCheek.position.set(-spacing - bore * 0.78, deck * 0.28, 0);
  const rightCheek = new Mesh(cheekGeo, blockMat);
  rightCheek.position.set(spacing + bore * 0.78, deck * 0.28, 0);
  root.add(leftCheek, rightCheek);

  const head = new Mesh(new BoxGeometry(span * 0.98, bore * 0.42, bore * 1.2), blockMat);
  head.position.set(0, deck + bore * 0.21, 0);
  root.add(head);

  const cover = new Mesh(new BoxGeometry(span * 0.86, bore * 0.14, bore * 0.72), alum);
  cover.position.set(0, deck + bore * 0.49, bore * 0.08);
  root.add(cover);

  const intake = new Mesh(new BoxGeometry(span * 0.92, bore * 0.22, bore * 0.32), alum);
  intake.position.set(0, deck + bore * 0.52, -bore * 0.42);
  root.add(intake);

  const throttle = new Mesh(new CylinderGeometry(bore * 0.16, bore * 0.16, bore * 0.22, 16), alum);
  throttle.rotation.z = Math.PI / 2;
  throttle.position.set(-span * 0.46, deck + bore * 0.52, -bore * 0.42);
  root.add(throttle);

  const shaft = new Mesh(new CylinderGeometry(Math.max(7, bore * 0.13), Math.max(7, bore * 0.13), span * 0.92, 20), steel);
  shaft.rotation.z = Math.PI / 2;
  root.add(shaft);

  const linerH = Math.max(10, deck - linerBottom);
  const linerGeo = new CylinderGeometry(bore / 2 + 1.6, bore / 2 + 1.6, linerH, 28, 1, true);
  const pistonGeo = new CylinderGeometry(bore / 2 - 1.1, bore / 2 - 1.1, pistonH, 28);
  const ringGeo = new CylinderGeometry(bore / 2 - 0.4, bore / 2 - 0.4, 1.4, 28);
  const webGeo = new BoxGeometry(bore * 0.16, radius * 1.85, radius * 0.72);
  const pinGeo = new CylinderGeometry(Math.max(4.5, bore * 0.09), Math.max(4.5, bore * 0.09), bore * 0.28, 12);
  const rodGeo = new CylinderGeometry(Math.max(3.2, bore * 0.055), Math.max(3.2, bore * 0.055), 1, 10);
  const stemGeo = new CylinderGeometry(1.5, 1.5, bore * 0.34, 8);
  const headGeo = new CylinderGeometry(bore * 0.11, bore * 0.11, 1.6, 12);

  const webs: Group[] = [];
  const pistons: Group[] = [];
  const rods: Mesh[] = [];
  const inValves: Group[] = [];
  const exValves: Group[] = [];
  const flames: Mesh[] = [];

  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * spacing;

    const liner = new Mesh(linerGeo, glass);
    liner.position.set(x, (deck + linerBottom) / 2, 0);
    liner.renderOrder = 2;
    root.add(liner);

    const piston = new Group();
    const skirt = new Mesh(pistonGeo, alum);
    skirt.position.y = pistonH / 2 - (pistonH - wristDrop);
    piston.add(skirt);
    const ring = new Mesh(ringGeo, dark);
    ring.position.y = skirt.position.y + pistonH * 0.28;
    piston.add(ring);
    const wrist = new Mesh(new SphereGeometry(bore * 0.07, 12, 8), steel);
    piston.add(wrist);
    root.add(piston);
    pistons.push(piston);

    const rodMesh = new Mesh(rodGeo, steel);
    root.add(rodMesh);
    rods.push(rodMesh);

    const web = new Group();
    web.position.x = x;
    const cheek = new Mesh(webGeo, steel);
    cheek.position.y = radius * 0.15;
    web.add(cheek);
    const pin = new Mesh(pinGeo, new MeshStandardMaterial({ color: 0xf0a202, metalness: 0.7, roughness: 0.3 }));
    pin.rotation.z = Math.PI / 2;
    pin.position.y = radius;
    web.add(pin);
    root.add(web);
    webs.push(web);

    const flame = new Mesh(new SphereGeometry(bore * 0.22, 12, 8), hot.clone());
    flame.position.set(x, deck - 2, 0);
    flame.renderOrder = 3;
    root.add(flame);
    flames.push(flame);

    for (const [list, side] of [
      [inValves, -1],
      [exValves, 1],
    ] as const) {
      const valveGroup = new Group();
      valveGroup.position.set(x + side * bore * 0.2, deck, side * bore * 0.05);
      const stem = new Mesh(stemGeo, alum);
      stem.position.y = bore * 0.12;
      valveGroup.add(stem);
      const disk = new Mesh(headGeo, side < 0 ? alum : steel);
      valveGroup.add(disk);
      root.add(valveGroup);
      list.push(valveGroup);
    }
  }

  let turbo: Group | null = null;
  if (build.turbo) {
    turbo = new Group();
    turbo.position.set(spacing + bore * 0.95, deck * 0.55, bore * 0.15);
    const house = new Mesh(new TorusGeometry(bore * 0.42, bore * 0.13, 12, 24), steel);
    house.rotation.y = Math.PI / 2;
    turbo.add(house);
    const wheel = new Group();
    wheel.name = "wheel";
    for (let b = 0; b < 6; b++) {
      const blade = new Mesh(new BoxGeometry(1.3, bore * 0.34, bore * 0.07), alum);
      const spin = (b / 6) * Math.PI * 2;
      blade.position.set(0, Math.cos(spin) * bore * 0.16, Math.sin(spin) * bore * 0.16);
      blade.rotation.x = spin;
      wheel.add(blade);
    }
    turbo.add(wheel);
    root.add(turbo);
  }

  const blot = new Mesh(
    new CircleGeometry(span * 0.72, 32),
    new MeshStandardMaterial({ color: 0x000000, transparent: true, opacity: 0.35, roughness: 1, metalness: 0 }),
  );
  blot.rotation.x = -Math.PI / 2;
  blot.position.y = -radius * 2.2;
  root.add(blot);

  return { root, webs, pistons, rods, inValves, exValves, flames, turbo, radius, rod, wristDrop, deck };
}

function pose(rig: Rig, angle: number, throttle: number, combust: number, running: boolean) {
  for (let i = 0; i < 3; i++) {
    const theta = (mod(angle - PIN[i], 360) * Math.PI) / 180;
    const pinY = rig.radius * Math.cos(theta);
    const pinZ = rig.radius * Math.sin(theta);
    const reach = Math.sqrt(Math.max(1, rig.rod * rig.rod - pinZ * pinZ));
    const wristY = pinY + reach;
    const x = rig.webs[i].position.x;

    rig.webs[i].rotation.x = theta;
    rig.pistons[i].position.set(x, wristY, 0);

    const ax = x;
    const ay = pinY;
    const az = pinZ;
    rodDir.set(0, wristY - ay, -az);
    const len = Math.max(0.001, rodDir.length());
    rig.rods[i].position.set(ax, (ay + wristY) / 2, az / 2);
    rig.rods[i].scale.set(1, len, 1);
    rig.rods[i].quaternion.setFromUnitVectors(up, rodDir.multiplyScalar(1 / len));

    const cycle = mod(angle - FIRE[i], 720);
    const inLift = valve(cycle, 350, 560) * 7;
    const exLift = valve(cycle, 130, 370) * 7;
    rig.inValves[i].position.y = rig.deck - inLift;
    rig.exValves[i].position.y = rig.deck - exLift;

    const flame = running && combust > 0.2 && cycle < 100 ? (1 - cycle / 100) * combust * (0.4 + 0.6 * throttle) : 0;
    const mat = rig.flames[i].material as MeshStandardMaterial;
    mat.emissiveIntensity = flame * 2.4;
    mat.opacity = flame * 0.85;
    rig.flames[i].scale.setScalar(0.45 + flame);
  }
}

export function mountEngine(host: HTMLElement, session: Session, getBuild: () => Build) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x100e0c, 1);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none";
  renderer.domElement.setAttribute("role", "img");
  renderer.domElement.setAttribute("aria-label", "Three-dimensional inline-3. Drag to orbit.");
  host.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(34, 1, 0.5, 4000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.92;
  controls.minDistance = 80;
  controls.maxDistance = 900;

  scene.add(new AmbientLight(0xf3ecdf, 0.62));
  const key = new DirectionalLight(0xfff6e8, 3.1);
  key.position.set(90, 180, 140);
  scene.add(key);
  const fill = new DirectionalLight(0xc8c2b6, 1.15);
  fill.position.set(-120, 60, 40);
  scene.add(fill);
  const front = new DirectionalLight(0xffe7c2, 1.6);
  front.position.set(30, 20, 220);
  scene.add(front);
  const fireLight = new PointLight(0xe23d2b, 0, 180);
  scene.add(fireLight);

  let rig = makeRig(getBuild());
  scene.add(rig.root);
  const first = getBuild();
  let keySig = `${first.boreMm.toFixed(1)}|${first.strokeMm.toFixed(1)}|${first.turbo ? 1 : 0}`;

  const home = () => {
    const bore = Math.min(100, Math.max(64, getBuild().boreMm));
    const yMin = -rig.radius * 2.35;
    const yMax = rig.deck + bore * 0.72;
    const focusY = (yMin + yMax) / 2;
    const halfH = (yMax - yMin) / 2;
    const look = (halfH * 1.14) / Math.tan((camera.fov * Math.PI) / 360);
    const dx = 0.86;
    const dy = 0.2;
    const dz = 0.58;
    const len = Math.hypot(dx, dy, dz);
    camera.position.set((dx / len) * look, focusY + (dy / len) * look, (dz / len) * look);
    controls.target.set(0, focusY, 0);
    controls.minDistance = look * 0.4;
    controls.maxDistance = look * 3.2;
    controls.update();
  };
  home();

  const onDouble = () => home();
  renderer.domElement.addEventListener("dblclick", onDouble);

  const fit = () => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  };
  fit();
  const observer = new ResizeObserver(fit);
  observer.observe(host);

  let turboAng = 0;
  let last = performance.now();
  let frame = 0;
  const loop = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const build = getBuild();
    const sig = `${build.boreMm.toFixed(1)}|${build.strokeMm.toFixed(1)}|${build.turbo ? 1 : 0}`;
    if (sig !== keySig) {
      keySig = sig;
      scene.remove(rig.root);
      disposeTree(rig.root);
      rig = makeRig(build);
      scene.add(rig.root);
      controls.minDistance = Math.max(70, rig.deck * 0.35);
      controls.maxDistance = rig.deck * 8;
    }
    const live = session.live;
    const running = session.getMode() !== "off";
    pose(rig, live.crank, live.throttle, live.combust, running);
    const spoolIn = 1200 + build.inducerMm * 48;
    const spool = build.turbo
      ? Math.max(0, Math.min(1, (live.rpm - spoolIn * 0.42) / spoolIn)) * Math.pow(Math.max(live.throttle, 0), 0.55)
      : 0;
    if (rig.turbo) {
      const wheel = rig.turbo.getObjectByName("wheel");
      if (running) turboAng += (2 + spool * 46) * dt;
      if (wheel) wheel.rotation.x = turboAng;
      rig.turbo.visible = true;
    }
    let glow = 0;
    for (let i = 0; i < 3; i++) {
      const cycle = mod(live.crank - FIRE[i], 720);
      const hot = running && live.combust > 0.2 && cycle < 80 ? (1 - cycle / 80) * live.combust : 0;
      if (hot > glow) {
        glow = hot;
        fireLight.position.copy(rig.flames[i].position);
      }
    }
    fireLight.intensity = glow * 18;
    controls.update();
    renderer.render(scene, camera);
    frame = requestAnimationFrame(loop);
  };
  frame = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    renderer.domElement.removeEventListener("dblclick", onDouble);
    controls.dispose();
    disposeTree(rig.root);
    key.dispose();
    fill.dispose();
    front.dispose();
    fireLight.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}
