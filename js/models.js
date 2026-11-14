// Lightweight procedural 3D models built from primitives.
// Geometries are shared between instances to keep memory low.

import * as THREE from '../lib/three.module.min.js';
import { mulberry32 } from './rng.js';

const G = {};
function geo(key, make) {
  if (!G[key]) G[key] = make();
  return G[key];
}

const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _eu = new THREE.Euler(), _p3 = new THREE.Vector3(), _s3 = new THREE.Vector3();
// Merge several primitive geometries (with transforms) into one, so a
// multi-part prop costs a single draw call per material.
export function mergeGeos(parts) {
  const pos = [], nor = [], uv = [], idx = [];
  let base = 0;
  for (const p of parts) {
    _eu.set(...(p.rot || [0, 0, 0]));
    _q.setFromEuler(_eu);
    _p3.set(...(p.pos || [0, 0, 0]));
    _s3.set(...(p.scale || [1, 1, 1]));
    _m4.compose(_p3, _q, _s3);
    const c = p.g.clone();
    c.applyMatrix4(_m4);
    const P = c.attributes.position, Nn = c.attributes.normal, U = c.attributes.uv;
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i), P.getY(i), P.getZ(i));
      nor.push(Nn.getX(i), Nn.getY(i), Nn.getZ(i));
      if (U) uv.push(U.getX(i), U.getY(i)); else uv.push(0, 0);
    }
    if (c.index) for (let i = 0; i < c.index.count; i++) idx.push(base + c.index.getX(i));
    else for (let i = 0; i < P.count; i++) idx.push(base + i);
    base += P.count;
    c.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(base > 65000 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

export const sharedGeo = {
  panel: () => geo('panel', () => new THREE.BoxGeometry(1.2, 0.03, 0.6)),
};

function mesh(g, m, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

// ── Filing cabinet with one lootable drawer (front faces +z) ──
export function cabinet(M) {
  const grp = new THREE.Group();
  const front = new THREE.BoxGeometry(0.46, 0.27, 0.025);
  const handle = new THREE.BoxGeometry(0.14, 0.025, 0.03);
  const bodyG = geo('cabStatic', () => mergeGeos([
    { g: new THREE.BoxGeometry(0.5, 1.05, 0.6), pos: [0, 0.525, 0] },
    { g: front, pos: [0, 0.22, 0.31] }, { g: front, pos: [0, 0.52, 0.31] },
  ]));
  const handlesG = geo('cabHandles', () => mergeGeos([{ g: handle, pos: [0, 0.27, 0.335] }, { g: handle, pos: [0, 0.57, 0.335] }]));
  grp.add(mesh(bodyG, M.metal), mesh(handlesG, M.handle));
  const drawer = new THREE.Group();
  drawer.position.set(0, 0.85, 0);
  const drawerG = geo('cabDrawer', () => mergeGeos([{ g: front, pos: [0, 0, 0.31] }, { g: new THREE.BoxGeometry(0.42, 0.2, 0.52), pos: [0, -0.01, 0.04] }]));
  drawer.add(mesh(drawerG, M.metal));
  drawer.add(mesh(geo('cabHandle', () => handle), M.handle, 0, 0.05, 0.335));
  grp.add(drawer);
  return { group: grp, drawer };
}

// ── Bed (long axis along x) with optional hidden monster ──
export function bed(M) {
  const grp = new THREE.Group();
  const leg = new THREE.BoxGeometry(0.06, 0.1, 0.06);
  grp.add(mesh(geo('bedFrameAll', () => mergeGeos([
    { g: new THREE.BoxGeometry(2.0, 0.3, 1.0), pos: [0, 0.25, 0] },
    { g: new THREE.BoxGeometry(0.06, 0.95, 1.0), pos: [-1.0, 0.48, 0] },
    ...[[-0.95, -0.45], [0.95, -0.45], [-0.95, 0.45], [0.95, 0.45]].map(([x, z]) => ({ g: leg, pos: [x, 0.05, z] })),
  ])), M.wood));
  const mattress = mesh(geo('mattress', () => new THREE.BoxGeometry(1.9, 0.16, 0.92)), M.mattress, 0.02, 0.48, 0);
  grp.add(mattress);
  grp.add(mesh(geo('pillow', () => new THREE.BoxGeometry(0.35, 0.09, 0.62)), M.pillow, -0.72, 0.6, 0));
  const blanket = mesh(geo('blanket', () => new THREE.BoxGeometry(1.25, 0.04, 0.98)), M.blanket, 0.33, 0.575, 0);
  grp.add(blanket);

  // the "trap": a bulge under the blanket and a limb hanging off the side
  const trap = new THREE.Group();
  const bulge = mesh(geo('bulge', () => new THREE.SphereGeometry(1, 14, 10)), M.blanket, 0.25, 0.58, 0);
  bulge.scale.set(0.62, 0.13, 0.33);
  trap.add(bulge);
  const limb = new THREE.Group();
  limb.position.set(0.55, 0.52, 0.47);
  const armG = geo('trapArm', () => new THREE.CylinderGeometry(0.022, 0.03, 0.42, 6));
  const a1 = mesh(armG, M.skin, 0, -0.18, 0.04);
  a1.rotation.x = 0.35;
  limb.add(a1);
  const fingerG = geo('trapFinger', () => new THREE.CylinderGeometry(0.006, 0.009, 0.16, 4));
  for (let i = 0; i < 3; i++) {
    const f = mesh(fingerG, M.skin, -0.02 + i * 0.02, -0.44, 0.12);
    f.rotation.x = 0.5; f.rotation.z = (i - 1) * 0.25;
    limb.add(f);
  }
  trap.add(limb);
  trap.visible = false;
  grp.add(trap);
  return { group: grp, trap, bulge, limb, blanket };
}

// ── A-frame tent (long axis along z, door at +z) ──
export function tent(M, mat) {
  const L = 2.3, W = 2.0, H = 1.55;
  const g = geo('tent', () => {
    const v = [];
    const hw = W / 2, hl = L / 2;
    // two roof slopes
    v.push(-hw, 0, -hl, 0, H, -hl, 0, H, hl, -hw, 0, -hl, 0, H, hl, -hw, 0, hl);
    v.push(hw, 0, hl, 0, H, hl, 0, H, -hl, hw, 0, hl, 0, H, -hl, hw, 0, -hl);
    // back triangle
    v.push(-hw, 0, -hl, hw, 0, -hl, 0, H, -hl);
    // front triangle split around the door
    v.push(-hw, 0, hl, -0.32, 0, hl, 0, H, hl);
    v.push(0.32, 0, hl, hw, 0, hl, 0, H, hl);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    const uv = [];
    for (let i = 0; i < v.length; i += 3) uv.push(v[i] * 0.8 + v[i + 2] * 0.3, v[i + 1] * 0.8 + v[i + 2] * 0.5);
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geom.computeVertexNormals();
    return geom;
  });
  const grp = new THREE.Group();
  grp.add(mesh(g, mat));
  const doorG = geo('tentDoor', () => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute([-0.32, 0, L / 2 - 0.05, 0.32, 0, L / 2 - 0.05, 0, H * 0.82, L / 2 - 0.05], 3));
    geom.computeVertexNormals();
    return geom;
  });
  grp.add(new THREE.Mesh(doorG, new THREE.MeshBasicMaterial({ color: 0x0a0806, side: THREE.DoubleSide })));
  return grp;
}

// ── Camping lantern on a crate ──
export function lantern(M) {
  const grp = new THREE.Group();
  grp.add(mesh(geo('crate', () => new THREE.BoxGeometry(0.5, 0.5, 0.5)), M.cardboard, 0, 0.25, 0));
  grp.add(mesh(geo('lanBase', () => new THREE.CylinderGeometry(0.09, 0.1, 0.06, 10)), M.metalDark, 0, 0.53, 0));
  const glass = new THREE.Mesh(geo('lanGlass', () => new THREE.CylinderGeometry(0.07, 0.07, 0.18, 10)), M.lanternGlass);
  glass.position.y = 0.65;
  grp.add(glass);
  grp.add(mesh(geo('lanTop', () => new THREE.CylinderGeometry(0.04, 0.09, 0.05, 10)), M.metalDark, 0, 0.765, 0));
  const h = mesh(geo('lanHandle', () => new THREE.TorusGeometry(0.06, 0.008, 4, 12, Math.PI)), M.metalDark, 0, 0.79, 0);
  grp.add(h);
  return { group: grp, glass };
}

// ── Campfire ──
export function campfire(M) {
  const grp = new THREE.Group();
  const stone = new THREE.DodecahedronGeometry(0.11, 0);
  grp.add(mesh(geo('fireStones', () => mergeGeos([...Array(9)].map((_, i) => {
    const a = (i / 9) * Math.PI * 2;
    return { g: stone, pos: [Math.cos(a) * 0.5, 0.06, Math.sin(a) * 0.5], rot: [a, a * 2, 0] };
  }))), M.rock));
  const log = new THREE.CylinderGeometry(0.06, 0.07, 0.8, 7);
  grp.add(mesh(geo('fireLogs', () => mergeGeos([0, 1, 2].map((i) => ({ g: log, pos: [0, 0.12, 0], rot: [0, (i / 3) * Math.PI, Math.PI / 2 - 0.35] })))), M.wood));
  const flames = new THREE.Group();
  const fg = geo('flame', () => {
    const g = new THREE.ConeGeometry(0.22, 0.75, 6, 1, true);
    g.translate(0, 0.37, 0);
    return g;
  });
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Mesh(fg, M.fire);
    f.position.y = 0.1;
    f.rotation.y = i;
    f.scale.setScalar(1 - i * 0.22);
    flames.add(f);
  }
  grp.add(flames);
  return { group: grp, flames };
}

// ── Escape portal ──
export function portal(M) {
  const grp = new THREE.Group();
  const ring = mesh(geo('portalRing', () => new THREE.TorusGeometry(1.12, 0.15, 10, 40)), M.stone, 0, 1.42, 0);
  grp.add(ring);
  grp.add(mesh(geo('portalBase', () => new THREE.CylinderGeometry(1.1, 1.3, 0.18, 24)), M.stone, 0, 0.09, 0));
  const uniforms = { uTime: { value: 0 }, uActive: { value: 0 }, uCharge: { value: 0 } };
  const discMat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec2 vUv; uniform float uTime; uniform float uActive; uniform float uCharge;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
      void main(){
        vec2 p = vUv*2.0-1.0; float r = length(p); if (r>1.0) discard;
        float a = atan(p.y,p.x);
        float sw = a + r*5.0 - uTime*(0.6+uActive*1.6);
        float n = noise(vec2(sw*1.6, r*6.0 - uTime*0.7)) * 0.6 + noise(vec2(sw*3.5, r*12.0))*0.4;
        vec3 dim = vec3(0.18,0.08,0.28) * (0.35 + uCharge*0.6);
        vec3 hot = mix(vec3(0.45,0.85,1.0), vec3(1.0,0.95,0.7), n);
        vec3 col = mix(dim*(0.6+n), hot*(0.6+n*0.9), uActive);
        float edge = smoothstep(1.0, 0.82, r);
        float core = (1.0 - r) * (0.5 + uActive);
        float alpha = edge * (0.55 + 0.4*uActive) * (0.55 + n*0.5) + core*0.25*uActive;
        gl_FragColor = vec4(col + core*uActive*0.6, clamp(alpha,0.0,1.0));
      }`,
  });
  const disc = new THREE.Mesh(geo('portalDisc', () => new THREE.CircleGeometry(1.0, 40)), discMat);
  disc.position.y = 1.42;
  grp.add(disc);

  // star counter sign above the portal
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ct = new THREE.CanvasTexture(canvas);
  ct.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.26), new THREE.MeshBasicMaterial({ map: ct, transparent: true, side: THREE.DoubleSide }));
  sign.position.y = 2.84;
  grp.add(sign);
  function setCount(n, need) {
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, 256, 64);
    g.fillStyle = 'rgba(10,8,4,0.75)'; g.fillRect(0, 0, 256, 64);
    g.fillStyle = n >= need ? '#9ff7ff' : '#f2d36b';
    g.font = 'bold 34px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(`★ ${n} / ${need}`, 128, 34);
    ct.needsUpdate = true;
  }
  return { group: grp, uniforms, setCount };
}

// ── Saferoom door (hinge at local x=0, panel extends to +x) ──
export function saferoomDoor(M, width) {
  const pivot = new THREE.Group();
  const panel = mesh(geo('sdoor' + width, () => new THREE.BoxGeometry(width, 2.5, 0.06)), M.door, width / 2, 1.25, 0);
  pivot.add(panel);
  const pad = mesh(geo('keypad', () => new THREE.BoxGeometry(0.12, 0.18, 0.04)), M.metalDark, width - 0.18, 1.2, 0.05);
  pivot.add(pad);
  const pad2 = pad.clone(); pad2.position.z = -0.05; pivot.add(pad2);
  const ledG = geo('led', () => new THREE.BoxGeometry(0.03, 0.03, 0.02));
  const led = new THREE.Mesh(ledG, M.ledRed); led.position.set(width - 0.18, 1.26, 0.075);
  const led2 = new THREE.Mesh(ledG, M.ledRed); led2.position.set(width - 0.18, 1.26, -0.075);
  pivot.add(led, led2);
  const sign = mesh(geo('safeSign', () => new THREE.BoxGeometry(0.5, 0.12, 0.08)), M.lanternGlass, width / 2, 2.3, 0);
  pivot.add(sign);
  return { pivot, leds: [led, led2] };
}

// ── Floor items ──
// Rocks: an icosphere displaced by a smooth function of POSITION (so shared
// corners move together — no cracks/spikes), flat shaded like real stone.
let rockVariants = null;
export function rock(M, seed = 0) {
  if (!rockVariants) {
    rockVariants = [0, 1, 2].map((s) => {
      let g = new THREE.IcosahedronGeometry(0.085, 1);
      g.deleteAttribute('normal');
      g.deleteAttribute('uv');
      const p = g.attributes.position;
      const a = 1 + s * 1.7, b = 2.3 + s, c = 0.7 + s * 0.9;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const n = Math.sin(x * 38 * a + c) * Math.cos(z * 31 + b) * 0.5 + Math.sin(y * 44 + x * 21 * c) * 0.5;
        const k = 1 + n * 0.16;
        p.setXYZ(i, x * k * (1.1 + s * 0.08), y * k * 0.72, z * k * (0.95 - s * 0.05));
      }
      g.computeVertexNormals();
      const uv = [];
      for (let i = 0; i < p.count; i++) uv.push(p.getX(i) * 6 + 0.5, p.getZ(i) * 6 + p.getY(i) * 3);
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      return g;
    });
  }
  return mesh(rockVariants[Math.abs(seed) % 3], M.rock);
}

export function bananaPeel(M) {
  const grp = new THREE.Group();
  const strip = geo('peelStrip', () => {
    const g = new THREE.SphereGeometry(1, 8, 6);
    g.scale(0.022, 0.006, 0.075);
    g.translate(0, 0, 0.07);
    return g;
  });
  for (let i = 0; i < 3; i++) {
    const s = mesh(strip, M.banana);
    s.rotation.y = (i / 3) * Math.PI * 2 + 0.3;
    s.rotation.x = -0.25;
    grp.add(s);
  }
  const stem = mesh(geo('peelStem', () => new THREE.CylinderGeometry(0.01, 0.013, 0.05, 5)), M.bananaDark, 0, 0.025, 0);
  grp.add(stem);
  return grp;
}

export function cardboardBox(M, s = 0.5) {
  return mesh(geo('cbox' + s, () => new THREE.BoxGeometry(s, s * 0.8, s * 0.9)), M.cardboard, 0, s * 0.4, 0);
}

// ── Tall, skinny, eyeless creature (faces +z) ──
// Static parts of each animated limb are merged → ~13 draw calls per creature.
export function creature(M) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const pelvis = new THREE.Group();
  pelvis.position.y = 1.25;
  body.add(pelvis);

  const thighG = geo('cThigh', () => { const g = new THREE.CylinderGeometry(0.045, 0.035, 0.64, 6); g.translate(0, -0.32, 0); return g; });
  const shinFootG = geo('cShinFoot', () => {
    const shin = new THREE.CylinderGeometry(0.034, 0.024, 0.64, 6); shin.translate(0, -0.32, 0);
    const foot = new THREE.BoxGeometry(0.07, 0.035, 0.2); foot.translate(0, -0.02, 0.06);
    return mergeGeos([{ g: shin }, { g: foot, pos: [0, -0.64, 0] }]);
  });
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.x = side * 0.1;
    hip.add(mesh(thighG, M.skin));
    const knee = new THREE.Group(); knee.position.y = -0.64;
    knee.add(mesh(shinFootG, M.skin));
    hip.add(knee);
    pelvis.add(hip);
    legs.push({ hip, knee });
  }

  const spine = new THREE.Group();
  pelvis.add(spine);
  spine.add(mesh(geo('cTorsoRibs', () => {
    const torso = new THREE.CylinderGeometry(0.15, 0.09, 0.82, 8); torso.translate(0, 0.41, 0); torso.scale(1, 1, 0.7);
    const rib = new THREE.TorusGeometry(0.12, 0.012, 4, 10, Math.PI);
    const parts = [{ g: torso }];
    for (let i = 0; i < 4; i++) parts.push({ g: rib, pos: [0, 0.42 + i * 0.08, 0], rot: [Math.PI / 2, 0, Math.PI], scale: [1 - i * 0.03, 0.75, 1] });
    return mergeGeos(parts);
  }), M.skin));
  const chest = new THREE.Group(); chest.position.y = 0.8;
  spine.add(chest);
  const neck = new THREE.Group(); neck.position.y = 0.05;
  chest.add(neck);
  neck.add(mesh(geo('cNeck', () => { const g = new THREE.CylinderGeometry(0.035, 0.045, 0.22, 6); g.translate(0, 0.11, 0); return g; }), M.skin));
  const head = new THREE.Group(); head.position.y = 0.24;
  neck.add(head);
  const sph = new THREE.SphereGeometry(1, 12, 10);
  head.add(mesh(geo('cSkull', () => mergeGeos([{ g: sph, pos: [0, 0.15, 0.02], scale: [0.13, 0.21, 0.15] }])), M.skin));
  // sunken empty eye area + gaping mouth
  head.add(new THREE.Mesh(geo('cHoles', () => mergeGeos([
    { g: sph, pos: [-0.045, 0.2, 0.135], scale: [0.028, 0.012, 0.012] },
    { g: sph, pos: [0.045, 0.2, 0.135], scale: [0.028, 0.012, 0.012] },
    { g: sph, pos: [0, 0.06, 0.13], scale: [0.05, 0.085, 0.03] },
  ])), M.mouth));
  head.add(mesh(geo('cTeeth', () => {
    const tooth = new THREE.ConeGeometry(0.008, 0.03, 4);
    const parts = [];
    for (let i = 0; i < 6; i++) {
      parts.push({ g: tooth, pos: [-0.035 + i * 0.014, 0.135 - (i % 2) * 0.005, 0.145], rot: [Math.PI, 0, 0] });
      parts.push({ g: tooth, pos: [-0.035 + i * 0.014, -0.015, 0.145] });
    }
    return mergeGeos(parts);
  }), M.teeth));

  const upperG = geo('cUpper', () => { const g = new THREE.CylinderGeometry(0.032, 0.026, 0.72, 6); g.translate(0, -0.36, 0); return g; });
  const arms = [];
  for (const side of [-1, 1]) {
    const lowerHandG = geo('cLowerHand' + side, () => {
      const lower = new THREE.CylinderGeometry(0.026, 0.018, 0.72, 6); lower.translate(0, -0.36, 0);
      const finger = new THREE.CylinderGeometry(0.008, 0.004, 0.24, 4); finger.translate(0, -0.12, 0);
      const parts = [{ g: lower }];
      for (let i = 0; i < 4; i++) parts.push({ g: finger, pos: [(i - 1.5) * 0.012, -0.72, 0], rot: [0.15, 0, (i - 1.5) * 0.12 * side] });
      return mergeGeos(parts);
    });
    const sh = new THREE.Group(); sh.position.set(side * 0.19, 0, 0);
    sh.add(mesh(upperG, M.skin));
    const el = new THREE.Group(); el.position.y = -0.72;
    el.add(mesh(lowerHandG, M.skin));
    sh.add(el);
    chest.add(sh);
    arms.push({ sh, el });
  }
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { root, body, pelvis, spine, chest, neck, head, legs, arms };
}

// ═════════════════════════════════════════════════════════════
//  Overhaul models
// ═════════════════════════════════════════════════════════════
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 10) => new THREE.CylinderGeometry(rt, rb, h, s);

// ── Filing cabinet variants. Front faces +z. Each drawer is its own group
//    so every drawer can slide out on its own.
//    v: { cols, rows, w, h, d, mat, wood, sunk }
export function cabinetV(M, v) {
  const grp = new THREE.Group();
  const cols = v.cols || 1, rows = v.rows || 3;
  const W = v.w || 0.5, H = v.h || 1.05, D = v.d || 0.6;
  const mat = v.mat || M.metal;
  const key = `cabV:${cols}:${rows}:${W}:${H}:${D}`;
  const cw = W / cols, rh = (H - 0.06) / rows;
  grp.add(mesh(geo(key + 'body', () => mergeGeos([
    { g: box(W, H, D - 0.02), pos: [0, H / 2, -0.01] },
    { g: box(W + 0.02, 0.025, D + 0.01), pos: [0, H - 0.012, 0] },
  ])), mat));
  const front = geo(key + 'front', () => mergeGeos([
    { g: box(cw - 0.04, rh - 0.03, 0.025), pos: [0, 0, D / 2] },
    { g: box(cw - 0.08, rh * 0.7, D - 0.1), pos: [0, -0.01, 0.03] },
  ]));
  const handleG = geo('cabHandleV', () => box(0.14, 0.025, 0.03));
  const drawers = [];
  for (let c = 0; c < cols; c++) for (let r = rows - 1; r >= 0; r--) {
    const d = new THREE.Group();
    const x = -W / 2 + cw * (c + 0.5), y = 0.04 + rh * (r + 0.5);
    d.position.set(x, y, 0);
    d.add(mesh(front, mat));
    d.add(mesh(handleG, v.wood ? M.brass : M.handle, 0, rh * 0.18, D / 2 + 0.025));
    grp.add(d);
    drawers.push({ group: d, x, y, slide: Math.min(0.42, D * 0.7) });
  }
  return { group: grp, drawers, W, H, D };
}

// Simple vertical ladder (rails + rungs), from y=0 to `h`, faces +z.
export function ladder(M, h = 3, w = 0.5, mat) {
  const g = geo(`ladder:${h}:${w}`, () => {
    const parts = [
      { g: box(0.05, h, 0.05), pos: [-w / 2, h / 2, 0] },
      { g: box(0.05, h, 0.05), pos: [w / 2, h / 2, 0] },
    ];
    for (let y = 0.28; y < h - 0.05; y += 0.3) parts.push({ g: box(w, 0.035, 0.035), pos: [0, y, 0] });
    return mergeGeos(parts);
  });
  return mesh(g, mat || M.metal);
}

// Chrome pool ladder: two rails that curve over the pool edge (+z = water side).
export function poolLadder(M, depth = 1.1) {
  const grp = new THREE.Group();
  const rail = geo('poolRail' + depth, () => {
    const pts = [];
    for (let i = 0; i <= 6; i++) pts.push(new THREE.Vector3(0, -depth + (depth + 0.7) * (i / 6), 0.18));
    for (let i = 1; i <= 6; i++) { const a = (i / 6) * Math.PI; pts.push(new THREE.Vector3(0, 0.7 + Math.sin(a) * 0.22, 0.18 - (1 - Math.cos(a)) * 0.22)); }
    for (let i = 1; i <= 3; i++) pts.push(new THREE.Vector3(0, 0.7 - 0.7 * (i / 3), -0.26));
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.022, 8);
  });
  for (const x of [-0.25, 0.25]) { const r = new THREE.Mesh(rail, M.chrome); r.position.x = x; grp.add(r); }
  const stepG = geo('poolStep', () => box(0.5, 0.03, 0.12));
  for (let y = -depth + 0.25; y < -0.05; y += 0.3) grp.add(mesh(stepG, M.chrome, 0, y, 0.12));
  return grp;
}

// Vent grate (1 × 1 m, slats along x). Sits flat, centred.
export function grate(M) {
  return mesh(geo('grate', () => {
    const parts = [
      { g: box(1, 0.03, 0.05), pos: [0, 0, -0.475] }, { g: box(1, 0.03, 0.05), pos: [0, 0, 0.475] },
      { g: box(0.05, 0.03, 1), pos: [-0.475, 0, 0] }, { g: box(0.05, 0.03, 1), pos: [0.475, 0, 0] },
    ];
    for (let i = -4; i <= 4; i++) parts.push({ g: box(0.92, 0.02, 0.025), pos: [0, 0, i * 0.1], rot: [0.5, 0, 0] });
    return mergeGeos(parts);
  }), M.metalDark);
}

// Bent piece of duct hanging from a collapsed vent.
export function ductDebris(M) {
  const grp = new THREE.Group();
  const a = mesh(geo('ductBent', () => mergeGeos([
    { g: box(1, 0.04, 1.1), pos: [0, 0, 0] }, { g: box(0.04, 0.7, 1.1), pos: [-0.5, 0.35, 0] },
  ])), M.duct);
  a.position.set(0, 2.55, 0); a.rotation.set(0.9, 0.2, 0.25);
  const b = mesh(geo('ductSheet', () => box(0.8, 0.03, 0.6)), M.duct, 0.3, 0.02, 0.4);
  b.rotation.set(0.05, 0.7, 0.1);
  const c = mesh(geo('ductSheet2', () => box(0.5, 0.03, 0.4)), M.duct, -0.4, 0.02, -0.3);
  c.rotation.set(-0.08, 1.9, 0.12);
  grp.add(a, b, c);
  return grp;
}

// Christmas tree with red bulbs. Returns bulbs so they can twinkle.
export function xmasTree(M) {
  const grp = new THREE.Group();
  grp.add(mesh(geo('xTrunk', () => cyl(0.07, 0.09, 0.4, 8)), M.wood, 0, 0.2, 0));
  grp.add(mesh(geo('xStand', () => cyl(0.3, 0.34, 0.12, 12)), M.red, 0, 0.06, 0));
  grp.add(mesh(geo('xTiers', () => mergeGeos([0, 1, 2, 3].map((i) => {
    const r = 0.95 - i * 0.2, h = 0.85 - i * 0.08;
    const c = new THREE.ConeGeometry(r, h, 11, 1);
    return { g: c, pos: [0, 0.75 + i * 0.48, 0], rot: [0, i * 0.7, 0] };
  }))), M.pine));
  const bulbs = new THREE.Group();
  const bg = geo('xBulb', () => new THREE.SphereGeometry(0.035, 8, 6));
  const r = mulberry32(77);
  const list = [];
  for (let i = 0; i < 46; i++) {
    const t = r();
    const y = 0.55 + t * 1.9;
    const tierR = 0.95 * (1 - t * 0.82) - 0.05;
    const a = r() * Math.PI * 2;
    const b = new THREE.Mesh(bg, M.bulbRed);
    b.position.set(Math.cos(a) * tierR * 0.82, y, Math.sin(a) * tierR * 0.82);
    bulbs.add(b);
    list.push(b);
  }
  grp.add(bulbs);
  const star = mesh(geo('xStar', () => new THREE.OctahedronGeometry(0.1, 0)), M.bulbRed, 0, 2.62, 0);
  grp.add(star);
  return { group: grp, bulbs: list, star };
}

export function gift(M, s = 0.35, colorMat) {
  const grp = new THREE.Group();
  grp.add(mesh(geo('gift' + s, () => box(s, s * 0.8, s)), colorMat || M.red, 0, s * 0.4, 0));
  grp.add(mesh(geo('giftRib' + s, () => mergeGeos([
    { g: box(s + 0.01, s * 0.8 + 0.01, 0.05), pos: [0, s * 0.4, 0] },
    { g: box(0.05, s * 0.8 + 0.01, s + 0.01), pos: [0, s * 0.4, 0] },
  ])), M.brass));
  return grp;
}

// Crafting table at camp (front +z).
export function workbench(M) {
  const grp = new THREE.Group();
  grp.add(mesh(geo('wbTop', () => mergeGeos([
    { g: box(1.6, 0.08, 0.8), pos: [0, 0.9, 0] },
    { g: box(1.5, 0.04, 0.7), pos: [0, 0.32, 0] },
    ...[[-0.72, -0.33], [0.72, -0.33], [-0.72, 0.33], [0.72, 0.33]].map(([x, z]) => ({ g: box(0.08, 0.9, 0.08), pos: [x, 0.45, z] })),
    { g: box(1.6, 0.6, 0.04), pos: [0, 1.25, -0.38] },
  ])), M.wood));
  // tools: vice, hammer, saw
  grp.add(mesh(geo('wbVice', () => mergeGeos([
    { g: box(0.18, 0.12, 0.14), pos: [0.55, 1.0, 0.2] }, { g: cyl(0.012, 0.012, 0.22, 6), pos: [0.55, 1.0, 0.33], rot: [Math.PI / 2, 0, 0] },
    { g: box(0.05, 0.03, 0.26), pos: [-0.3, 0.955, 0.12], rot: [0, 0.4, 0] }, { g: box(0.09, 0.05, 0.04), pos: [-0.25, 0.97, 0.0] },
    { g: box(0.4, 0.005, 0.12), pos: [0.05, 0.945, -0.05], rot: [0, -0.2, 0] },
  ])), M.metalDark));
  grp.add(mesh(geo('wbBoard', () => box(1.5, 0.5, 0.02)), M.cardboard, 0, 1.27, -0.35));
  return grp;
}

// Storage chest (front +z) with a lid that opens.
export function chest(M) {
  const grp = new THREE.Group();
  grp.add(mesh(geo('chBody', () => mergeGeos([
    { g: box(1.0, 0.5, 0.6), pos: [0, 0.25, 0] },
    { g: box(1.04, 0.05, 0.64), pos: [0, 0.05, 0] },
  ])), M.wood));
  grp.add(mesh(geo('chBands', () => mergeGeos([
    { g: box(0.05, 0.52, 0.62), pos: [-0.35, 0.26, 0] }, { g: box(0.05, 0.52, 0.62), pos: [0.35, 0.26, 0] },
    { g: box(0.1, 0.1, 0.03), pos: [0, 0.45, 0.31] },
  ])), M.metalDark));
  const lid = new THREE.Group();
  lid.position.set(0, 0.5, -0.3);
  lid.add(mesh(geo('chLid', () => mergeGeos([
    { g: box(1.0, 0.12, 0.6), pos: [0, 0.06, 0.3] },
    { g: box(0.05, 0.13, 0.62), pos: [-0.35, 0.06, 0.3] }, { g: box(0.05, 0.13, 0.62), pos: [0.35, 0.06, 0.3] },
  ])), M.wood));
  grp.add(lid);
  return { group: grp, lid };
}

// Cubicle partition segment (length along x), and a desk with a CRT.
export function partition(M, len) {
  return mesh(geo('part' + len, () => mergeGeos([
    { g: box(len, 1.4, 0.06), pos: [0, 0.7, 0] },
  ])), M.partition);
}
export function desk(M) {
  const grp = new THREE.Group();
  grp.add(mesh(geo('deskW', () => mergeGeos([
    { g: box(1.3, 0.05, 0.65), pos: [0, 0.74, 0] },
    { g: box(0.05, 0.72, 0.6), pos: [-0.62, 0.36, 0] }, { g: box(0.4, 0.72, 0.6), pos: [0.43, 0.36, 0] },
  ])), M.wood));
  const crt = crtTV(M); crt.position.set(-0.15, 0.77, -0.05); crt.scale.setScalar(0.75); grp.add(crt);
  return grp;
}

// ── Noclipped junk ──
export function crtTV(M) {
  const grp = new THREE.Group();
  grp.add(mesh(geo('crt', () => mergeGeos([
    { g: box(0.5, 0.42, 0.32), pos: [0, 0.21, 0.04] },
    { g: box(0.34, 0.3, 0.2), pos: [0, 0.2, -0.2] },
  ])), M.plastic));
  const scr = new THREE.Mesh(geo('crtScr', () => new THREE.PlaneGeometry(0.4, 0.32)), M.screen);
  scr.position.set(0, 0.22, 0.201);
  grp.add(scr);
  return grp;
}

export function car(M) {
  const grp = new THREE.Group();
  grp.add(mesh(geo('carBody', () => mergeGeos([
    { g: box(4.2, 0.6, 1.75), pos: [0, 0.55, 0] },
    { g: box(2.1, 0.5, 1.6), pos: [-0.2, 1.1, 0] },
    { g: box(0.5, 0.45, 1.6), pos: [0.95, 1.05, 0], rot: [0, 0, 0.75] },
    { g: box(0.45, 0.45, 1.6), pos: [-1.35, 1.05, 0], rot: [0, 0, -0.6] },
  ])), M.paintCar));
  grp.add(mesh(geo('carGlass', () => mergeGeos([
    { g: box(1.9, 0.38, 1.62), pos: [-0.2, 1.12, 0] },
  ])), M.glassDark));
  grp.add(mesh(geo('carWheels', () => mergeGeos([[-1.35, -0.8], [1.35, -0.8], [-1.35, 0.8], [1.35, 0.8]].map(([x, z]) => ({ g: cyl(0.33, 0.33, 0.24, 14), pos: [x, 0.33, z], rot: [Math.PI / 2, 0, 0] })))), M.rubber));
  grp.add(mesh(geo('carChrome', () => mergeGeos([
    { g: box(0.08, 0.16, 1.7), pos: [2.11, 0.42, 0] }, { g: box(0.08, 0.16, 1.7), pos: [-2.11, 0.42, 0] },
  ])), M.chrome));
  return grp;
}

export function stopSign(M) {
  const grp = new THREE.Group();
  grp.add(mesh(geo('signPost', () => cyl(0.03, 0.03, 2.4, 6)), M.metal, 0, 1.2, 0));
  const s = new THREE.Mesh(geo('signFace', () => new THREE.PlaneGeometry(0.75, 0.75)), M.signStop);
  s.position.set(0, 2.2, 0.035);
  grp.add(s);
  return grp;
}

export function couch(M) {
  return mesh(geo('couch', () => mergeGeos([
    { g: box(2.1, 0.42, 0.9), pos: [0, 0.21, 0] },
    { g: box(2.1, 0.5, 0.22), pos: [0, 0.62, -0.34] },
    { g: box(0.22, 0.3, 0.9), pos: [-0.94, 0.55, 0] }, { g: box(0.22, 0.3, 0.9), pos: [0.94, 0.55, 0] },
    { g: box(0.92, 0.14, 0.62), pos: [-0.47, 0.49, 0.08] }, { g: box(0.92, 0.14, 0.62), pos: [0.47, 0.49, 0.08] },
  ])), M.couch);
}

export function cone(M) {
  return mesh(geo('cone', () => mergeGeos([
    { g: new THREE.ConeGeometry(0.16, 0.65, 12), pos: [0, 0.37, 0] },
    { g: box(0.42, 0.04, 0.42), pos: [0, 0.02, 0] },
  ])), M.orange);
}

export function cart(M) {
  return mesh(geo('cart', () => {
    const p = [];
    const W = 0.55, L = 0.9;
    for (let i = 0; i <= 6; i++) p.push({ g: box(0.012, 0.45, 0.012), pos: [-L / 2 + (i / 6) * L, 0.75, -W / 2] }, { g: box(0.012, 0.45, 0.012), pos: [-L / 2 + (i / 6) * L, 0.75, W / 2] });
    for (let i = 0; i <= 3; i++) p.push({ g: box(0.012, 0.45, 0.012), pos: [L / 2, 0.75, -W / 2 + (i / 3) * W] }, { g: box(0.012, 0.45, 0.012), pos: [-L / 2, 0.75, -W / 2 + (i / 3) * W] });
    p.push({ g: box(L, 0.015, W), pos: [0, 0.53, 0] }, { g: box(L, 0.015, 0.015), pos: [0, 0.98, -W / 2] }, { g: box(L, 0.015, 0.015), pos: [0, 0.98, W / 2] });
    p.push({ g: box(0.02, 0.015, W + 0.1), pos: [-L / 2 - 0.15, 1.02, 0] }, { g: box(0.17, 0.015, 0.015), pos: [-L / 2 - 0.07, 1.0, -W / 2] }, { g: box(0.17, 0.015, 0.015), pos: [-L / 2 - 0.07, 1.0, W / 2] });
    for (const [x, z] of [[-0.38, -0.22], [0.38, -0.22], [-0.38, 0.22], [0.38, 0.22]]) p.push({ g: box(0.02, 0.5, 0.02), pos: [x, 0.27, z] }, { g: cyl(0.05, 0.05, 0.03, 8), pos: [x, 0.05, z], rot: [Math.PI / 2, 0, 0] });
    return mergeGeos(p);
  }), M.chrome);
}

export function vending(M) {
  const grp = new THREE.Group();
  grp.add(mesh(geo('vend', () => box(0.9, 1.85, 0.8)), M.red, 0, 0.925, 0));
  const gl = new THREE.Mesh(geo('vendGlass', () => new THREE.PlaneGeometry(0.6, 1.2)), M.glassDark);
  gl.position.set(-0.08, 1.1, 0.401);
  grp.add(gl);
  grp.add(mesh(geo('vendSlot', () => box(0.6, 0.15, 0.05)), M.metalDark, -0.08, 0.28, 0.41));
  return grp;
}

export function hydrant(M) {
  return mesh(geo('hydrant', () => mergeGeos([
    { g: cyl(0.12, 0.14, 0.6, 12), pos: [0, 0.3, 0] }, { g: new THREE.SphereGeometry(0.12, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), pos: [0, 0.6, 0] },
    { g: cyl(0.05, 0.05, 0.36, 8), pos: [0, 0.42, 0], rot: [0, 0, Math.PI / 2] }, { g: cyl(0.17, 0.17, 0.05, 12), pos: [0, 0.03, 0] },
  ])), M.red);
}

export function bathtub(M) {
  return mesh(geo('tub', () => mergeGeos([
    { g: box(1.7, 0.08, 0.8), pos: [0, 0.08, 0] },
    { g: box(1.7, 0.55, 0.08), pos: [0, 0.35, -0.36] }, { g: box(1.7, 0.55, 0.08), pos: [0, 0.35, 0.36] },
    { g: box(0.08, 0.55, 0.8), pos: [-0.81, 0.35, 0] }, { g: box(0.08, 0.55, 0.8), pos: [0.81, 0.35, 0] },
  ])), M.plastic);
}

export function bench(M) {
  const grp = new THREE.Group();
  grp.add(mesh(geo('benchW', () => mergeGeos([
    ...[0, 1, 2].map((i) => ({ g: box(1.8, 0.04, 0.12), pos: [0, 0.45, -0.15 + i * 0.14] })),
    ...[0, 1].map((i) => ({ g: box(1.8, 0.1, 0.03), pos: [0, 0.65 + i * 0.14, -0.24], rot: [-0.15, 0, 0] })),
  ])), M.wood));
  grp.add(mesh(geo('benchM', () => mergeGeos([-0.75, 0.75].map((x) => ({ g: box(0.05, 0.45, 0.45), pos: [x, 0.22, 0] })))), M.metalDark));
  return grp;
}

// type → { make, L (x-size), W (z-size), H }
export const NOCLIP = {
  car:      { make: car,      L: 4.2, W: 1.8, H: 1.45, weight: 3 },
  stopsign: { make: stopSign, L: 0.2, W: 0.2, H: 2.6, weight: 3 },
  couch:    { make: couch,    L: 2.1, W: 0.9, H: 0.85, weight: 3 },
  cone:     { make: cone,     L: 0.42, W: 0.42, H: 0.7, weight: 3 },
  cart:     { make: cart,     L: 1.1, W: 0.6, H: 1.05, weight: 2 },
  vending:  { make: vending,  L: 0.9, W: 0.8, H: 1.85, weight: 2 },
  hydrant:  { make: hydrant,  L: 0.4, W: 0.4, H: 0.7, weight: 2 },
  bathtub:  { make: bathtub,  L: 1.7, W: 0.8, H: 0.62, weight: 2 },
  crt:      { make: crtTV,    L: 0.5, W: 0.5, H: 0.45, weight: 3 },
  bench:    { make: bench,    L: 1.8, W: 0.5, H: 0.85, weight: 2 },
};

// Curved banana (fruit), along +z.
export function bananaFruit(M) {
  const grp = new THREE.Group();
  const g = geo('bananaFruit', () => {
    const pts = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(new THREE.Vector3(0, Math.sin(t * Math.PI) * 0.035, -0.09 + t * 0.18)); }
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.019, 6);
    const p = tube.attributes.position;
    for (let i = 0; i < p.count; i++) { const z = p.getZ(i); const k = 1 - Math.pow(Math.abs(z) / 0.09, 4) * 0.6; p.setX(i, p.getX(i) * k); p.setY(i, (p.getY(i) - Math.sin((z / 0.18 + 0.5) * Math.PI) * 0.035) * k + Math.sin((z / 0.18 + 0.5) * Math.PI) * 0.035); }
    tube.computeVertexNormals();
    return tube;
  });
  grp.add(mesh(g, M.banana));
  grp.add(mesh(geo('bananaTip', () => cyl(0.004, 0.008, 0.025, 5)), M.bananaDark, 0, 0.005, 0.098));
  return grp;
}

// ═════════════════════════════════════════════════════════════
//  Monsters. Every humanoid shares one rig layout so they can share the
//  walk / attack / death animation; crawler + hound have their own.
// ═════════════════════════════════════════════════════════════
const SPH = new THREE.SphereGeometry(1, 12, 10);

export function humanoid(M, o) {
  const k = o.key;
  const skin = o.skin;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const pelvis = new THREE.Group();
  pelvis.position.y = o.hipY;
  body.add(pelvis);
  const thighG = geo(k + 'thigh', () => { const g = cyl(o.legR, o.legR * 0.8, o.thigh, 7); g.translate(0, -o.thigh / 2, 0); return o.joints ? mergeGeos([{ g }, { g: SPH, scale: [o.legR * 1.1, o.legR * 1.1, o.legR * 1.1] }]) : g; });
  const shinG = geo(k + 'shin', () => {
    const s = cyl(o.legR * 0.78, o.legR * 0.55, o.shin, 7); s.translate(0, -o.shin / 2, 0);
    const parts = [{ g: s }, { g: box(o.legR * 1.6, o.legR * 0.8, o.legR * 4.4), pos: [0, -o.shin - o.legR * 0.2, o.legR * 1.3] }];
    if (o.joints) parts.push({ g: SPH, scale: [o.legR * 0.9, o.legR * 0.9, o.legR * 0.9] });
    return mergeGeos(parts);
  });
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.x = side * o.hipW;
    hip.add(mesh(thighG, skin));
    const knee = new THREE.Group(); knee.position.y = -o.thigh;
    knee.add(mesh(shinG, skin));
    hip.add(knee);
    pelvis.add(hip);
    legs.push({ hip, knee });
  }
  const spine = new THREE.Group();
  pelvis.add(spine);
  spine.add(mesh(geo(k + 'torso', () => {
    const parts = [];
    if (o.barrel) {
      parts.push({ g: SPH, pos: [0, o.torso * 0.55, 0.02], scale: [o.torsoR, o.torso * 0.62, o.torsoR * 0.85] });
      parts.push({ g: SPH, pos: [0, o.torso * 0.12, 0], scale: [o.torsoR * 0.75, o.torso * 0.25, o.torsoR * 0.65] });
    } else {
      const t = cyl(o.torsoR, o.torsoR * 0.6, o.torso, 9); t.translate(0, o.torso / 2, 0); t.scale(1, 1, 0.7);
      parts.push({ g: t });
      if (o.ribs) {
        const rib = new THREE.TorusGeometry(o.torsoR * 0.8, 0.012, 4, 10, Math.PI);
        for (let i = 0; i < 4; i++) parts.push({ g: rib, pos: [0, o.torso * 0.52 + i * 0.08, 0], rot: [Math.PI / 2, 0, Math.PI], scale: [1 - i * 0.03, 0.75, 1] });
      }
      if (o.joints) parts.push({ g: SPH, pos: [0, o.torso, 0], scale: [o.torsoR * 1.1, o.torsoR * 0.55, o.torsoR * 0.8] });
    }
    return mergeGeos(parts);
  }), skin));
  const chest = new THREE.Group(); chest.position.y = o.torso * 0.98;
  spine.add(chest);
  const neck = new THREE.Group(); neck.position.y = 0.04;
  chest.add(neck);
  neck.add(mesh(geo(k + 'neck', () => { const g = cyl(o.neckR, o.neckR * 1.25, o.neck, 6); g.translate(0, o.neck / 2, 0); return g; }), skin));
  const head = new THREE.Group(); head.position.y = o.neck;
  neck.add(head);
  const hs = o.headS;
  head.add(mesh(geo(k + 'skull', () => mergeGeos([{ g: SPH, pos: [0, hs[1], 0.02], scale: hs }])), skin));
  const extra = {};
  if (o.face === 'hollow') {
    head.add(new THREE.Mesh(geo(k + 'holes', () => mergeGeos([
      { g: SPH, pos: [-0.045, 0.2, 0.135], scale: [0.028, 0.012, 0.012] }, { g: SPH, pos: [0.045, 0.2, 0.135], scale: [0.028, 0.012, 0.012] },
      { g: SPH, pos: [0, 0.06, 0.13], scale: [0.05, 0.085, 0.03] },
    ])), M.mouth));
    head.add(mesh(geo(k + 'teeth', () => {
      const tooth = new THREE.ConeGeometry(0.008, 0.03, 4);
      const parts = [];
      for (let i = 0; i < 6; i++) {
        parts.push({ g: tooth, pos: [-0.035 + i * 0.014, 0.135 - (i % 2) * 0.005, 0.145], rot: [Math.PI, 0, 0] });
        parts.push({ g: tooth, pos: [-0.035 + i * 0.014, -0.015, 0.145] });
      }
      return mergeGeos(parts);
    }), M.teeth));
  } else if (o.face === 'brute') {
    head.add(new THREE.Mesh(geo(k + 'maw', () => mergeGeos([{ g: SPH, pos: [0, hs[1] * 0.7, hs[2] * 0.85], scale: [hs[0] * 0.6, hs[1] * 0.3, 0.04] }])), M.mouth));
    head.add(mesh(geo(k + 'tusks', () => mergeGeos([-1, 1].map((s) => ({ g: new THREE.ConeGeometry(0.02, 0.09, 5), pos: [s * hs[0] * 0.45, hs[1] * 0.9, hs[2] * 0.85], rot: [0.3, 0, 0] })))), M.teeth));
  } else if (o.face === 'smiler') {
    const smile = new THREE.Mesh(geo(k + 'smile', () => {
      const parts = [];
      for (let i = 0; i < 15; i++) {
        const t = i / 14 - 0.5, a = t * 2.4;
        parts.push({ g: box(0.018, 0.05 - Math.abs(t) * 0.04, 0.01), pos: [Math.sin(a) * hs[0] * 0.95, hs[1] * 0.75 - Math.cos(a) * 0.05 + 0.05, Math.cos(a) * hs[2] * 0.92 + 0.02] , rot: [0, a, 0] });
      }
      return mergeGeos(parts);
    }), M.glow);
    head.add(smile);
    const eyes = new THREE.Mesh(geo(k + 'eyes', () => mergeGeos([-1, 1].map((s) => ({ g: SPH, pos: [s * hs[0] * 0.38, hs[1] * 1.35, hs[2] * 0.9], scale: [0.026, 0.016, 0.01] })))), M.glow);
    head.add(eyes);
    extra.glow = [smile, eyes];
  }
  const upperG = geo(k + 'upper', () => { const g = cyl(o.armR, o.armR * 0.82, o.upper, 6); g.translate(0, -o.upper / 2, 0); return o.joints ? mergeGeos([{ g }, { g: SPH, scale: [o.armR * 1.2, o.armR * 1.2, o.armR * 1.2] }]) : g; });
  const arms = [];
  for (const side of [-1, 1]) {
    const lowerG = geo(k + 'lower' + side, () => {
      const lower = cyl(o.armR * 0.82, o.armR * 0.6, o.lower, 6); lower.translate(0, -o.lower / 2, 0);
      const parts = [{ g: lower }];
      if (o.fist) parts.push({ g: SPH, pos: [0, -o.lower - o.fist * 0.5, 0], scale: [o.fist, o.fist * 1.1, o.fist * 0.9] });
      else {
        const finger = cyl(0.008, 0.004, o.finger, 4); finger.translate(0, -o.finger / 2, 0);
        for (let i = 0; i < 4; i++) parts.push({ g: finger, pos: [(i - 1.5) * 0.012, -o.lower, 0], rot: [0.15, 0, (i - 1.5) * 0.12 * side] });
      }
      if (o.joints) parts.push({ g: SPH, scale: [o.armR, o.armR, o.armR] });
      return mergeGeos(parts);
    });
    const sh = new THREE.Group(); sh.position.set(side * o.shW, 0, 0);
    sh.add(mesh(upperG, skin));
    const el = new THREE.Group(); el.position.y = -o.upper;
    el.add(mesh(lowerG, skin));
    sh.add(el);
    chest.add(sh);
    arms.push({ sh, el });
  }
  root.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  return { root, body, pelvis, spine, chest, neck, head, legs, arms, extra, hipY: o.hipY, rig: 'humanoid' };
}

export const HUMANOIDS = {
  hollow: { key: 'hH', hipY: 1.25, thigh: 0.64, shin: 0.64, legR: 0.045, hipW: 0.1, torso: 0.82, torsoR: 0.15, ribs: true, neck: 0.22, neckR: 0.035, headS: [0.13, 0.21, 0.15], shW: 0.19, upper: 0.72, lower: 0.72, armR: 0.032, finger: 0.24, face: 'hollow' },
  brute: { key: 'hB', hipY: 1.0, thigh: 0.5, shin: 0.5, legR: 0.12, hipW: 0.24, torso: 1.05, torsoR: 0.48, barrel: true, neck: 0.12, neckR: 0.1, headS: [0.17, 0.16, 0.17], shW: 0.52, upper: 0.78, lower: 0.82, armR: 0.11, fist: 0.12, face: 'brute' },
  mannequin: { key: 'hM', hipY: 0.96, thigh: 0.47, shin: 0.47, legR: 0.055, hipW: 0.1, torso: 0.62, torsoR: 0.16, neck: 0.12, neckR: 0.04, headS: [0.1, 0.135, 0.115], shW: 0.2, upper: 0.32, lower: 0.31, armR: 0.04, fist: 0.04, joints: true, face: 'none' },
  smiler: { key: 'hS', hipY: 1.05, thigh: 0.55, shin: 0.55, legR: 0.03, hipW: 0.09, torso: 0.72, torsoR: 0.14, neck: 0.16, neckR: 0.03, headS: [0.16, 0.17, 0.15], shW: 0.18, upper: 0.66, lower: 0.66, armR: 0.025, finger: 0.3, face: 'smiler' },
};

// Six-legged crawler (faces +z): long low body, head at the front.
export function crawlerModel(M, skin) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.45;
  root.add(body);
  body.add(mesh(geo('crBody', () => mergeGeos([
    { g: SPH, pos: [0, 0, 0], scale: [0.2, 0.13, 0.42] },
    { g: SPH, pos: [0, 0.03, -0.38], scale: [0.15, 0.11, 0.22] },
    ...[0, 1, 2, 3, 4].map((i) => ({ g: SPH, pos: [0, 0.11, -0.3 + i * 0.15], scale: [0.03, 0.04, 0.05] })),
  ])), skin));
  const head = new THREE.Group(); head.position.set(0, 0.04, 0.42);
  body.add(head);
  head.add(mesh(geo('crHead', () => mergeGeos([{ g: SPH, scale: [0.13, 0.1, 0.15] }])), skin));
  head.add(new THREE.Mesh(geo('crMouth', () => mergeGeos([{ g: SPH, pos: [0, -0.03, 0.11], scale: [0.08, 0.05, 0.05] }])), M.mouth));
  head.add(mesh(geo('crFangs', () => mergeGeos([-1, 1].map((s) => ({ g: new THREE.ConeGeometry(0.012, 0.08, 4), pos: [s * 0.05, -0.07, 0.13], rot: [Math.PI - 0.3, 0, 0] })))), M.teeth));
  const upG = geo('crUp', () => { const g = cyl(0.025, 0.02, 0.42, 5); g.translate(0, 0.21, 0); return g; });
  const dnG = geo('crDn', () => { const g = cyl(0.02, 0.006, 0.62, 5); g.translate(0, -0.31, 0); return g; });
  const legs = [];
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1, row = Math.floor(i / 2);
    const hip = new THREE.Group();
    hip.position.set(side * 0.16, 0.02, 0.26 - row * 0.26);
    hip.rotation.z = -side * 0.9;
    hip.add(mesh(upG, skin));
    const knee = new THREE.Group(); knee.position.y = 0.42;
    knee.rotation.z = side * 2.1;
    knee.add(mesh(dnG, skin));
    hip.add(knee);
    body.add(hip);
    legs.push({ hip, knee, side, row });
  }
  root.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  return { root, body, head, legs, rig: 'crawler' };
}

// Four-legged eyeless hound (faces +z).
export function houndModel(M, skin) {
  const root = new THREE.Group();
  const body = new THREE.Group(); body.position.y = 0.72;
  root.add(body);
  body.add(mesh(geo('hdBody', () => mergeGeos([
    { g: SPH, pos: [0, 0.02, 0.15], scale: [0.2, 0.2, 0.36] },
    { g: SPH, pos: [0, 0, -0.3], scale: [0.15, 0.15, 0.25] },
    ...[0, 1, 2, 3, 4, 5].map((i) => ({ g: new THREE.TorusGeometry(0.17, 0.012, 4, 10, Math.PI), pos: [0, 0.02, -0.05 + i * 0.07], rot: [0, Math.PI / 2, 0], scale: [1, 1, 1] })),
  ])), skin));
  const neck = new THREE.Group(); neck.position.set(0, 0.08, 0.42);
  body.add(neck);
  neck.add(mesh(geo('hdNeck', () => { const g = cyl(0.06, 0.09, 0.32, 7); g.rotateX(Math.PI / 2 - 0.5); g.translate(0, 0.08, 0.13); return g; }), skin));
  const head = new THREE.Group(); head.position.set(0, 0.16, 0.3);
  neck.add(head);
  head.add(mesh(geo('hdSkull', () => mergeGeos([{ g: SPH, scale: [0.1, 0.09, 0.2] }])), skin));
  const jaw = new THREE.Group(); jaw.position.set(0, -0.04, 0.02);
  jaw.add(mesh(geo('hdJaw', () => mergeGeos([{ g: SPH, pos: [0, -0.02, 0.09], scale: [0.08, 0.035, 0.16] }])), skin));
  jaw.add(mesh(geo('hdTeeth', () => mergeGeos([...Array(8)].map((_, i) => ({ g: new THREE.ConeGeometry(0.008, 0.035, 4), pos: [(i % 2 ? 1 : -1) * 0.055, 0.01, 0.02 + Math.floor(i / 2) * 0.05] })))), M.teeth));
  head.add(jaw);
  head.add(new THREE.Mesh(geo('hdMouth', () => mergeGeos([{ g: SPH, pos: [0, -0.04, 0.1], scale: [0.07, 0.025, 0.12] }])), M.mouth));
  const tail = new THREE.Group(); tail.position.set(0, 0.05, -0.52);
  tail.add(mesh(geo('hdTail', () => { const g = cyl(0.02, 0.006, 0.45, 5); g.translate(0, -0.22, 0); g.rotateX(-0.9); return g; }), skin));
  body.add(tail);
  const thighG = geo('hdThigh', () => { const g = cyl(0.05, 0.035, 0.38, 6); g.translate(0, -0.19, 0); return g; });
  const shinG = geo('hdShin', () => { const g = cyl(0.03, 0.02, 0.4, 6); g.translate(0, -0.2, 0); return mergeGeos([{ g }, { g: box(0.05, 0.03, 0.1), pos: [0, -0.4, 0.03] }]); });
  const legs = [];
  for (let i = 0; i < 4; i++) {
    const side = i % 2 ? 1 : -1, front = i < 2;
    const hip = new THREE.Group(); hip.position.set(side * 0.13, -0.02, front ? 0.32 : -0.34);
    hip.add(mesh(thighG, skin));
    const knee = new THREE.Group(); knee.position.y = -0.38;
    knee.add(mesh(shinG, skin));
    hip.add(knee);
    body.add(hip);
    legs.push({ hip, knee, side, front });
  }
  root.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  return { root, body, neck, head, jaw, tail, legs, rig: 'hound' };
}

export function monster(M, type, skinMat) {
  if (type === 'crawler') return crawlerModel(M, skinMat);
  if (type === 'hound') return houndModel(M, skinMat);
  const o = HUMANOIDS[type] || HUMANOIDS.hollow;
  return humanoid(M, { ...o, skin: skinMat });
}

// Small handheld/thrown items
export function noisemaker(M) {
  const grp = new THREE.Group();
  grp.add(mesh(geo('nmBody', () => cyl(0.045, 0.045, 0.03, 14)), M.red, 0, 0, 0));
  grp.children[0].rotation.x = Math.PI / 2;
  grp.add(mesh(geo('nmBells', () => mergeGeos([-1, 1].map((s) => ({ g: new THREE.SphereGeometry(0.022, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), pos: [s * 0.03, 0.045, 0], rot: [0, 0, -s * 0.5] })))), M.brass));
  grp.add(mesh(geo('nmFace', () => cyl(0.038, 0.038, 0.005, 14)), M.white, 0, 0, 0.017));
  grp.children[2].rotation.x = Math.PI / 2;
  return grp;
}
