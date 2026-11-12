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
let rockVariants = null;
export function rock(M, seed = 0) {
  if (!rockVariants) {
    rockVariants = [0, 1, 2].map((s) => {
      const g = new THREE.DodecahedronGeometry(0.085, 1);
      const r = mulberry32(900 + s);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const k = 0.8 + r() * 0.35;
        p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.75, p.getZ(i) * k);
      }
      g.computeVertexNormals();
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
