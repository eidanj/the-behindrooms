// Geometry builder that merges many boxes into one BufferGeometry with
// world-space UVs. Merging every wall of a chunk into one mesh keeps the
// draw-call count low, which is the main thing that keeps FPS high.

import * as THREE from '../lib/three.module.min.js';

export class GeoBuilder {
  constructor(su = 1, sv = 1, ou = 0, ov = 0) {
    this.su = su; this.sv = sv; this.ou = ou; this.ov = ov;
    this.pos = []; this.nor = []; this.uv = []; this.idx = [];
    this.n = 0;
  }

  _uv(axis, x, y, z) {
    if (axis === 'z') return [x * this.su + this.ou, y * this.sv + this.ov];
    if (axis === 'x') return [z * this.su + this.ou, y * this.sv + this.ov];
    return [x * this.su + this.ou, z * this.sv + this.ov];
  }

  quad(p, nrm, axis) {
    for (const v of p) {
      this.pos.push(v[0], v[1], v[2]);
      this.nor.push(nrm[0], nrm[1], nrm[2]);
      const uv = this._uv(axis, v[0], v[1], v[2]);
      this.uv.push(uv[0], uv[1]);
    }
    const n = this.n;
    this.idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
    this.n += 4;
  }

  // faces: string containing any of 'nx px ny py nz pz' (default: four sides)
  box(x0, x1, y0, y1, z0, z1, faces = 'nx px nz pz') {
    if (faces.includes('pz')) this.quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], 'z');
    if (faces.includes('nz')) this.quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], 'z');
    if (faces.includes('px')) this.quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], 'x');
    if (faces.includes('nx')) this.quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], 'x');
    if (faces.includes('py')) this.quad([[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], [0, 1, 0], 'y');
    if (faces.includes('ny')) this.quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], 'y');
  }

  get empty() { return this.n === 0; }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.n > 65000 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
