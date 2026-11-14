// Test tool: guides the player to the nearest saferoom with a trail of
// glowing floor arrows, a beacon above the door (visible through walls)
// and a compass marker.

import * as THREE from '../lib/three.module.min.js';

const MAX_ARROWS = 40;
const SPACING = 1.6;
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const UPY = new THREE.Vector3(0, 1, 0);

export class Guide {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.door = null;
    this.points = [];
    this.repath = 0;
    this.t = 0;

    const shape = new THREE.Shape();
    shape.moveTo(0, 0.24); shape.lineTo(0.22, -0.04); shape.lineTo(0.11, -0.04);
    shape.lineTo(0, 0.09); shape.lineTo(-0.11, -0.04); shape.lineTo(-0.22, -0.04);
    shape.closePath();
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2); // flat on the floor, tip pointing −z
    const mat = new THREE.MeshBasicMaterial({ color: 0x7ff0ff, transparent: true, opacity: 0.85, depthWrite: false, fog: false, side: THREE.DoubleSide });
    this.arrows = new THREE.InstancedMesh(g, mat, MAX_ARROWS);
    this.arrows.count = 0;
    this.arrows.frustumCulled = false;
    this.arrows.renderOrder = 5;
    this.arrows.visible = false;
    game.scene.add(this.arrows);

    this.beacon = new THREE.Group();
    const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), new THREE.MeshBasicMaterial({ color: 0x7ff0ff, depthTest: false, fog: false, transparent: true, opacity: 0.9 }));
    diamond.renderOrder = 999;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 8), new THREE.MeshBasicMaterial({ color: 0x7ff0ff, transparent: true, opacity: 0.35, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    beam.position.y = -1.3;
    this.beacon.add(diamond, beam);
    this.diamond = diamond;
    this.beacon.visible = false;
    game.scene.add(this.beacon);
  }

  // Nearest saferoom door in the loaded area (straight-line distance).
  findNearestDoor() {
    const W = this.game.world, P = this.game.player;
    let best = null, bd = Infinity;
    for (const c of W.chunks.values()) {
      for (const it of c.inter) {
        if (it.kind !== 'sdoor') continue;
        const d = Math.hypot(it.pos.x - P.pos.x, it.pos.z - P.pos.z);
        if (d < bd) { bd = d; best = it; }
      }
    }
    return best;
  }

  start() {
    const door = this.findNearestDoor();
    if (!door) {
      this.game.toast('No saferoom in the nearby area — explore further and try again.', 'bad', 3500);
      return false;
    }
    this.door = door;
    this.active = true;
    this.repath = 0;
    this.arrows.visible = true;
    this.beacon.visible = true;
    this.beacon.position.set(door.pos.x, 2.6, door.pos.z);
    return true;
  }

  stop() {
    this.active = false;
    this.door = null;
    this.points = [];
    this.arrows.count = 0;
    this.arrows.visible = false;
    this.beacon.visible = false;
  }

  get target() { return this.door ? this.door.outside : null; }

  _rebuildPath() {
    const W = this.game.world, P = this.game.player, t = this.door.outside;
    const path = W.findPath(P.pos.x, P.pos.z, t.x, t.z, 4000, true);
    if (!path) { this.points = [{ x: P.pos.x, z: P.pos.z }, { x: t.x, z: t.z }]; return; }
    const pts = [{ x: P.pos.x, z: P.pos.z }, ...path];
    // light smoothing: skip corners when the straight line is walkable
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = Math.min(pts.length - 1, i + 8);
      while (j > i + 1 && !W.walkClear(pts[i].x, pts[i].z, pts[j].x, pts[j].z, 0.3)) j--;
      out.push(pts[j]);
      i = j;
    }
    this.points = out;
  }

  update(dt) {
    if (!this.active) return;
    const g = this.game, P = g.player, door = this.door;
    // the saferoom's chunk was unloaded → its door object is gone
    if (!g.world.chunks.has(door.chunkKey)) { this.stop(); g.toast('Lost track of the saferoom — try the guide again.', 'bad'); return; }
    const dDoor = Math.hypot(P.pos.x - door.pos.x, P.pos.z - door.pos.z);
    const room = g.world.roomAt(P.pos.x, P.pos.z);
    if (dDoor < 1.7 || (room && room.safe)) {
      this.stop();
      g.toast(door.unlocked ? 'You reached the saferoom.' : `You reached the saferoom — it's locked (${P.inv.counts.key} key${P.inv.counts.key === 1 ? '' : 's'}).`, 'good', 3500);
      return;
    }
    this.t += dt;
    this.repath -= dt;
    if (this.repath <= 0) { this.repath = 0.5; this._rebuildPath(); }

    // place arrows along the polyline
    const pts = this.points;
    let n = 0, segStart = 0, want = 1.2;
    for (let i = 0; i < pts.length - 1 && n < MAX_ARROWS; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;
      const yaw = Math.atan2(-dx, -dz);
      tmpQ.setFromAxisAngle(UPY, yaw);
      while (want <= segStart + len && n < MAX_ARROWS) {
        const u = (want - segStart) / len;
        const s = 0.85 + 0.25 * Math.max(0, Math.sin(this.t * 5 - n * 0.55));
        tmpP.set(a.x + dx * u, this.game.world.floorAt(a.x + dx * u, a.z + dz * u) + 0.03, a.z + dz * u);
        tmpS.set(s, 1, s);
        tmpM.compose(tmpP, tmpQ, tmpS);
        this.arrows.setMatrixAt(n++, tmpM);
        want += SPACING;
      }
      segStart += len;
    }
    this.arrows.count = n;
    this.arrows.instanceMatrix.needsUpdate = true;
    this.diamond.rotation.y += dt * 2;
    this.beacon.position.y = 2.55 + Math.sin(this.t * 2.5) * 0.06;
  }

  // compass info for the HUD
  bearing() {
    if (!this.active) return null;
    const P = this.game.player, d = this.door.pos;
    const dx = d.x - P.pos.x, dz = d.z - P.pos.z;
    return { bearing: Math.atan2(dx, -dz), dist: Math.hypot(dx, dz) };
  }

  dispose() {
    this.stop();
    this.game.scene.remove(this.arrows, this.beacon);
  }
}
