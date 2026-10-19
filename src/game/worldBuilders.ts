import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AnimalPhysicsState, STAGE2_LAKES, STAGE2_RIVERS } from './rules';

/**
 * Shared procedural texture & material caches so the entire island reuses GPU programs and textures.
 */
let _organicBumpTex: THREE.CanvasTexture | null = null;
let _barkTex: THREE.CanvasTexture | null = null;
let _palmBarkTex: THREE.CanvasTexture | null = null;
let _fabricTex: THREE.CanvasTexture | null = null;
let _foliageTex: THREE.CanvasTexture | null = null;

const _materialCache = new Map<string, THREE.Material>();

function getCachedMaterial<T extends THREE.Material>(key: string, factory: () => T): T {
  let mat = _materialCache.get(key) as T | undefined;
  if (!mat) {
    mat = factory();
    _materialCache.set(key, mat);
  }
  return mat;
}

/**
 * Merges all static child meshes in a THREE.Group that share the same Material into single BufferGeometries.
 * Preserves any dynamic named children (like 'campfire_flame') and sets matrixAutoUpdate = false on static meshes.
 */
export function bakeGroupByMaterial(
  sourceGroup: THREE.Group,
  castShadow = true,
  receiveShadow = true
): THREE.Group {
  sourceGroup.updateMatrixWorld(true);
  const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const preservedNodes: THREE.Object3D[] = [];

  sourceGroup.traverse((child) => {
    if (
      child.name === 'campfire_flame' ||
      child.name === 'crate_beacon' ||
      child.name.startsWith('boat_stage_')
    ) {
      preservedNodes.push(child);
      return;
    }
    // Skip children inside a preserved node
    let p = child.parent;
    while (p) {
      if (
        p.name === 'campfire_flame' ||
        p.name === 'crate_beacon' ||
        p.name.startsWith('boat_stage_')
      ) {
        return;
      }
      p = p.parent;
    }

    if (child instanceof THREE.Mesh) {
      const mat = child.material as THREE.Material;
      let geom = child.geometry.clone();
      child.geometry.dispose();
      geom.applyMatrix4(child.matrixWorld);
      if (geom.index) {
        geom = geom.toNonIndexed();
      }
      // Normalize attributes to (position, normal, uv) so mergeGeometries always succeeds
      const allowed = new Set(['position', 'normal', 'uv']);
      for (const attrName of Object.keys(geom.attributes)) {
        if (!allowed.has(attrName)) {
          geom.deleteAttribute(attrName);
        }
      }
      if (!geom.attributes.normal) {
        geom.computeVertexNormals();
      }
      if (!geom.attributes.uv) {
        const count = geom.attributes.position.count;
        geom.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
      }

      let list = byMaterial.get(mat);
      if (!list) {
        list = [];
        byMaterial.set(mat, list);
      }
      list.push(geom);
    }
  });

  const bakedGroup = new THREE.Group();
  for (const [mat, geoms] of byMaterial.entries()) {
    if (geoms.length === 0) continue;
    const merged = mergeGeometries(geoms, false);
    for (const g of geoms) g.dispose();
    if (merged) {
      const mesh = new THREE.Mesh(merged, mat);
      const isUnlit = mat instanceof THREE.MeshBasicMaterial;
      const noShadow = mat.userData?.noShadow === true;
      mesh.castShadow = isUnlit || noShadow ? false : castShadow;
      mesh.receiveShadow = isUnlit ? false : receiveShadow;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      bakedGroup.add(mesh);
    }
  }

  for (const node of preservedNodes) {
    const clone = node.clone(true);
    bakedGroup.add(clone);
  }

  return bakedGroup;
}

/**
 * Generates a tileable grayscale procedural bump/roughness CanvasTexture with multi-scale detail.
 */
export function createOrganicBumpTexture(size = 256): THREE.CanvasTexture {
  if (_organicBumpTex) return _organicBumpTex;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, size, size);

    for (let i = 0; i < 450; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = 3 + Math.random() * 10;
      const v = Math.floor(90 + Math.random() * 75);
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(${v},${v},${v},0.45)`);
      grad.addColorStop(1, 'rgba(128,128,128,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    for (let i = 0; i < 2000; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = 0.6 + Math.random() * 2.0;
      const v = Math.floor(70 + Math.random() * 115);
      ctx.fillStyle = `rgba(${v},${v},${v},0.65)`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(24, 24);
  _organicBumpTex = tex;
  return tex;
}

function getPalmBarkTexture(): THREE.CanvasTexture {
  if (_palmBarkTex) return _palmBarkTex;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#6e4f35';
    ctx.fillRect(0, 0, 128, 256);

    for (let y = 0; y < 256; y += 8) {
      ctx.fillStyle = y % 16 === 0 ? '#4d3522' : '#856244';
      ctx.fillRect(0, y, 128, 2.5);
      ctx.fillStyle = 'rgba(30, 18, 10, 0.35)';
      ctx.fillRect(0, y + 2.5, 128, 1.5);
    }

    for (let i = 0; i < 400; i++) {
      const x = Math.random() * 128;
      const y = Math.random() * 256;
      const h = 4 + Math.random() * 14;
      ctx.fillStyle = Math.random() > 0.5 ? 'rgba(210,180,145,0.16)' : 'rgba(35,22,12,0.24)';
      ctx.fillRect(x, y, 1.2, h);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  _palmBarkTex = tex;
  return tex;
}

function getJungleBarkTexture(): THREE.CanvasTexture {
  if (_barkTex) return _barkTex;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#473323';
    ctx.fillRect(0, 0, 128, 256);
    for (let i = 0; i < 500; i++) {
      const x = Math.random() * 128;
      const y = Math.random() * 256;
      const w = 1 + Math.random() * 3.5;
      const h = 10 + Math.random() * 35;
      ctx.fillStyle =
        i % 5 === 0
          ? 'rgba(46, 85, 38, 0.28)'
          : i % 2 === 0
          ? 'rgba(25, 16, 10, 0.45)'
          : 'rgba(110, 82, 58, 0.3)';
      ctx.fillRect(x, y, w, h);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  _barkTex = tex;
  return tex;
}

function getWeatheredFabricTexture(): THREE.CanvasTexture {
  if (_fabricTex) return _fabricTex;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#d4c7b0';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = 'rgba(80, 65, 48, 0.14)';
    for (let i = 0; i < 128; i += 3) {
      ctx.fillRect(i, 0, 1, 128);
      ctx.fillRect(0, i, 128, 1);
    }
    for (let s = 0; s < 40; s++) {
      const x = Math.random() * 128;
      const y = Math.random() * 128;
      const r = 4 + Math.random() * 14;
      ctx.fillStyle = s % 2 === 0 ? 'rgba(95, 75, 55, 0.15)' : 'rgba(240, 235, 220, 0.18)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  _fabricTex = tex;
  return tex;
}

function getFoliageBumpTexture(): THREE.CanvasTexture {
  if (_foliageTex) return _foliageTex;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#707070';
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 650; i++) {
      const x = Math.random() * 128;
      const y = Math.random() * 128;
      const rx = 2 + Math.random() * 5;
      const ry = 1 + Math.random() * 2.5;
      const v = Math.floor(60 + Math.random() * 145);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.random() * Math.PI);
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  _foliageTex = tex;
  return tex;
}

/**
 * Displaces vertices of a BufferGeometry with deterministic 3D sinusoidal noise
 * to turn primitive spheres/dodecahedrons into realistic sculpted organic rocks or foliage crowns.
 */
export function sculptOrganicGeometry(
  geo: THREE.BufferGeometry,
  amplitude = 0.15,
  freq = 2.6,
  seed = 1.0
): THREE.BufferGeometry {
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n =
      Math.sin(v.x * freq + seed) *
        Math.cos(v.y * freq * 1.13 + seed * 1.7) *
        Math.sin(v.z * freq * 0.91 - seed * 0.8) +
      0.5 *
        Math.sin((v.x + v.z) * freq * 2.1 + seed * 2.3) *
        Math.cos(v.y * freq * 1.9);
    const scale = 1 + n * amplitude;
    v.multiplyScalar(scale);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds the shipwrecked castaway man in torn, tattered clothes with realistic anatomical proportions,
 * sculpted facial features, layered hair & beard, textured linen/denim fabrics, and articulated limbs.
 */
export interface CastawayRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  headGroup: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  tatteredSash: THREE.Mesh;
  knifeGroup: THREE.Group;
}

export function buildCastawayCharacter(): CastawayRig {
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const fabricTex = getWeatheredFabricTexture();
  const bumpTex = createOrganicBumpTexture(128);

  const skinMat = getCachedMaterial('castaway_skin', () =>
    new THREE.MeshStandardMaterial({
      color: 0xc6865c,
      roughness: 0.58,
      metalness: 0.04,
    })
  );
  const raggedShirtMat = getCachedMaterial('castaway_shirt', () =>
    new THREE.MeshStandardMaterial({
      color: 0xdcd2be,
      map: fabricTex,
      bumpMap: fabricTex,
      bumpScale: 0.015,
      roughness: 0.9,
      metalness: 0.02,
      side: THREE.DoubleSide,
    })
  );
  const tatteredPantsMat = getCachedMaterial('castaway_pants', () =>
    new THREE.MeshStandardMaterial({
      color: 0x35495e,
      map: fabricTex,
      bumpMap: fabricTex,
      bumpScale: 0.02,
      roughness: 0.86,
      metalness: 0.05,
      side: THREE.DoubleSide,
    })
  );
  const ropeBeltMat = getCachedMaterial('castaway_rope', () =>
    new THREE.MeshStandardMaterial({
      color: 0x8b5e34,
      bumpMap: bumpTex,
      bumpScale: 0.02,
      roughness: 0.82,
      metalness: 0.08,
    })
  );
  const leatherMat = getCachedMaterial('castaway_leather', () =>
    new THREE.MeshStandardMaterial({
      color: 0x4e321f,
      roughness: 0.55,
      metalness: 0.12,
    })
  );
  const brassMat = getCachedMaterial('castaway_brass', () =>
    new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      roughness: 0.32,
      metalness: 0.82,
    })
  );
  const hairBeardMat = getCachedMaterial('castaway_hair', () =>
    new THREE.MeshStandardMaterial({
      color: 0x261810,
      bumpMap: bumpTex,
      bumpScale: 0.025,
      roughness: 0.88,
      metalness: 0.03,
    })
  );

  // Contact shadow disc at feet
  const shadowGeo = new THREE.CircleGeometry(0.56, 20);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = getCachedMaterial('contact_shadow', () =>
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
    })
  );
  const shadowDisc = new THREE.Mesh(shadowGeo, shadowMat);
  shadowDisc.position.y = 0.02;
  root.add(shadowDisc);

  // Build static torso assembly and bake by material
  const rawTorso = new THREE.Group();

  const upperChestGeo = new THREE.CylinderGeometry(0.27, 0.23, 0.38, 12);
  upperChestGeo.scale(1.12, 1.0, 0.68);
  const upperChest = new THREE.Mesh(upperChestGeo, raggedShirtMat);
  upperChest.position.y = 1.24;
  rawTorso.add(upperChest);

  const lowerTorsoGeo = new THREE.CylinderGeometry(0.23, 0.21, 0.32, 12);
  lowerTorsoGeo.scale(1.08, 1.0, 0.66);
  const lowerTorso = new THREE.Mesh(lowerTorsoGeo, raggedShirtMat);
  lowerTorso.position.y = 0.94;
  rawTorso.add(lowerTorso);

  const pelvisGeo = new THREE.CylinderGeometry(0.215, 0.2, 0.18, 12);
  pelvisGeo.scale(1.08, 1.0, 0.68);
  const pelvis = new THREE.Mesh(pelvisGeo, tatteredPantsMat);
  pelvis.position.y = 0.76;
  rawTorso.add(pelvis);

  const neckGeo = new THREE.CylinderGeometry(0.088, 0.105, 0.18, 10);
  const neck = new THREE.Mesh(neckGeo, skinMat);
  neck.position.set(0, 1.46, 0);
  rawTorso.add(neck);

  for (const side of [-1, 1]) {
    const lapelGeo = new THREE.BoxGeometry(0.11, 0.18, 0.03);
    const lapel = new THREE.Mesh(lapelGeo, raggedShirtMat);
    lapel.position.set(side * 0.08, 1.35, -0.17);
    lapel.rotation.z = side * 0.32;
    lapel.rotation.x = 0.15;
    rawTorso.add(lapel);
  }

  const hemCount = 10;
  for (let i = 0; i < hemCount; i++) {
    const a = (i / hemCount) * Math.PI * 2;
    const tatterH = 0.18 + (i % 3) * 0.06;
    const tatterGeo = new THREE.ConeGeometry(0.065, tatterH, 5);
    tatterGeo.rotateX(Math.PI);
    const tatter = new THREE.Mesh(tatterGeo, raggedShirtMat);
    tatter.position.set(Math.cos(a) * 0.22, 0.77 - tatterH * 0.2, Math.sin(a) * 0.14);
    tatter.rotation.z = Math.cos(a) * 0.12;
    rawTorso.add(tatter);
  }

  const beltGeo = new THREE.TorusGeometry(0.21, 0.038, 7, 16);
  beltGeo.rotateX(Math.PI / 2);
  beltGeo.scale(1.12, 1.0, 0.72);
  const belt = new THREE.Mesh(beltGeo, ropeBeltMat);
  belt.position.y = 0.83;
  rawTorso.add(belt);

  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.08, 0.04), brassMat);
  buckle.position.set(0, 0.83, -0.165);
  rawTorso.add(buckle);

  const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.14, 0.08), leatherMat);
  pouch.position.set(-0.23, 0.78, -0.05);
  pouch.rotation.z = 0.12;
  rawTorso.add(pouch);

  const chestStrapGeo = new THREE.CylinderGeometry(0.24, 0.23, 0.42, 10, 1, true);
  chestStrapGeo.scale(1.14, 1.0, 0.7);
  const chestStrap = new THREE.Mesh(chestStrapGeo, leatherMat);
  chestStrap.position.y = 1.15;
  chestStrap.rotation.z = 0.55;
  chestStrap.scale.set(1.02, 0.18, 0.72);
  rawTorso.add(chestStrap);

  bodyGroup.add(bakeGroupByMaterial(rawTorso, true, true));

  // Tattered diagonal castaway sash
  const sashGeo = new THREE.BoxGeometry(0.11, 0.48, 0.035);
  const tatteredSash = new THREE.Mesh(sashGeo, ropeBeltMat);
  tatteredSash.position.set(0.22, 0.67, -0.11);
  tatteredSash.rotation.z = 0.22;
  bodyGroup.add(tatteredSash);

  // 2. Sculpted Head (baked by material into 4 draw calls)
  const rawHead = new THREE.Group();
  const craniumGeo = new THREE.SphereGeometry(0.195, 14, 12);
  craniumGeo.scale(0.94, 1.08, 0.98);
  const headMesh = new THREE.Mesh(craniumGeo, skinMat);
  headMesh.position.y = 0.14;
  rawHead.add(headMesh);

  const jawGeo = new THREE.CylinderGeometry(0.15, 0.11, 0.14, 10);
  jawGeo.scale(0.92, 1.0, 0.9);
  const jaw = new THREE.Mesh(jawGeo, skinMat);
  jaw.position.set(0, 0.06, -0.02);
  rawHead.add(jaw);

  const noseGeo = new THREE.ConeGeometry(0.032, 0.09, 6);
  noseGeo.rotateX(-Math.PI * 0.38);
  const nose = new THREE.Mesh(noseGeo, skinMat);
  nose.position.set(0, 0.13, -0.195);
  rawHead.add(nose);

  for (const side of [-1, 1]) {
    const earGeo = new THREE.SphereGeometry(0.042, 8, 8);
    earGeo.scale(0.45, 1.1, 0.75);
    const ear = new THREE.Mesh(earGeo, skinMat);
    ear.position.set(side * 0.182, 0.13, 0);
    rawHead.add(ear);
  }

  const scleraMat = getCachedMaterial('eye_sclera', () =>
    new THREE.MeshStandardMaterial({ color: 0xfaf8f5, roughness: 0.2 })
  );
  const pupilMat = getCachedMaterial('eye_pupil', () =>
    new THREE.MeshStandardMaterial({ color: 0x1a110b, roughness: 0.1 })
  );
  for (const side of [-1, 1]) {
    const eyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 8), scleraMat);
    eyeWhite.scale.set(1.1, 0.85, 0.6);
    eyeWhite.position.set(side * 0.068, 0.165, -0.172);
    rawHead.add(eyeWhite);

    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 8), pupilMat);
    iris.position.set(side * 0.068, 0.165, -0.184);
    rawHead.add(iris);

    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.016, 0.02), hairBeardMat);
    brow.position.set(side * 0.068, 0.195, -0.176);
    brow.rotation.z = side * -0.1;
    rawHead.add(brow);
  }

  const beardMainGeo = sculptOrganicGeometry(new THREE.SphereGeometry(0.165, 10, 8), 0.1, 4.0, 2.1);
  beardMainGeo.scale(0.95, 1.15, 0.92);
  const beardMain = new THREE.Mesh(beardMainGeo, hairBeardMat);
  beardMain.position.set(0, 0.03, -0.055);
  rawHead.add(beardMain);

  const beardTipGeo = sculptOrganicGeometry(new THREE.ConeGeometry(0.13, 0.18, 8), 0.12, 5.0, 3.4);
  beardTipGeo.rotateX(Math.PI);
  const beardTip = new THREE.Mesh(beardTipGeo, hairBeardMat);
  beardTip.position.set(0, -0.05, -0.08);
  rawHead.add(beardTip);

  const hairCapGeo = sculptOrganicGeometry(new THREE.SphereGeometry(0.208, 12, 10), 0.09, 5.5, 1.3);
  hairCapGeo.scale(1.02, 0.92, 1.06);
  const hairCap = new THREE.Mesh(hairCapGeo, hairBeardMat);
  hairCap.position.set(0, 0.19, 0.02);
  rawHead.add(hairCap);

  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 1.4 - Math.PI * 0.2;
    const lockGeo = new THREE.ConeGeometry(0.048, 0.16, 5);
    lockGeo.rotateX(Math.PI * 0.88);
    const lock = new THREE.Mesh(lockGeo, hairBeardMat);
    lock.position.set(Math.cos(a) * 0.17, 0.14, Math.sin(a) * 0.17 + 0.03);
    rawHead.add(lock);
  }

  const bandanaMat = getCachedMaterial('castaway_bandana', () =>
    new THREE.MeshStandardMaterial({
      color: 0xa83226,
      map: fabricTex,
      roughness: 0.72,
    })
  );
  const bandanaGeo = new THREE.TorusGeometry(0.192, 0.032, 7, 16);
  bandanaGeo.rotateX(Math.PI / 2);
  bandanaGeo.scale(0.96, 1.02, 1.0);
  const bandana = new THREE.Mesh(bandanaGeo, bandanaMat);
  bandana.position.set(0, 0.225, 0.005);
  bandana.rotation.x = 0.08;
  rawHead.add(bandana);

  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.038, 8, 8), bandanaMat);
  knot.position.set(0, 0.21, 0.2);
  rawHead.add(knot);

  for (const side of [-1, 1]) {
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.15, 5), bandanaMat);
    tail.rotation.x = Math.PI * 0.75;
    tail.rotation.z = side * 0.35;
    tail.position.set(side * 0.035, 0.15, 0.23);
    rawHead.add(tail);
  }

  const headGroup = bakeGroupByMaterial(rawHead, true, false);
  headGroup.position.set(0, 1.52, 0);
  bodyGroup.add(headGroup);

  // 3. Articulated Arms (baked per arm)
  const buildArm = (isLeft: boolean): THREE.Group => {
    const rawArm = new THREE.Group();
    const s = isLeft ? -1 : 1;

    const sleeveGeo = new THREE.CylinderGeometry(0.095, 0.115, 0.2, 8);
    const sleeve = new THREE.Mesh(sleeveGeo, raggedShirtMat);
    sleeve.position.y = -0.06;
    sleeve.rotation.z = s * -0.1;
    rawArm.add(sleeve);

    const upperArmGeo = new THREE.CylinderGeometry(0.078, 0.066, 0.28, 8);
    const upperArm = new THREE.Mesh(upperArmGeo, skinMat);
    upperArm.position.y = -0.18;
    rawArm.add(upperArm);

    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.064, 8, 6), skinMat);
    elbow.position.y = -0.32;
    rawArm.add(elbow);

    const forearmGeo = new THREE.CylinderGeometry(0.064, 0.05, 0.26, 8);
    const forearm = new THREE.Mesh(forearmGeo, skinMat);
    forearm.position.set(0, -0.44, -0.02);
    forearm.rotation.x = 0.12;
    rawArm.add(forearm);

    const wrapGeo = new THREE.CylinderGeometry(0.058, 0.055, 0.09, 8);
    const wrap = new THREE.Mesh(wrapGeo, ropeBeltMat);
    wrap.position.set(0, -0.51, -0.028);
    wrap.rotation.x = 0.12;
    rawArm.add(wrap);

    const palmGeo = new THREE.BoxGeometry(0.065, 0.095, 0.085);
    const hand = new THREE.Mesh(palmGeo, skinMat);
    hand.position.set(0, -0.59, -0.04);
    rawArm.add(hand);

    const armGroup = bakeGroupByMaterial(rawArm, true, false);
    armGroup.position.set(s * 0.33, 1.38, 0);
    return armGroup;
  };

  const leftArm = buildArm(true);
  const rightArm = buildArm(false);

  // Survival Bowie Knife held in right hand (unlocked when Sea Supply Box is opened)
  const knifeRaw = new THREE.Group();
  const steelMat = getCachedMaterial('knife_steel', () =>
    new THREE.MeshStandardMaterial({
      color: 0xe0e7ee,
      roughness: 0.18,
      metalness: 0.92,
    })
  );
  const gripHilt = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.14, 8), leatherMat);
  gripHilt.rotation.x = Math.PI / 2;
  knifeRaw.add(gripHilt);

  const crossGuard = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.024, 0.028), brassMat);
  crossGuard.position.set(0, 0, -0.075);
  knifeRaw.add(crossGuard);

  const bladeGeo = new THREE.ConeGeometry(0.032, 0.34, 4);
  bladeGeo.rotateX(-Math.PI / 2);
  bladeGeo.scale(0.35, 1.0, 1.0);
  const blade = new THREE.Mesh(bladeGeo, steelMat);
  blade.position.set(0, 0.005, -0.24);
  knifeRaw.add(blade);

  const knifeGroup = bakeGroupByMaterial(knifeRaw, false, false);
  knifeGroup.position.set(0, -0.59, -0.06);
  knifeGroup.visible = false;
  rightArm.add(knifeGroup);

  bodyGroup.add(leftArm, rightArm);

  // 4. Articulated Legs (baked per leg)
  const buildLeg = (isLeft: boolean): THREE.Group => {
    const rawLeg = new THREE.Group();

    const thighGeo = new THREE.CylinderGeometry(0.118, 0.096, 0.38, 10);
    const thigh = new THREE.Mesh(thighGeo, tatteredPantsMat);
    thigh.position.y = -0.19;
    rawLeg.add(thigh);

    for (let k = 0; k < 6; k++) {
      const ka = (k / 6) * Math.PI * 2;
      const shred = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.12, 4), tatteredPantsMat);
      shred.rotation.x = Math.PI;
      shred.position.set(Math.cos(ka) * 0.085, -0.39, Math.sin(ka) * 0.085);
      rawLeg.add(shred);
    }

    const knee = new THREE.Mesh(new THREE.SphereGeometry(0.078, 8, 6), skinMat);
    knee.position.y = -0.39;
    rawLeg.add(knee);

    const calfGeo = new THREE.CylinderGeometry(0.082, 0.056, 0.34, 10);
    const calf = new THREE.Mesh(calfGeo, skinMat);
    calf.position.y = -0.56;
    rawLeg.add(calf);

    const ankle = new THREE.Mesh(new THREE.SphereGeometry(0.058, 8, 6), skinMat);
    ankle.position.set(0, -0.72, 0.01);
    rawLeg.add(ankle);

    const footGeo = new THREE.BoxGeometry(0.115, 0.068, 0.24);
    const foot = new THREE.Mesh(footGeo, skinMat);
    foot.position.set(0, -0.745, -0.055);
    rawLeg.add(foot);

    const legGroup = bakeGroupByMaterial(rawLeg, true, false);
    legGroup.position.set(isLeft ? -0.145 : 0.145, 0.76, 0);
    return legGroup;
  };

  const leftLeg = buildLeg(true);
  const rightLeg = buildLeg(false);
  bodyGroup.add(leftLeg, rightLeg);

  return {
    root,
    bodyGroup,
    headGroup,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    tatteredSash,
    knifeGroup,
  };
}

/**
 * Builds a realistic Coconut Palm Tree and bakes all sub-parts by shared material.
 */
export function buildCoconutPalmTree(scale = 1.0, leanAngle = 0.18): THREE.Group {
  const group = new THREE.Group();
  const palmBarkTex = getPalmBarkTexture();

  const trunkMat = getCachedMaterial('palm_trunk', () =>
    new THREE.MeshStandardMaterial({
      color: 0x8b6b4e,
      map: palmBarkTex,
      bumpMap: palmBarkTex,
      bumpScale: 0.05,
      roughness: 0.88,
      metalness: 0.02,
    })
  );
  const frondMat = getCachedMaterial('palm_frond_dark', () =>
    new THREE.MeshStandardMaterial({
      color: 0x2e7d32,
      roughness: 0.48,
      metalness: 0.06,
      side: THREE.DoubleSide,
    })
  );
  const frondSunMat = getCachedMaterial('palm_frond_sun', () =>
    new THREE.MeshStandardMaterial({
      color: 0x43a047,
      roughness: 0.44,
      metalness: 0.06,
      side: THREE.DoubleSide,
    })
  );
  const coconutMat = getCachedMaterial('palm_coconut_brown', () => {
    const m = new THREE.MeshStandardMaterial({
      color: 0x5d4037,
      roughness: 0.65,
      metalness: 0.04,
    });
    m.userData.noShadow = true;
    return m;
  });
  const greenCocoMat = getCachedMaterial('palm_coconut_green', () => {
    const m = new THREE.MeshStandardMaterial({
      color: 0x689f38,
      roughness: 0.45,
      metalness: 0.05,
    });
    m.userData.noShadow = true;
    return m;
  });

  const boleGeo = sculptOrganicGeometry(
    new THREE.ConeGeometry(0.46 * scale, 0.75 * scale, 8),
    0.08,
    3.5,
    scale
  );
  const bole = new THREE.Mesh(boleGeo, trunkMat);
  bole.position.y = 0.32 * scale;
  group.add(bole);

  const segments = 7;
  const segHeight = 0.94 * scale;
  let curX = 0;
  let curY = 0.15 * scale;
  for (let i = 0; i < segments; i++) {
    const t = i / segments;
    const rBottom = (0.34 - t * 0.14) * scale;
    const rTop = (0.32 - t * 0.14) * scale;
    const cylGeo = new THREE.CylinderGeometry(rTop, rBottom, segHeight * 1.06, 9);
    const seg = new THREE.Mesh(cylGeo, trunkMat);
    const tilt = leanAngle * (0.3 + Math.pow(t, 1.15) * 1.05);
    const nextX = curX + Math.sin(tilt) * segHeight;
    const nextY = curY + Math.cos(tilt) * segHeight;
    seg.position.set((curX + nextX) * 0.5, (curY + nextY) * 0.5, 0);
    seg.rotation.z = -tilt;
    group.add(seg);
    curX = nextX;
    curY = nextY;
  }

  const crown = new THREE.Group();
  crown.position.set(curX, curY, 0);
  group.add(crown);

  const heart = new THREE.Mesh(new THREE.SphereGeometry(0.28 * scale, 8, 6), trunkMat);
  heart.scale.set(1.0, 1.25, 1.0);
  crown.add(heart);

  for (let c = 0; c < 5; c++) {
    const a = (c / 5) * Math.PI * 2;
    const coco = new THREE.Mesh(
      new THREE.SphereGeometry(0.2 * scale, 8, 8),
      c % 2 === 0 ? coconutMat : greenCocoMat
    );
    coco.scale.set(0.95, 1.15, 0.95);
    coco.position.set(
      Math.cos(a) * 0.27 * scale,
      -0.16 * scale - (c % 2) * 0.08 * scale,
      Math.sin(a) * 0.27 * scale
    );
    crown.add(coco);
  }

  const frondCount = 8;
  for (let f = 0; f < frondCount; f++) {
    const isUpper = f >= 5;
    const angle = (f / frondCount) * Math.PI * 2 + (isUpper ? 0.35 : 0);
    const frondPivot = new THREE.Group();
    frondPivot.rotation.y = angle;
    frondPivot.rotation.z = isUpper ? 0.28 : -0.06;

    const secLengths = [0.95 * scale, 1.05 * scale, 0.95 * scale];
    const secDrops = [0.22, -0.18, -0.58];
    let fx = 0.1 * scale;
    let fy = 0.08 * scale;

    for (let s = 0; s < 3; s++) {
      const len = secLengths[s];
      const drop = secDrops[s];
      const nx = fx + Math.cos(drop) * len;
      const ny = fy + Math.sin(drop) * len;

      const stemGeo = new THREE.CylinderGeometry(
        (0.038 - s * 0.01) * scale,
        (0.048 - s * 0.01) * scale,
        len,
        5
      );
      stemGeo.rotateZ(-Math.PI / 2);
      const stem = new THREE.Mesh(stemGeo, frondMat);
      stem.position.set((fx + nx) * 0.5, (fy + ny) * 0.5, 0);
      stem.rotation.z = drop;
      frondPivot.add(stem);

      const pairs = 3;
      for (let p = 0; p < pairs; p++) {
        const pt = (p + 0.5) / pairs;
        const lx = fx + (nx - fx) * pt;
        const ly = fy + (ny - fy) * pt;
        const overallT = (s + pt) / 3;
        const leafletLen = (0.78 - Math.abs(overallT - 0.42) * 0.72) * scale;
        const leafletWidth = (0.15 - s * 0.025) * scale;

        for (const side of [-1, 1]) {
          const leafGeo = new THREE.ConeGeometry(leafletWidth, leafletLen, 3);
          leafGeo.scale(0.35, 1.0, 1.0);
          const leaf = new THREE.Mesh(
            leafGeo,
            (f + p) % 2 === 0 ? frondSunMat : frondMat
          );
          leaf.position.set(lx, ly - 0.04 * scale, side * leafletLen * 0.42);
          leaf.rotation.x = side * (Math.PI * 0.36);
          leaf.rotation.y = side * -0.32;
          leaf.rotation.z = drop - 0.15;
          frondPivot.add(leaf);
        }
      }

      fx = nx;
      fy = ny;
    }

    crown.add(frondPivot);
  }

  return bakeGroupByMaterial(group, true, true);
}

/**
 * Builds a realistic Tropical Rainforest Tree and bakes all sub-parts by shared material.
 */
export function buildJungleTree(scale = 1.0): THREE.Group {
  const group = new THREE.Group();
  const barkTex = getJungleBarkTexture();
  const foliageBump = getFoliageBumpTexture();

  const barkMat = getCachedMaterial('jungle_bark', () =>
    new THREE.MeshStandardMaterial({
      color: 0x543d2b,
      map: barkTex,
      bumpMap: barkTex,
      bumpScale: 0.06,
      roughness: 0.92,
      metalness: 0.02,
    })
  );

  const canopyMats = [
    getCachedMaterial('jungle_canopy_0', () =>
      new THREE.MeshStandardMaterial({
        color: 0x1b4d20,
        bumpMap: foliageBump,
        bumpScale: 0.08,
        roughness: 0.72,
        metalness: 0.03,
      })
    ),
    getCachedMaterial('jungle_canopy_1', () =>
      new THREE.MeshStandardMaterial({
        color: 0x26692b,
        bumpMap: foliageBump,
        bumpScale: 0.08,
        roughness: 0.64,
        metalness: 0.04,
      })
    ),
    getCachedMaterial('jungle_canopy_2', () =>
      new THREE.MeshStandardMaterial({
        color: 0x358233,
        bumpMap: foliageBump,
        bumpScale: 0.07,
        roughness: 0.56,
        metalness: 0.05,
      })
    ),
    getCachedMaterial('jungle_canopy_3', () =>
      new THREE.MeshStandardMaterial({
        color: 0x489939,
        bumpMap: foliageBump,
        bumpScale: 0.06,
        roughness: 0.52,
        metalness: 0.05,
      })
    ),
  ];

  const vineMat = getCachedMaterial('jungle_vine', () => {
    const m = new THREE.MeshStandardMaterial({
      color: 0x4c7828,
      roughness: 0.78,
    });
    m.userData.noShadow = true;
    return m;
  });

  const trunkH = 5.4 * scale;
  const trunkGeo = sculptOrganicGeometry(
    new THREE.CylinderGeometry(0.38 * scale, 0.68 * scale, trunkH, 10, 4),
    0.07,
    2.2,
    scale * 3.1
  );
  const trunk = new THREE.Mesh(trunkGeo, barkMat);
  trunk.position.y = trunkH * 0.5;
  group.add(trunk);

  for (let r = 0; r < 5; r++) {
    const a = (r / 5) * Math.PI * 2 + 0.2;
    const rootGeo = new THREE.BoxGeometry(0.18 * scale, 1.85 * scale, 0.95 * scale);
    const rootMesh = new THREE.Mesh(rootGeo, barkMat);
    rootMesh.position.set(
      Math.cos(a) * 0.52 * scale,
      0.68 * scale,
      Math.sin(a) * 0.52 * scale
    );
    rootMesh.rotation.y = -a + Math.PI / 2;
    rootMesh.rotation.x = 0.42;
    group.add(rootMesh);
  }

  const boughOffsets = [
    { x: 0.9, y: trunkH - 0.5 * scale, z: 0.6, rz: -0.58, rx: 0.35 },
    { x: -0.85, y: trunkH - 0.4 * scale, z: 0.55, rz: 0.55, rx: 0.32 },
    { x: 0.5, y: trunkH - 0.3 * scale, z: -0.85, rz: -0.35, rx: -0.55 },
    { x: -0.65, y: trunkH - 0.45 * scale, z: -0.7, rz: 0.45, rx: -0.45 },
  ];
  for (const b of boughOffsets) {
    const boughGeo = new THREE.CylinderGeometry(0.14 * scale, 0.26 * scale, 2.2 * scale, 7);
    const bough = new THREE.Mesh(boughGeo, barkMat);
    bough.position.set(b.x * 0.55 * scale, b.y, b.z * 0.55 * scale);
    bough.rotation.z = b.rz;
    bough.rotation.x = b.rx;
    group.add(bough);
  }

  const crownClusters = [
    { x: 0.0, y: trunkH + 0.85 * scale, z: 0.0, r: 2.05, sy: 0.62, matIdx: 2 },
    { x: 1.25, y: trunkH + 0.15 * scale, z: 0.75, r: 1.65, sy: 0.58, matIdx: 1 },
    { x: -1.2, y: trunkH + 0.25 * scale, z: 0.65, r: 1.6, sy: 0.6, matIdx: 0 },
    { x: 0.7, y: trunkH + 0.3 * scale, z: -1.15, r: 1.55, sy: 0.58, matIdx: 1 },
    { x: -0.95, y: trunkH + 0.2 * scale, z: -0.95, r: 1.5, sy: 0.62, matIdx: 0 },
    { x: 0.45, y: trunkH + 1.35 * scale, z: 0.3, r: 1.35, sy: 0.65, matIdx: 3 },
    { x: -0.5, y: trunkH + 1.25 * scale, z: -0.25, r: 1.3, sy: 0.62, matIdx: 2 },
    { x: 0.0, y: trunkH - 0.25 * scale, z: 0.0, r: 2.25, sy: 0.48, matIdx: 0 },
  ];

  for (let i = 0; i < crownClusters.length; i++) {
    const c = crownClusters[i];
    const crownGeo = sculptOrganicGeometry(
      new THREE.IcosahedronGeometry(c.r * scale, 1),
      0.16,
      2.4,
      i * 1.9 + scale
    );
    crownGeo.scale(1.12, c.sy, 1.12);
    const crownMesh = new THREE.Mesh(crownGeo, canopyMats[c.matIdx]);
    crownMesh.position.set(c.x * scale, c.y, c.z * scale);
    group.add(crownMesh);
  }

  for (let v = 0; v < 4; v++) {
    const va = (v / 4) * Math.PI * 2 + 0.35;
    const vr = (1.35 + (v % 2) * 0.45) * scale;
    const vineH = (2.2 + (v % 3) * 0.55) * scale;
    const vine = new THREE.Mesh(
      new THREE.CylinderGeometry(0.032 * scale, 0.02 * scale, vineH, 5),
      vineMat
    );
    vine.position.set(Math.cos(va) * vr, trunkH - vineH * 0.45, Math.sin(va) * vr);
    vine.rotation.z = Math.cos(va) * 0.08;
    group.add(vine);
  }

  return bakeGroupByMaterial(group, true, true);
}

/**
 * Builds a realistic multi-frond botanical tropical fern bush and bakes into 3 draw calls.
 */
export function buildJungleFern(scale = 1.0): THREE.Group {
  const group = new THREE.Group();
  const stemMat = getCachedMaterial('fern_stem', () => {
    const m = new THREE.MeshStandardMaterial({ color: 0x2e5c1e, roughness: 0.7 });
    m.userData.noShadow = true;
    return m;
  });
  const leafletMatDark = getCachedMaterial('fern_leaf_dark', () => {
    const m = new THREE.MeshStandardMaterial({
      color: 0x2e7d32,
      roughness: 0.5,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
    m.userData.noShadow = true;
    return m;
  });
  const leafletMatBright = getCachedMaterial('fern_leaf_bright', () => {
    const m = new THREE.MeshStandardMaterial({
      color: 0x4caf50,
      roughness: 0.45,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
    m.userData.noShadow = true;
    return m;
  });

  const frondCount = 8;
  for (let i = 0; i < frondCount; i++) {
    const isInner = i >= 5;
    const a = (i / (isInner ? 3 : 5)) * Math.PI * 2 + (isInner ? 0.5 : 0);
    const frondPivot = new THREE.Group();
    frondPivot.rotation.y = a;
    frondPivot.rotation.z = isInner ? -0.48 : -0.78;

    const len = (isInner ? 0.88 : 1.15) * scale;
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015 * scale, 0.03 * scale, len, 4),
      stemMat
    );
    stem.position.y = len * 0.5;
    frondPivot.add(stem);

    const pairs = 5;
    for (let p = 0; p < pairs; p++) {
      const pt = (p + 0.5) / pairs;
      const py = pt * len;
      const pinnaLen = (0.36 - Math.abs(pt - 0.45) * 0.34) * scale;
      for (const side of [-1, 1]) {
        const pinnaGeo = new THREE.ConeGeometry(0.065 * scale, pinnaLen, 3);
        pinnaGeo.scale(0.3, 1.0, 1.0);
        const pinna = new THREE.Mesh(
          pinnaGeo,
          (i + p) % 2 === 0 ? leafletMatBright : leafletMatDark
        );
        pinna.position.set(0, py, side * pinnaLen * 0.44);
        pinna.rotation.x = side * (Math.PI * 0.42);
        pinna.rotation.z = -0.25;
        frondPivot.add(pinna);
      }
    }

    group.add(frondPivot);
  }
  return bakeGroupByMaterial(group, false, true);
}

/**
 * Builds an ancient Grand Rainforest Canopy Giant tree with massive fluted buttress roots,
 * sprawling high horizontal boughs, hanging lianas, and multi-tier emerald umbrella canopies.
 */
export function buildGrandCanopyTree(scale = 1.0): THREE.Group {
  const group = new THREE.Group();
  const barkTex = getJungleBarkTexture();
  const foliageBump = getFoliageBumpTexture();

  const barkMat = getCachedMaterial('jungle_bark_ancient', () =>
    new THREE.MeshStandardMaterial({
      color: 0x4a3525,
      map: barkTex,
      bumpMap: barkTex,
      bumpScale: 0.08,
      roughness: 0.94,
      metalness: 0.02,
    })
  );

  const canopyMats = [
    getCachedMaterial('grand_canopy_0', () =>
      new THREE.MeshStandardMaterial({
        color: 0x144018,
        bumpMap: foliageBump,
        bumpScale: 0.08,
        roughness: 0.76,
        metalness: 0.03,
      })
    ),
    getCachedMaterial('grand_canopy_1', () =>
      new THREE.MeshStandardMaterial({
        color: 0x1e5a24,
        bumpMap: foliageBump,
        bumpScale: 0.08,
        roughness: 0.68,
        metalness: 0.04,
      })
    ),
    getCachedMaterial('grand_canopy_2', () =>
      new THREE.MeshStandardMaterial({
        color: 0x2e752c,
        bumpMap: foliageBump,
        bumpScale: 0.07,
        roughness: 0.6,
        metalness: 0.04,
      })
    ),
    getCachedMaterial('grand_canopy_sun', () =>
      new THREE.MeshStandardMaterial({
        color: 0x419036,
        bumpMap: foliageBump,
        bumpScale: 0.06,
        roughness: 0.52,
        metalness: 0.05,
      })
    ),
  ];

  const lianaMat = getCachedMaterial('grand_liana', () => {
    const m = new THREE.MeshStandardMaterial({
      color: 0x3d6622,
      roughness: 0.82,
    });
    m.userData.noShadow = true;
    return m;
  });

  const trunkH = 8.8 * scale;
  const trunkGeo = sculptOrganicGeometry(
    new THREE.CylinderGeometry(0.55 * scale, 1.15 * scale, trunkH, 12, 5),
    0.1,
    2.1,
    scale * 2.7
  );
  const trunk = new THREE.Mesh(trunkGeo, barkMat);
  trunk.position.y = trunkH * 0.5;
  group.add(trunk);

  // 5 Massive Fluted Buttress Roots sprawling outward from base
  for (let r = 0; r < 5; r++) {
    const a = (r / 5) * Math.PI * 2 + 0.15;
    const buttressGeo = new THREE.BoxGeometry(0.24 * scale, 3.2 * scale, 2.1 * scale);
    const buttress = new THREE.Mesh(buttressGeo, barkMat);
    buttress.position.set(
      Math.cos(a) * 0.95 * scale,
      1.1 * scale,
      Math.sin(a) * 0.95 * scale
    );
    buttress.rotation.y = -a + Math.PI / 2;
    buttress.rotation.x = 0.52;
    group.add(buttress);
  }

  // 6 Broad Boughs reaching out in high canopy
  const boughSpecs = [
    { x: 1.8, y: trunkH - 0.8 * scale, z: 0.9, rz: -0.65, rx: 0.32, len: 3.4 },
    { x: -1.7, y: trunkH - 0.6 * scale, z: 1.1, rz: 0.62, rx: 0.38, len: 3.2 },
    { x: 0.9, y: trunkH - 0.4 * scale, z: -1.9, rz: -0.32, rx: -0.68, len: 3.3 },
    { x: -1.4, y: trunkH - 0.7 * scale, z: -1.3, rz: 0.52, rx: -0.48, len: 3.1 },
    { x: 0.2, y: trunkH + 0.2 * scale, z: 1.8, rz: -0.15, rx: 0.58, len: 2.8 },
    { x: -0.3, y: trunkH + 0.3 * scale, z: -1.6, rz: 0.18, rx: -0.55, len: 2.9 },
  ];
  for (const b of boughSpecs) {
    const boughGeo = new THREE.CylinderGeometry(0.18 * scale, 0.38 * scale, b.len * scale, 8);
    const bough = new THREE.Mesh(boughGeo, barkMat);
    bough.position.set(b.x * 0.5 * scale, b.y, b.z * 0.5 * scale);
    bough.rotation.z = b.rz;
    bough.rotation.x = b.rx;
    group.add(bough);
  }

  // Multi-tier majestic canopy clouds
  const crownClusters = [
    { x: 0.0, y: trunkH + 1.4 * scale, z: 0.0, r: 3.2, sy: 0.52, matIdx: 3 },
    { x: 2.2, y: trunkH + 0.4 * scale, z: 1.1, r: 2.6, sy: 0.48, matIdx: 2 },
    { x: -2.1, y: trunkH + 0.6 * scale, z: 1.3, r: 2.5, sy: 0.5, matIdx: 1 },
    { x: 1.1, y: trunkH + 0.7 * scale, z: -2.2, r: 2.4, sy: 0.48, matIdx: 2 },
    { x: -1.6, y: trunkH + 0.5 * scale, z: -1.6, r: 2.3, sy: 0.52, matIdx: 0 },
    { x: 0.3, y: trunkH + 1.1 * scale, z: 2.1, r: 2.2, sy: 0.48, matIdx: 3 },
    { x: -0.4, y: trunkH + 1.2 * scale, z: -1.9, r: 2.1, sy: 0.5, matIdx: 1 },
    { x: 0.7, y: trunkH + 2.2 * scale, z: 0.5, r: 2.2, sy: 0.56, matIdx: 3 },
    { x: -0.8, y: trunkH + 2.0 * scale, z: -0.4, r: 2.0, sy: 0.54, matIdx: 2 },
    { x: 0.0, y: trunkH - 0.4 * scale, z: 0.0, r: 3.5, sy: 0.42, matIdx: 0 },
  ];

  for (let i = 0; i < crownClusters.length; i++) {
    const c = crownClusters[i];
    const crownGeo = sculptOrganicGeometry(
      new THREE.IcosahedronGeometry(c.r * scale, 1),
      0.18,
      2.2,
      i * 2.3 + scale * 4.1
    );
    crownGeo.scale(1.18, c.sy, 1.18);
    const crownMesh = new THREE.Mesh(crownGeo, canopyMats[c.matIdx]);
    crownMesh.position.set(c.x * scale, c.y, c.z * scale);
    group.add(crownMesh);
  }

  // 8 Hanging Lianas descending from branches toward the forest floor
  for (let v = 0; v < 8; v++) {
    const va = (v / 8) * Math.PI * 2 + 0.22;
    const vr = (2.2 + (v % 3) * 0.6) * scale;
    const vineH = (4.2 + (v % 4) * 0.8) * scale;
    const vine = new THREE.Mesh(
      new THREE.CylinderGeometry(0.038 * scale, 0.02 * scale, vineH, 5),
      lianaMat
    );
    vine.position.set(Math.cos(va) * vr, trunkH - vineH * 0.42, Math.sin(va) * vr);
    vine.rotation.z = Math.cos(va) * 0.06;
    vine.rotation.x = Math.sin(va) * 0.06;
    group.add(vine);
  }

  return bakeGroupByMaterial(group, true, true);
}

/**
 * Builds a dense multi-stem tropical bush with broad paddle leaves and tropical leaf veins.
 */
export function buildJungleBush(scale = 1.0): THREE.Group {
  const group = new THREE.Group();
  const leafMatDark = getCachedMaterial('bush_leaf_dark', () => {
    const m = new THREE.MeshStandardMaterial({
      color: 0x226b27,
      roughness: 0.55,
      metalness: 0.04,
      side: THREE.DoubleSide,
    });
    m.userData.noShadow = true;
    return m;
  });
  const leafMatBright = getCachedMaterial('bush_leaf_bright', () => {
    const m = new THREE.MeshStandardMaterial({
      color: 0x3d9435,
      roughness: 0.48,
      metalness: 0.04,
      side: THREE.DoubleSide,
    });
    m.userData.noShadow = true;
    return m;
  });
  const twigMat = getCachedMaterial('bush_twig', () => {
    const m = new THREE.MeshStandardMaterial({ color: 0x423022, roughness: 0.85 });
    m.userData.noShadow = true;
    return m;
  });

  const leafCount = 9;
  for (let i = 0; i < leafCount; i++) {
    const a = (i / leafCount) * Math.PI * 2 + (i % 3) * 0.2;
    const rDist = (0.28 + (i % 3) * 0.12) * scale;
    const leafPivot = new THREE.Group();
    leafPivot.position.set(Math.cos(a) * rDist, 0.1 * scale, Math.sin(a) * rDist);
    leafPivot.rotation.y = a;
    leafPivot.rotation.z = -0.42 - (i % 3) * 0.14;

    const stemLen = 0.55 * scale;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02 * scale, 0.035 * scale, stemLen, 4), twigMat);
    stem.position.y = stemLen * 0.5;
    leafPivot.add(stem);

    const bladeLen = (0.95 + (i % 3) * 0.25) * scale;
    const bladeGeo = new THREE.ConeGeometry(0.28 * scale, bladeLen, 4);
    bladeGeo.scale(0.2, 1.0, 1.0);
    const blade = new THREE.Mesh(bladeGeo, i % 2 === 0 ? leafMatBright : leafMatDark);
    blade.position.y = stemLen + bladeLen * 0.45;
    leafPivot.add(blade);

    group.add(leafPivot);
  }

  return bakeGroupByMaterial(group, false, true);
}

/**
 * Builds a realistic mossy fallen hardwood log with shattered ends, shelf polypore fungi, and moss patches.
 */
export function buildFallenLog(length = 3.6, radius = 0.28): THREE.Group {
  const group = new THREE.Group();
  const barkTex = getJungleBarkTexture();
  const bumpTex = createOrganicBumpTexture(128);

  const logMat = getCachedMaterial('fallen_log_bark', () =>
    new THREE.MeshStandardMaterial({
      color: 0x4a3728,
      map: barkTex,
      bumpMap: barkTex,
      bumpScale: 0.06,
      roughness: 0.92,
      metalness: 0.02,
    })
  );
  const heartwoodMat = getCachedMaterial('fallen_log_heart', () =>
    new THREE.MeshStandardMaterial({
      color: 0xc8b7a6,
      bumpMap: bumpTex,
      bumpScale: 0.04,
      roughness: 0.72,
    })
  );
  const mossMat = getCachedMaterial('fallen_log_moss', () => {
    const m = new THREE.MeshStandardMaterial({
      color: 0x3d702d,
      bumpMap: bumpTex,
      bumpScale: 0.08,
      roughness: 0.88,
    });
    m.userData.noShadow = true;
    return m;
  });
  const fungusMat = getCachedMaterial('fallen_log_fungus', () => {
    const m = new THREE.MeshStandardMaterial({
      color: 0xd9c5a0,
      roughness: 0.55,
      metalness: 0.04,
    });
    m.userData.noShadow = true;
    return m;
  });

  const logGeo = sculptOrganicGeometry(
    new THREE.CylinderGeometry(radius * 0.85, radius, length, 9, 4),
    0.08,
    2.5,
    length
  );
  logGeo.rotateZ(Math.PI / 2);
  const logMesh = new THREE.Mesh(logGeo, logMat);
  logMesh.position.y = radius * 0.88;
  group.add(logMesh);

  // Heartwood cut ends
  for (const endSign of [-1, 1]) {
    const endCap = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.78, radius * 0.8, 0.08, 8),
      heartwoodMat
    );
    endCap.rotation.z = Math.PI / 2;
    endCap.position.set(endSign * (length * 0.5), radius * 0.88, 0);
    group.add(endCap);
  }

  // Moss patches along the top curvature
  for (let m = 0; m < 4; m++) {
    const xOff = (m - 1.5) * (length * 0.22);
    const mossGeo = new THREE.BoxGeometry(0.72, 0.06, radius * 1.5);
    const mossMesh = new THREE.Mesh(mossGeo, mossMat);
    mossMesh.position.set(xOff, radius * 1.76, 0);
    group.add(mossMesh);
  }

  // Shelf bracket fungi (polypores) sticking out of the sides
  for (let f = 0; f < 3; f++) {
    const fx = (f - 1) * 0.9;
    const fungus = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.04, 0.03, 7), fungusMat);
    fungus.rotation.x = Math.PI / 2;
    fungus.position.set(fx, radius * 0.9, radius * 0.95);
    group.add(fungus);
  }

  return bakeGroupByMaterial(group, true, true);
}

/**
 * Builds a slender understory jungle palm with graceful arching fronds.
 */
export function buildJungleUnderstoryPalm(scale = 1.0): THREE.Group {
  const group = new THREE.Group();
  const palmBarkTex = getPalmBarkTexture();

  const trunkMat = getCachedMaterial('understory_palm_trunk', () =>
    new THREE.MeshStandardMaterial({
      color: 0x5e4530,
      map: palmBarkTex,
      roughness: 0.85,
    })
  );
  const frondMat = getCachedMaterial('understory_frond', () => {
    const m = new THREE.MeshStandardMaterial({
      color: 0x33883b,
      roughness: 0.48,
      side: THREE.DoubleSide,
    });
    m.userData.noShadow = true;
    return m;
  });

  const trunkH = 2.8 * scale;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08 * scale, 0.12 * scale, trunkH, 7),
    trunkMat
  );
  trunk.position.y = trunkH * 0.5;
  trunk.rotation.z = -0.08;
  group.add(trunk);

  const frondCount = 6;
  for (let f = 0; f < frondCount; f++) {
    const a = (f / frondCount) * Math.PI * 2;
    const frondPivot = new THREE.Group();
    frondPivot.position.set(0, trunkH, 0);
    frondPivot.rotation.y = a;
    frondPivot.rotation.z = -0.55;

    const stemLen = 1.6 * scale;
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015 * scale, 0.025 * scale, stemLen, 4),
      trunkMat
    );
    stem.position.y = stemLen * 0.5;
    frondPivot.add(stem);

    for (let p = 0; p < 4; p++) {
      const pt = (p + 0.5) / 4;
      const bladeLen = (0.55 - pt * 0.22) * scale;
      for (const side of [-1, 1]) {
        const bladeGeo = new THREE.ConeGeometry(0.08 * scale, bladeLen, 3);
        bladeGeo.scale(0.25, 1.0, 1.0);
        const blade = new THREE.Mesh(bladeGeo, frondMat);
        blade.position.set(0, pt * stemLen, side * bladeLen * 0.45);
        blade.rotation.x = side * 1.1;
        blade.rotation.z = -0.22;
        frondPivot.add(blade);
      }
    }
    group.add(frondPivot);
  }

  return bakeGroupByMaterial(group, false, true);
}

/**
 * Builds the animated crystal-clear freshwater stream ribbon and stepped waterfall face.
 */
export function buildFreshwaterStreamWaterMesh(): THREE.Group {
  const group = new THREE.Group();

  // 1. Sinuous stream water ribbon (from z=37 down to z=68.5)
  const zSteps = 34;
  const ribbonGeom = new THREE.BufferGeometry();
  const vertices: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];

  const waterDeep = new THREE.Color(0x38bdf8);
  const waterRapid = new THREE.Color(0xe0f2fe);
  const waterShallow = new THREE.Color(0x7dd3fc);

  for (let zi = 0; zi <= zSteps; zi++) {
    const tz = zi / zSteps;
    const z = 37.0 + tz * (68.5 - 37.0);
    const streamX = -12.5 - ((z - 33) / 36) * 3.5 + (Math.sin((z - 33) * 0.26) * 1.45 + Math.cos((z - 33) * 0.14) * 0.7 - 0.7);
    const streamInfoT = Math.max(0, Math.min(1, (z - 33) / 35));
    const waterY = 6.2 * Math.pow(1 - streamInfoT, 1.35) + 0.12;

    const streamHalfWidth = 1.15;
    for (let xi = 0; xi <= 4; xi++) {
      const tx = xi / 4; // 0 to 1
      const x = streamX + (tx - 0.5) * (streamHalfWidth * 2);
      vertices.push(x, waterY, z);
      uvs.push(tx, tz * 8.0);

      const edgeDist = Math.abs(tx - 0.5) * 2; // 0 at center, 1 at edge
      const isRapid = (zi % 5 === 0 && edgeDist < 0.6);
      if (isRapid) {
        colors.push(waterRapid.r, waterRapid.g, waterRapid.b);
      } else if (edgeDist > 0.75) {
        colors.push(waterShallow.r, waterShallow.g, waterShallow.b);
      } else {
        colors.push(waterDeep.r, waterDeep.g, waterDeep.b);
      }
    }
  }

  // Create quad indices
  for (let zi = 0; zi < zSteps; zi++) {
    for (let xi = 0; xi < 4; xi++) {
      const row1 = zi * 5;
      const row2 = (zi + 1) * 5;
      const a = row1 + xi;
      const b = row1 + xi + 1;
      const c = row2 + xi;
      const d = row2 + xi + 1;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  const baseYs = new Float32Array(vertices.length / 3);
  for (let i = 0; i < baseYs.length; i++) {
    baseYs[i] = vertices[i * 3 + 1];
  }

  ribbonGeom.setIndex(indices);
  ribbonGeom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  ribbonGeom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  ribbonGeom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  ribbonGeom.computeVertexNormals();

  const streamMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.12,
    metalness: 0.08,
    transparent: true,
    opacity: 0.78,
    side: THREE.DoubleSide,
  });
  streamMat.userData.noShadow = true;

  const ribbonMesh = new THREE.Mesh(ribbonGeom, streamMat);
  ribbonMesh.name = 'freshwater_stream_ribbon';
  ribbonMesh.userData.baseY = baseYs;
  group.add(ribbonMesh);

  // 2. Cascading stepped waterfall curtain at z: 33..37.2, x: -12.5
  const waterfallSteps = 12;
  const wfGeom = new THREE.BufferGeometry();
  const wfVerts: number[] = [];
  const wfColors: number[] = [];
  const wfIndices: number[] = [];
  const wfUvs: number[] = [];

  const foamColor = new THREE.Color(0xf0fdfa);
  const dropColor = new THREE.Color(0x38bdf8);

  for (let si = 0; si <= waterfallSteps; si++) {
    const st = si / waterfallSteps;
    const curZ = 33.0 + st * 4.2;
    const curX = -12.5 - ((curZ - 33) / 36) * 3.5;
    const curY = 10.4 - st * 4.2;

    for (let xi = 0; xi <= 4; xi++) {
      const tx = xi / 4;
      const x = curX + (tx - 0.5) * 2.5;
      wfVerts.push(x, curY, curZ);
      wfUvs.push(tx, st * 4.0);

      if (si === 0 || si === waterfallSteps || Math.random() > 0.4) {
        wfColors.push(foamColor.r, foamColor.g, foamColor.b);
      } else {
        wfColors.push(dropColor.r, dropColor.g, dropColor.b);
      }
    }
  }

  for (let si = 0; si < waterfallSteps; si++) {
    for (let xi = 0; xi < 4; xi++) {
      const row1 = si * 5;
      const row2 = (si + 1) * 5;
      const a = row1 + xi;
      const b = row1 + xi + 1;
      const c = row2 + xi;
      const d = row2 + xi + 1;
      wfIndices.push(a, c, b);
      wfIndices.push(b, c, d);
    }
  }

  wfGeom.setIndex(wfIndices);
  wfGeom.setAttribute('position', new THREE.Float32BufferAttribute(wfVerts, 3));
  wfGeom.setAttribute('color', new THREE.Float32BufferAttribute(wfColors, 3));
  wfGeom.setAttribute('uv', new THREE.Float32BufferAttribute(wfUvs, 2));
  wfGeom.computeVertexNormals();

  const wfMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.15,
    metalness: 0.05,
    transparent: true,
    opacity: 0.86,
    side: THREE.DoubleSide,
  });
  wfMat.userData.noShadow = true;

  const wfMesh = new THREE.Mesh(wfGeom, wfMat);
  wfMesh.name = 'waterfall_cascade_mesh';
  group.add(wfMesh);

  return group;
}

/**
 * Builds the 3D water surface meshes for all Stage 2 Freshwater Lakes and Flowing Rivers across the map,
 * merged into a single GPU draw call with vertex-colored shallow banks, deep turquoise basins, and river rapids.
 */
export function buildStage2LakesAndRiversMesh(): THREE.Group {
  const group = new THREE.Group();
  const vertices: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const lakeDeep = new THREE.Color(0x0284c7);
  const lakeMid = new THREE.Color(0x0ea5e9);
  const lakeShallow = new THREE.Color(0x7dd3fc);
  const riverRapid = new THREE.Color(0xe0f2fe);
  const riverFlow = new THREE.Color(0x38bdf8);
  const scratchColor = new THREE.Color();

  // 1. Build 3D Water Surface Discs for all Stage 2 Lakes
  const radialSegs = 36;
  const ringSegs = 4;
  for (const lake of STAGE2_LAKES) {
    const baseVertexIndex = vertices.length / 3;
    // Center vertex
    vertices.push(lake.x, lake.waterLevel, lake.z);
    colors.push(lakeDeep.r, lakeDeep.g, lakeDeep.b);
    uvs.push(0.5, 0.5);

    for (let r = 1; r <= ringSegs; r++) {
      const rt = r / ringSegs;
      for (let s = 0; s <= radialSegs; s++) {
        const theta = (s / radialSegs) * Math.PI * 2;
        const unitX = Math.cos(theta);
        const unitZ = Math.sin(theta);
        const rawDx = unitX * lake.radiusX * rt;
        const rawDz = unitZ * lake.radiusZ * rt;
        const shoreRipple =
          1 +
          0.06 * Math.sin(rawDx * 0.18 + rawDz * 0.14) +
          0.04 * Math.cos(rawDx * 0.11 - rawDz * 0.21);
        const wx = lake.x + rawDx * shoreRipple * 1.05;
        const wz = lake.z + rawDz * shoreRipple * 1.05;

        vertices.push(wx, lake.waterLevel, wz);
        uvs.push(0.5 + unitX * rt * 0.5, 0.5 + unitZ * rt * 0.5);

        if (rt < 0.65) {
          scratchColor.lerpColors(lakeDeep, lakeMid, rt / 0.65);
        } else {
          scratchColor.lerpColors(lakeMid, lakeShallow, (rt - 0.65) / 0.35);
        }
        colors.push(scratchColor.r, scratchColor.g, scratchColor.b);
      }
    }

    // Center fan triangles (ring 1) — upward +Y normal winding (baseVertexIndex, v1, v2)
    const ringStride = radialSegs + 1;
    for (let s = 0; s < radialSegs; s++) {
      const v1 = baseVertexIndex + 1 + s;
      const v2 = baseVertexIndex + 1 + s + 1;
      indices.push(baseVertexIndex, v1, v2);
    }

    // Outer concentric ring quads — upward +Y normal winding
    for (let r = 1; r < ringSegs; r++) {
      const row1 = baseVertexIndex + 1 + (r - 1) * ringStride;
      const row2 = baseVertexIndex + 1 + r * ringStride;
      for (let s = 0; s < radialSegs; s++) {
        const a = row1 + s;
        const b = row1 + s + 1;
        const c = row2 + s;
        const d = row2 + s + 1;
        indices.push(a, c, b);
        indices.push(b, c, d);
      }
    }
  }

  // Helper to check if a river point is inside a lake disc (so river ribbons don't draw a seam across lake centers)
  const isInsideLakeDisc = (x: number, z: number): boolean => {
    for (const lake of STAGE2_LAKES) {
      const dx = x - lake.x;
      const dz = z - lake.z;
      const normR = Math.hypot(dx / lake.radiusX, dz / lake.radiusZ);
      if (normR < 0.86) return true;
    }
    return false;
  };

  // 2. Build 3D Flowing Water Ribbons for all Stage 2 Rivers
  const subStepsPerSeg = 28;
  const cols = 4;
  for (const river of STAGE2_RIVERS) {
    const pts = river.waypoints;
    const halfW = river.width * 0.56;
    const meanderAmp = river.width < 6 ? 1.15 : 8.5;

    for (let seg = 0; seg < pts.length - 1; seg++) {
      const p0 = pts[seg];
      const p1 = pts[seg + 1];
      const vx = p1.x - p0.x;
      const vz = p1.z - p0.z;
      const segLen = Math.hypot(vx, vz) || 1;
      const perpX = -vz / segLen;
      const perpZ = vx / segLen;

      const baseIdx = vertices.length / 3;
      const stepInsideLake: boolean[] = [];

      for (let step = 0; step <= subStepsPerSeg; step++) {
        const t = step / subStepsPerSeg;
        const projX = p0.x + vx * t;
        const projZ = p0.z + vz * t;
        const meander = Math.sin(t * Math.PI * 2) * meanderAmp;
        const cx = projX + perpX * meander;
        const cz = projZ + perpZ * meander;
        const wy = p0.waterY + (p1.waterY - p0.waterY) * t;
        stepInsideLake.push(isInsideLakeDisc(cx, cz));

        for (let c = 0; c <= cols; c++) {
          const ct = c / cols; // 0..1 across river width
          const offset = (ct - 0.5) * 2 * halfW;
          const wx = cx + perpX * offset;
          const wz = cz + perpZ * offset;
          vertices.push(wx, wy, wz);
          uvs.push(ct, (seg + t) * 6.0);

          const edgeDist = Math.abs(ct - 0.5) * 2;
          if (step % 4 === 0 && edgeDist < 0.55) {
            colors.push(riverRapid.r, riverRapid.g, riverRapid.b);
          } else if (edgeDist > 0.72) {
            colors.push(lakeShallow.r, lakeShallow.g, lakeShallow.b);
          } else {
            colors.push(riverFlow.r, riverFlow.g, riverFlow.b);
          }
        }
      }

      const rowStride = cols + 1;
      for (let step = 0; step < subStepsPerSeg; step++) {
        // Skip river ribbon quads that lie deep inside a circular lake basin
        if (stepInsideLake[step] && stepInsideLake[step + 1]) continue;

        const r1 = baseIdx + step * rowStride;
        const r2 = baseIdx + (step + 1) * rowStride;
        for (let c = 0; c < cols; c++) {
          const a = r1 + c;
          const b = r1 + c + 1;
          const d0 = r2 + c;
          const d1 = r2 + c + 1;
          indices.push(a, d0, b);
          indices.push(b, d0, d1);
        }
      }
    }
  }

  const waterGeo = new THREE.BufferGeometry();
  waterGeo.setIndex(indices);
  waterGeo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  waterGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  waterGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  waterGeo.computeVertexNormals();

  const waterMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.14,
    metalness: 0.12,
    transparent: true,
    opacity: 0.84,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  waterMat.userData.noShadow = true;

  const waterMesh = new THREE.Mesh(waterGeo, waterMat);
  waterMesh.name = 'stage2_lakes_and_rivers_mesh';
  waterMesh.frustumCulled = false;
  group.add(waterMesh);

  return group;
}

/**
 * Merges all meshes in a procedural group into a single BufferGeometry for high-performance InstancedMesh usage.
 */
export function createMergedGeometryFromGroup(group: THREE.Group): THREE.BufferGeometry {
  group.updateMatrixWorld(true);
  const geoms: THREE.BufferGeometry[] = [];
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      let g = child.geometry.clone();
      g.applyMatrix4(child.matrixWorld);
      if (g.index) g = g.toNonIndexed();
      const allowed = new Set(['position', 'normal', 'uv']);
      for (const attr of Object.keys(g.attributes)) {
        if (!allowed.has(attr)) g.deleteAttribute(attr);
      }
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) {
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      }
      geoms.push(g);
    }
  });
  const merged = mergeGeometries(geoms, false);
  for (const g of geoms) g.dispose();
  return merged ?? new THREE.BufferGeometry();
}

export function createMasterFernGeometry(): THREE.BufferGeometry {
  return createMergedGeometryFromGroup(buildJungleFern(1.0));
}

export function createMasterBushGeometry(): THREE.BufferGeometry {
  return createMergedGeometryFromGroup(buildJungleBush(1.0));
}

export function createMasterFallenLogGeometry(): THREE.BufferGeometry {
  return createMergedGeometryFromGroup(buildFallenLog(3.4, 0.26));
}

export function createMasterUnderstoryPalmGeometry(): THREE.BufferGeometry {
  return createMergedGeometryFromGroup(buildJungleUnderstoryPalm(1.0));
}

export function createMasterRockGeometry(): THREE.BufferGeometry {
  const geo = sculptOrganicGeometry(
    new THREE.IcosahedronGeometry(0.72, 2),
    0.22,
    2.6,
    3.7
  );
  geo.scale(1.2, 0.75, 1.05);
  return geo;
}


/**
 * Wildlife builders: Realistic Crab, Iguana Lizard, Capuchin Monkey, Wild Boar, and Tropical Birds.
 */
export interface WildlifeActor {
  id: string;
  kind: 'crab' | 'lizard' | 'monkey' | 'boar';
  group: THREE.Group;
  baseScale: number;
  physics: AnimalPhysicsState;
  homeX: number;
  homeZ: number;
  phase: number;
  speed: number;
  hostile?: boolean;
  hp?: number;
  maxHp?: number;
  attackCooldown?: number;
  hitFlashTimer?: number;
}

export function buildBeachCrab(): THREE.Group {
  const g = new THREE.Group();
  const shellMat = getCachedMaterial('crab_shell', () =>
    new THREE.MeshStandardMaterial({
      color: 0xc63f17,
      roughness: 0.35,
      metalness: 0.08,
    })
  );
  const bellyMat = getCachedMaterial('crab_belly', () =>
    new THREE.MeshStandardMaterial({
      color: 0xf4a261,
      roughness: 0.5,
    })
  );
  const clawMat = getCachedMaterial('crab_claw', () =>
    new THREE.MeshStandardMaterial({
      color: 0xe65100,
      roughness: 0.3,
      metalness: 0.1,
    })
  );
  const eyeMat = getCachedMaterial('wildlife_eye', () =>
    new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.1,
    })
  );

  const carapaceGeo = sculptOrganicGeometry(new THREE.SphereGeometry(0.24, 12, 10), 0.06, 5.0, 1.2);
  carapaceGeo.scale(1.42, 0.52, 1.08);
  const body = new THREE.Mesh(carapaceGeo, shellMat);
  body.position.y = 0.17;
  g.add(body);

  const underbelly = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), bellyMat);
  underbelly.scale.set(1.25, 0.35, 0.95);
  underbelly.position.y = 0.13;
  g.add(underbelly);

  for (const side of [-1, 1]) {
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.09, 5), shellMat);
    stalk.position.set(side * 0.1, 0.24, -0.22);
    stalk.rotation.z = side * -0.25;
    g.add(stalk);

    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 6, 6), eyeMat);
    eye.position.set(side * 0.115, 0.28, -0.23);
    g.add(eye);

    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.042, 0.22, 6), shellMat);
    arm.position.set(side * 0.28, 0.19, -0.18);
    arm.rotation.z = side * -0.65;
    arm.rotation.x = 0.55;
    g.add(arm);

    const outerPincer = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.26, 6), clawMat);
    outerPincer.position.set(side * 0.36, 0.23, -0.32);
    outerPincer.rotation.x = -0.75;
    outerPincer.rotation.z = side * -0.35;
    g.add(outerPincer);

    const innerDactyl = new THREE.Mesh(new THREE.ConeGeometry(0.048, 0.19, 5), clawMat);
    innerDactyl.position.set(side * 0.3, 0.21, -0.33);
    innerDactyl.rotation.x = -0.75;
    innerDactyl.rotation.z = side * 0.25;
    g.add(innerDactyl);

    for (let l = 0; l < 4; l++) {
      const zOff = -0.12 + l * 0.09;
      const femur = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.02, 0.22, 5), shellMat);
      femur.position.set(side * 0.32, 0.16, zOff);
      femur.rotation.z = side * 1.1;
      g.add(femur);

      const tibia = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.22, 5), clawMat);
      tibia.rotation.x = Math.PI;
      tibia.position.set(side * 0.44, 0.08, zOff);
      tibia.rotation.z = side * -0.35;
      g.add(tibia);
    }
  }
  return bakeGroupByMaterial(g, false, false);
}

export function buildJungleLizard(): THREE.Group {
  const g = new THREE.Group();
  const lizardMat = getCachedMaterial('lizard_skin', () =>
    new THREE.MeshStandardMaterial({
      color: 0x558b2f,
      roughness: 0.42,
      metalness: 0.06,
    })
  );
  const bellyMat = getCachedMaterial('lizard_belly', () =>
    new THREE.MeshStandardMaterial({
      color: 0x9ccc65,
      roughness: 0.55,
    })
  );
  const crestMat = getCachedMaterial('lizard_crest', () =>
    new THREE.MeshStandardMaterial({
      color: 0xd4e157,
      roughness: 0.6,
    })
  );
  const eyeMat = getCachedMaterial('wildlife_eye', () =>
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1 })
  );

  const torsoGeo = new THREE.CylinderGeometry(0.085, 0.105, 0.58, 8);
  torsoGeo.rotateX(Math.PI / 2);
  torsoGeo.scale(1.12, 0.82, 1.0);
  const torso = new THREE.Mesh(torsoGeo, lizardMat);
  torso.position.y = 0.15;
  g.add(torso);

  const headGeo = new THREE.ConeGeometry(0.105, 0.28, 7);
  headGeo.rotateX(-Math.PI / 2);
  headGeo.scale(1.0, 0.78, 1.0);
  const head = new THREE.Mesh(headGeo, lizardMat);
  head.position.set(0, 0.18, -0.38);
  g.add(head);

  const dewlap = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.14, 4), bellyMat);
  dewlap.rotation.x = Math.PI * 0.65;
  dewlap.scale.set(0.3, 1.0, 1.0);
  dewlap.position.set(0, 0.1, -0.32);
  g.add(dewlap);

  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 6), eyeMat);
    eye.position.set(side * 0.065, 0.21, -0.35);
    g.add(eye);
  }

  for (let s = 0; s < 8; s++) {
    const spine = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.07, 4), crestMat);
    spine.position.set(0, 0.23, -0.24 + s * 0.07);
    spine.rotation.x = -0.3;
    g.add(spine);
  }

  for (const sx of [-1, 1]) {
    for (const sz of [-0.18, 0.18]) {
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.022, 0.18, 5), lizardMat);
      upper.position.set(sx * 0.14, 0.12, sz);
      upper.rotation.z = sx * 1.05;
      g.add(upper);

      const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.015, 0.16, 5), bellyMat);
      lower.position.set(sx * 0.21, 0.05, sz - 0.02);
      lower.rotation.z = sx * 0.25;
      g.add(lower);
    }
  }

  const tailGeo = new THREE.ConeGeometry(0.078, 0.72, 7);
  tailGeo.rotateX(Math.PI / 2);
  const tail = new THREE.Mesh(tailGeo, crestMat);
  tail.position.set(0, 0.13, 0.62);
  g.add(tail);

  return bakeGroupByMaterial(g, false, false);
}

export function buildJungleMonkey(): THREE.Group {
  const g = new THREE.Group();
  const furMat = getCachedMaterial('monkey_fur', () =>
    new THREE.MeshStandardMaterial({
      color: 0x5d4037,
      roughness: 0.86,
    })
  );
  const creamFurMat = getCachedMaterial('monkey_cream', () =>
    new THREE.MeshStandardMaterial({
      color: 0xd7ccc8,
      roughness: 0.75,
    })
  );
  const faceMat = getCachedMaterial('monkey_face', () =>
    new THREE.MeshStandardMaterial({
      color: 0xccb098,
      roughness: 0.58,
    })
  );
  const eyeMat = getCachedMaterial('wildlife_eye', () =>
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1 })
  );

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 10), furMat);
  body.scale.set(0.88, 1.28, 0.82);
  body.position.y = 0.44;
  g.add(body);

  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), creamFurMat);
  chest.scale.set(0.85, 1.15, 0.65);
  chest.position.set(0, 0.46, -0.08);
  g.add(chest);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.185, 10, 10), furMat);
  head.position.set(0, 0.79, -0.06);
  g.add(head);

  const faceMask = new THREE.Mesh(new THREE.SphereGeometry(0.145, 8, 8), creamFurMat);
  faceMask.position.set(0, 0.79, -0.11);
  g.add(faceMask);

  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.095, 8, 8), faceMat);
  muzzle.scale.set(1.05, 0.85, 1.1);
  muzzle.position.set(0, 0.74, -0.2);
  g.add(muzzle);

  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 6), faceMat);
    ear.scale.set(0.4, 1.0, 0.85);
    ear.position.set(side * 0.185, 0.79, -0.05);
    g.add(ear);

    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.024, 6, 6), eyeMat);
    eye.position.set(side * 0.06, 0.81, -0.225);
    g.add(eye);

    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.038, 0.42, 7), furMat);
    arm.position.set(side * 0.22, 0.42, -0.08);
    arm.rotation.x = 0.35;
    arm.rotation.z = side * -0.18;
    g.add(arm);

    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.042, 0.34, 7), furMat);
    leg.position.set(side * 0.12, 0.17, 0.02);
    g.add(leg);
  }

  const tailLower = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.038, 0.46, 6), furMat);
  tailLower.position.set(0, 0.48, 0.28);
  tailLower.rotation.x = 0.72;
  g.add(tailLower);

  const tailTip = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.028, 6, 12, Math.PI * 1.35), furMat);
  tailTip.rotation.y = Math.PI / 2;
  tailTip.position.set(0, 0.68, 0.46);
  g.add(tailTip);

  return bakeGroupByMaterial(g, true, false);
}

export function buildWildBoar(): THREE.Group {
  const g = new THREE.Group();
  const hideMat = getCachedMaterial('boar_hide', () =>
    new THREE.MeshStandardMaterial({
      color: 0x3b261e,
      roughness: 0.9,
    })
  );
  const maneMat = getCachedMaterial('boar_mane', () =>
    new THREE.MeshStandardMaterial({
      color: 0x1f130e,
      roughness: 0.95,
    })
  );
  const snoutMat = getCachedMaterial('boar_snout', () =>
    new THREE.MeshStandardMaterial({
      color: 0x6d4c41,
      roughness: 0.65,
    })
  );
  const tuskMat = getCachedMaterial('boar_tusk', () =>
    new THREE.MeshStandardMaterial({
      color: 0xfff8e1,
      roughness: 0.25,
      metalness: 0.08,
    })
  );
  const eyeMat = getCachedMaterial('wildlife_eye', () =>
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1 })
  );

  const bodyGeo = sculptOrganicGeometry(new THREE.SphereGeometry(0.38, 12, 10), 0.06, 4.0, 2.5);
  bodyGeo.scale(0.88, 0.86, 1.48);
  const body = new THREE.Mesh(bodyGeo, hideMat);
  body.position.set(0, 0.48, 0);
  g.add(body);

  const shoulderHump = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), hideMat);
  shoulderHump.scale.set(0.86, 0.95, 0.95);
  shoulderHump.position.set(0, 0.56, -0.22);
  g.add(shoulderHump);

  const mane = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.78), maneMat);
  mane.position.set(0, 0.82, -0.05);
  mane.rotation.x = 0.12;
  g.add(mane);

  const headGeo = new THREE.ConeGeometry(0.28, 0.56, 8);
  headGeo.rotateX(-Math.PI / 2);
  headGeo.scale(0.92, 0.88, 1.0);
  const head = new THREE.Mesh(headGeo, hideMat);
  head.position.set(0, 0.46, -0.62);
  g.add(head);

  const snoutDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.08, 8), snoutMat);
  snoutDisc.rotation.x = Math.PI / 2 - 0.15;
  snoutDisc.position.set(0, 0.41, -0.88);
  g.add(snoutDisc);

  for (const side of [-1, 1]) {
    const tusk = new THREE.Mesh(new THREE.ConeGeometry(0.042, 0.24, 6), tuskMat);
    tusk.position.set(side * 0.15, 0.44, -0.78);
    tusk.rotation.x = -0.28;
    tusk.rotation.z = side * -0.32;
    g.add(tusk);

    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.18, 5), hideMat);
    ear.position.set(side * 0.2, 0.68, -0.45);
    ear.rotation.z = side * -0.45;
    ear.rotation.x = -0.25;
    g.add(ear);

    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.026, 6, 6), eyeMat);
    eye.position.set(side * 0.16, 0.54, -0.58);
    g.add(eye);
  }

  for (const sx of [-0.19, 0.19]) {
    for (const sz of [-0.34, 0.34]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.052, 0.36, 7), hideMat);
      leg.position.set(sx, 0.2, sz);
      g.add(leg);

      const hoof = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.07, 7), maneMat);
      hoof.position.set(sx, 0.035, sz - 0.01);
      g.add(hoof);
    }
  }

  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.018, 0.26, 5), maneMat);
  tail.position.set(0, 0.48, 0.58);
  tail.rotation.x = -0.55;
  g.add(tail);

  return bakeGroupByMaterial(g, true, false);
}

export interface BirdActor {
  species: 'seagull' | 'parrot' | 'toucan';
  group: THREE.Group;
  leftWing: THREE.Mesh;
  rightWing: THREE.Mesh;
  orbitCenterX: number;
  orbitCenterZ: number;
  orbitRadius: number;
  altitude: number;
  angle: number;
  speed: number;
}

export function buildBird(species: 'seagull' | 'parrot' | 'toucan'): {
  group: THREE.Group;
  leftWing: THREE.Mesh;
  rightWing: THREE.Mesh;
} {
  const rawBody = new THREE.Group();

  const bodyColor =
    species === 'seagull' ? 0xf8fafc : species === 'parrot' ? 0xd32f2f : 0x1c1c1c;
  const breastColor =
    species === 'seagull' ? 0xffffff : species === 'parrot' ? 0xe53935 : 0xffb300;
  const wingColor =
    species === 'seagull' ? 0xb0bec5 : species === 'parrot' ? 0x1565c0 : 0x263238;
  const wingTipColor =
    species === 'seagull' ? 0x37474f : species === 'parrot' ? 0xfdd835 : 0x111111;
  const beakColor =
    species === 'seagull' ? 0xfbc02d : species === 'parrot' ? 0xfff176 : 0xff6f00;

  const bodyMat = getCachedMaterial(`bird_body_${species}`, () =>
    new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.5 })
  );
  const breastMat = getCachedMaterial(`bird_breast_${species}`, () =>
    new THREE.MeshStandardMaterial({ color: breastColor, roughness: 0.5 })
  );
  const wingMat = getCachedMaterial(`bird_wing_${species}`, () =>
    new THREE.MeshStandardMaterial({ color: wingColor, roughness: 0.45 })
  );
  const tipMat = getCachedMaterial(`bird_tip_${species}`, () =>
    new THREE.MeshStandardMaterial({ color: wingTipColor, roughness: 0.5 })
  );
  const beakMat = getCachedMaterial(`bird_beak_${species}`, () =>
    new THREE.MeshStandardMaterial({ color: beakColor, roughness: 0.3 })
  );

  const bodyGeo = new THREE.SphereGeometry(0.18, 9, 8);
  bodyGeo.scale(0.88, 0.82, 1.85);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  rawBody.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 8, 8), breastMat);
  head.position.set(0, 0.08, -0.28);
  rawBody.add(head);

  const beakLen = species === 'toucan' ? 0.42 : 0.18;
  const beakRadius = species === 'toucan' ? 0.085 : 0.05;
  const beak = new THREE.Mesh(new THREE.ConeGeometry(beakRadius, beakLen, 6), beakMat);
  beak.rotation.x = -Math.PI / 2 - 0.12;
  beak.position.set(0, 0.07, -0.38 - beakLen * 0.45);
  rawBody.add(beak);

  const tailGeo = new THREE.ConeGeometry(0.16, 0.34, 5);
  tailGeo.rotateX(-Math.PI / 2 + 0.15);
  tailGeo.scale(1.2, 0.22, 1.0);
  const tail = new THREE.Mesh(tailGeo, tipMat);
  tail.position.set(0, 0.02, 0.38);
  rawBody.add(tail);

  const group = bakeGroupByMaterial(rawBody, false, false);

  const buildFeatheredWing = (side: number): THREE.Mesh => {
    const wingRoot = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.032, 0.26), wingMat);
    wingRoot.position.set(side * 0.28, 0.04, -0.02);

    const outerTip = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.38, 4), tipMat);
    outerTip.rotation.z = side * (-Math.PI / 2);
    outerTip.rotation.y = side * -0.22;
    outerTip.scale.set(1.0, 1.0, 0.25);
    outerTip.position.set(side * 0.36, 0, 0.02);
    wingRoot.add(outerTip);

    return wingRoot;
  };

  const leftWing = buildFeatheredWing(-1);
  const rightWing = buildFeatheredWing(1);
  group.add(leftWing, rightWing);

  return { group, leftWing, rightWing };
}

/**
 * Builds realistic collectible resource meshes and bakes static geometry by material.
 */
export function buildInteractableMesh(
  type: 'coconut' | 'wood' | 'food' | 'rope' | 'campfire' | 'supply_box' | 'boat_site'
): THREE.Group {
  const g = new THREE.Group();
  const bumpTex = createOrganicBumpTexture(128);

  const shadowRadius =
    type === 'boat_site' ? 1.85 : type === 'supply_box' ? 0.95 : type === 'campfire' ? 0.85 : 0.46;
  const shadowGeo = new THREE.CircleGeometry(shadowRadius, 16);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = getCachedMaterial('contact_shadow', () =>
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
    })
  );
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.position.y = 0.02;
  g.add(shadow);

  if (type === 'coconut') {
    const huskMat = getCachedMaterial('res_coco_husk', () =>
      new THREE.MeshStandardMaterial({
        color: 0x5d4037,
        bumpMap: bumpTex,
        bumpScale: 0.03,
        roughness: 0.78,
      })
    );
    const innerFibersMat = getCachedMaterial('res_coco_inner', () =>
      new THREE.MeshStandardMaterial({
        color: 0x8d6e63,
        bumpMap: bumpTex,
        bumpScale: 0.04,
        roughness: 0.85,
      })
    );
    const poreMat = getCachedMaterial('res_coco_pore', () =>
      new THREE.MeshStandardMaterial({ color: 0x271914, roughness: 0.9 })
    );

    const husk = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 12, 10, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65),
      huskMat
    );
    husk.scale.set(1.12, 0.95, 1.08);
    husk.position.y = 0.26;
    g.add(husk);

    const nut = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), innerFibersMat);
    nut.scale.set(0.96, 1.12, 0.96);
    nut.position.y = 0.28;
    g.add(nut);

    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const pore = new THREE.Mesh(new THREE.SphereGeometry(0.032, 6, 6), poreMat);
      pore.position.set(Math.cos(a) * 0.065, 0.52, Math.sin(a) * 0.065);
      g.add(pore);
    }
  } else if (type === 'wood') {
    const barkTex = getJungleBarkTexture();
    const logMat = getCachedMaterial('res_wood_bark', () =>
      new THREE.MeshStandardMaterial({
        color: 0x795548,
        map: barkTex,
        bumpMap: barkTex,
        bumpScale: 0.04,
        roughness: 0.88,
      })
    );
    const heartwoodMat = getCachedMaterial('res_wood_heart', () =>
      new THREE.MeshStandardMaterial({
        color: 0xd7ccc8,
        roughness: 0.65,
      })
    );
    const ropeMat = getCachedMaterial('res_wood_rope', () =>
      new THREE.MeshStandardMaterial({
        color: 0xc5a880,
        roughness: 0.75,
      })
    );

    const logSpecs = [
      { y: 0.13, z: -0.15, ry: 0.14, r: 0.11 },
      { y: 0.13, z: 0.15, ry: -0.12, r: 0.115 },
      { y: 0.28, z: 0.0, ry: 0.05, r: 0.105 },
    ];
    for (const spec of logSpecs) {
      const logGroup = new THREE.Group();
      logGroup.position.set(0, spec.y, spec.z);
      logGroup.rotation.y = spec.ry;

      const barkCyl = new THREE.Mesh(
        new THREE.CylinderGeometry(spec.r * 0.92, spec.r, 0.98, 8),
        logMat
      );
      barkCyl.rotation.z = Math.PI / 2;
      logGroup.add(barkCyl);

      const endCap = new THREE.Mesh(
        new THREE.CylinderGeometry(spec.r * 0.78, spec.r * 0.85, 1.0, 8),
        heartwoodMat
      );
      endCap.rotation.z = Math.PI / 2;
      logGroup.add(endCap);

      g.add(logGroup);
    }

    for (const xOff of [-0.18, 0.18]) {
      const lashing = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.032, 6, 12), ropeMat);
      lashing.rotation.y = Math.PI / 2;
      lashing.position.set(xOff, 0.19, 0);
      g.add(lashing);
    }
  } else if (type === 'food') {
    const leafMat = getCachedMaterial('res_food_leaf', () =>
      new THREE.MeshStandardMaterial({
        color: 0x2e7d32,
        roughness: 0.42,
        metalness: 0.06,
        side: THREE.DoubleSide,
      })
    );
    const papayaMat = getCachedMaterial('res_food_papaya', () =>
      new THREE.MeshStandardMaterial({
        color: 0xff8f00,
        roughness: 0.28,
        metalness: 0.05,
        emissive: 0x3e1e00,
      })
    );
    const bananaMat = getCachedMaterial('res_food_banana', () =>
      new THREE.MeshStandardMaterial({
        color: 0xffd600,
        roughness: 0.32,
      })
    );

    for (let l = 0; l < 5; l++) {
      const la = (l / 5) * Math.PI * 2;
      const leafGeo = new THREE.ConeGeometry(0.24, 0.65, 5);
      leafGeo.scale(1.0, 1.0, 0.22);
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      leaf.position.set(Math.cos(la) * 0.25, 0.14, Math.sin(la) * 0.25);
      leaf.rotation.y = -la;
      leaf.rotation.z = -1.15;
      g.add(leaf);
    }

    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.165, 10, 8), papayaMat);
      fruit.scale.set(0.88, 1.25, 0.88);
      fruit.position.set(Math.cos(a) * 0.16, 0.26, Math.sin(a) * 0.16);
      fruit.rotation.z = 0.35;
      fruit.rotation.y = a;
      g.add(fruit);
    }

    const banana = new THREE.Mesh(
      new THREE.TorusGeometry(0.14, 0.045, 6, 10, Math.PI * 0.85),
      bananaMat
    );
    banana.position.set(0, 0.36, 0);
    banana.rotation.x = 0.6;
    g.add(banana);
  } else if (type === 'campfire') {
    const stoneMat = getCachedMaterial('camp_stone', () =>
      new THREE.MeshStandardMaterial({
        color: 0x546e7a,
        bumpMap: bumpTex,
        bumpScale: 0.05,
        roughness: 0.88,
      })
    );
    const ashMat = getCachedMaterial('camp_ash', () =>
      new THREE.MeshStandardMaterial({
        color: 0x262220,
        roughness: 0.95,
      })
    );
    const barkTex = getJungleBarkTexture();
    const woodMat = getCachedMaterial('camp_wood', () =>
      new THREE.MeshStandardMaterial({
        color: 0x4e342e,
        map: barkTex,
        bumpMap: barkTex,
        bumpScale: 0.04,
        roughness: 0.9,
      })
    );

    const ashBed = new THREE.Mesh(new THREE.ConeGeometry(0.65, 0.18, 12), ashMat);
    ashBed.position.y = 0.09;
    g.add(ashBed);

    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const stoneGeo = sculptOrganicGeometry(
        new THREE.DodecahedronGeometry(0.22, 1),
        0.15,
        3.5,
        i * 1.7
      );
      stoneGeo.scale(1.15, 0.78, 0.95);
      const stone = new THREE.Mesh(stoneGeo, stoneMat);
      stone.position.set(Math.cos(a) * 0.72, 0.14, Math.sin(a) * 0.72);
      stone.rotation.y = a;
      g.add(stone);
    }

    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.09, 1.02, 7), woodMat);
      log.position.set(Math.cos(a) * 0.26, 0.38, Math.sin(a) * 0.26);
      log.rotation.z = Math.cos(a) * 0.52;
      log.rotation.x = -Math.sin(a) * 0.52;
      g.add(log);
    }

    const outerFlameMat = getCachedMaterial('camp_flame_outer', () =>
      new THREE.MeshStandardMaterial({
        color: 0xff5722,
        emissive: 0xff3d00,
        emissiveIntensity: 2.5,
        roughness: 0.15,
        transparent: true,
        opacity: 0.92,
      })
    );
    const innerFlameMat = getCachedMaterial('camp_flame_inner', () =>
      new THREE.MeshStandardMaterial({
        color: 0xfff176,
        emissive: 0xffc107,
        emissiveIntensity: 3.2,
        roughness: 0.1,
      })
    );

    const flame = new THREE.Mesh(
      sculptOrganicGeometry(new THREE.ConeGeometry(0.42, 1.08, 9), 0.14, 4.0, 1.1),
      outerFlameMat
    );
    flame.position.y = 0.58;
    flame.name = 'campfire_flame';
    flame.visible = false;

    const innerCore = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.72, 7), innerFlameMat);
    innerCore.position.y = -0.1;
    flame.add(innerCore);

    g.add(flame);
  } else if (type === 'rope') {
    const ropeMat = getCachedMaterial('res_wood_rope', () =>
      new THREE.MeshStandardMaterial({
        color: 0xc5a880,
        bumpMap: bumpTex,
        bumpScale: 0.03,
        roughness: 0.78,
      })
    );
    for (let i = 0; i < 3; i++) {
      const coil = new THREE.Mesh(
        new THREE.TorusGeometry(0.24 - i * 0.025, 0.045, 7, 16),
        ropeMat
      );
      coil.rotation.x = Math.PI / 2;
      coil.position.y = 0.06 + i * 0.065;
      g.add(coil);
    }
  } else if (type === 'supply_box') {
    // Sea-Drifted Shipwreck Supply Crate with Iron Bands, Rope Coil, Rolled Map, Knife & Signal Lantern
    const barkTex = getJungleBarkTexture();
    const crateWoodMat = getCachedMaterial('crate_wood', () =>
      new THREE.MeshStandardMaterial({
        color: 0x8d5b36,
        map: barkTex,
        bumpMap: barkTex,
        bumpScale: 0.04,
        roughness: 0.82,
      })
    );
    const ironStrapMat = getCachedMaterial('crate_iron', () =>
      new THREE.MeshStandardMaterial({
        color: 0x37474f,
        roughness: 0.42,
        metalness: 0.78,
      })
    );
    const ropeMat = getCachedMaterial('res_wood_rope', () =>
      new THREE.MeshStandardMaterial({
        color: 0xc5a880,
        roughness: 0.75,
      })
    );
    const mapParchmentMat = getCachedMaterial('crate_map', () =>
      new THREE.MeshStandardMaterial({
        color: 0xefe0b9,
        roughness: 0.65,
      })
    );
    const steelMat = getCachedMaterial('knife_steel', () =>
      new THREE.MeshStandardMaterial({
        color: 0xe0e7ee,
        roughness: 0.18,
        metalness: 0.92,
      })
    );
    const beaconMat = getCachedMaterial('crate_beacon_glow', () =>
      new THREE.MeshStandardMaterial({
        color: 0x00e5ff,
        emissive: 0x00b8d4,
        emissiveIntensity: 2.8,
        roughness: 0.15,
      })
    );

    const crateBody = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.72, 0.86), crateWoodMat);
    crateBody.position.y = 0.38;
    g.add(crateBody);

    for (const xOff of [-0.46, 0, 0.46]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.76, 0.9), ironStrapMat);
      band.position.set(xOff, 0.38, 0);
      g.add(band);
    }

    // Coiled rope on crate lid
    const topCoil = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.045, 7, 16), ropeMat);
    topCoil.rotation.x = Math.PI / 2;
    topCoil.position.set(-0.26, 0.78, 0.1);
    g.add(topCoil);

    // Rolled Island Map scroll on lid
    const mapScroll = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.48, 10), mapParchmentMat);
    mapScroll.rotation.z = Math.PI / 2;
    mapScroll.rotation.y = 0.35;
    mapScroll.position.set(0.2, 0.79, -0.12);
    g.add(mapScroll);

    // Survival Knife sticking into the crate top
    const lidBlade = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.38, 4), steelMat);
    lidBlade.rotation.z = -0.25;
    lidBlade.rotation.x = Math.PI;
    lidBlade.position.set(0.05, 0.92, 0.15);
    g.add(lidBlade);

    // Salvage buoy lantern beacon so player can spot the crate bobbing in the surf
    const beaconPole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 1.35, 7), ironStrapMat);
    beaconPole.position.set(-0.48, 1.05, -0.32);
    g.add(beaconPole);

    const beaconOrb = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 1), beaconMat);
    beaconOrb.position.set(-0.48, 1.82, -0.32);
    beaconOrb.name = 'crate_beacon';
    g.add(beaconOrb);
  } else if (type === 'boat_site') {
    // Multi-stage 3D Outrigger Escape Boat Shipyard on the beach shoreline
    const barkTex = getJungleBarkTexture();
    const fabricTex = getWeatheredFabricTexture();
    const hullWoodMat = getCachedMaterial('boat_hull_wood', () =>
      new THREE.MeshStandardMaterial({
        color: 0x6d4c33,
        map: barkTex,
        bumpMap: barkTex,
        bumpScale: 0.04,
        roughness: 0.82,
      })
    );
    const deckPlankMat = getCachedMaterial('boat_deck_plank', () =>
      new THREE.MeshStandardMaterial({
        color: 0xa17852,
        roughness: 0.72,
      })
    );
    const ropeMat = getCachedMaterial('res_wood_rope', () =>
      new THREE.MeshStandardMaterial({
        color: 0xc5a880,
        roughness: 0.75,
      })
    );
    const sailCanvasMat = getCachedMaterial('boat_sail_canvas', () =>
      new THREE.MeshStandardMaterial({
        color: 0xf5ebd6,
        map: fabricTex,
        roughness: 0.78,
        side: THREE.DoubleSide,
      })
    );
    const emblemMat = getCachedMaterial('castaway_bandana', () =>
      new THREE.MeshStandardMaterial({
        color: 0xa83226,
        roughness: 0.72,
        side: THREE.DoubleSide,
      })
    );

    // Stage 0: Shoreline Launch Slipway Rollers & Blueprint Corner Stakes (always visible)
    const stage0 = new THREE.Group();
    stage0.name = 'boat_stage_0';
    for (const zOff of [-1.1, 0, 1.1]) {
      const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 2.2, 8), hullWoodMat);
      roller.rotation.z = Math.PI / 2;
      roller.position.set(0, 0.11, zOff);
      stage0.add(roller);
    }
    for (const sx of [-1.05, 1.05]) {
      for (const sz of [-1.45, 1.45]) {
        const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.75, 6), deckPlankMat);
        stake.position.set(sx, 0.35, sz);
        stage0.add(stake);
      }
    }
    g.add(stage0);

    // Stage 1: Heavy Lashed 5-Log Keel & Carved Bow Hull
    const stage1 = new THREE.Group();
    stage1.name = 'boat_stage_1';
    stage1.visible = false;
    for (let i = -2; i <= 2; i++) {
      const logLen = 3.2 - Math.abs(i) * 0.22;
      const hullLog = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, logLen, 10), hullWoodMat);
      hullLog.rotation.x = Math.PI / 2;
      hullLog.position.set(i * 0.34, 0.28, 0);
      stage1.add(hullLog);

      const bowCone = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.65, 8), hullWoodMat);
      bowCone.rotation.x = Math.PI / 2;
      bowCone.position.set(i * 0.34, 0.32, logLen * 0.5 + 0.28);
      stage1.add(bowCone);
    }
    for (const zLash of [-0.95, 0, 0.95]) {
      const lash = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.08, 0.14), ropeMat);
      lash.position.set(0, 0.44, zLash);
      stage1.add(lash);
    }
    g.add(stage1);

    // Stage 2: Outrigger Crossbeams, Stabilizer Pontoons & Timber Deck Planks
    const stage2 = new THREE.Group();
    stage2.name = 'boat_stage_2';
    stage2.visible = false;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.09, 2.35), deckPlankMat);
    deck.position.set(0, 0.49, 0);
    stage2.add(deck);

    for (const zBeam of [-0.75, 0.75]) {
      const crossBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 8), hullWoodMat);
      crossBeam.rotation.z = Math.PI / 2;
      crossBeam.position.set(0, 0.48, zBeam);
      stage2.add(crossBeam);
    }
    for (const side of [-1, 1]) {
      const pontoon = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 2.6, 8), deckPlankMat);
      pontoon.rotation.x = Math.PI / 2;
      pontoon.position.set(side * 1.55, 0.26, 0);
      stage2.add(pontoon);
    }
    g.add(stage2);

    // Stage 3: Tall Timber Mast, Yardarm, Billowing Canvas Sail & Steering Oar
    const stage3 = new THREE.Group();
    stage3.name = 'boat_stage_3';
    stage3.visible = false;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.095, 3.6, 10), hullWoodMat);
    mast.position.set(0, 2.25, 0.1);
    stage3.add(mast);

    const yardarm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.2, 8), deckPlankMat);
    yardarm.rotation.z = Math.PI / 2;
    yardarm.position.set(0, 3.35, 0.15);
    stage3.add(yardarm);

    const sailGeo = sculptOrganicGeometry(new THREE.PlaneGeometry(2.0, 2.1, 8, 8), 0.12, 1.8, 2.4);
    const sail = new THREE.Mesh(sailGeo, sailCanvasMat);
    sail.position.set(0, 2.25, 0.28);
    stage3.add(sail);

    const sunStripe = new THREE.Mesh(new THREE.CircleGeometry(0.42, 16), emblemMat);
    sunStripe.position.set(0, 2.28, 0.36);
    stage3.add(sunStripe);

    // Supply crate & water barrel lashed onto the finished boat deck
    const rationBox = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.36, 0.42), deckPlankMat);
    rationBox.position.set(-0.35, 0.72, -0.55);
    stage3.add(rationBox);

    g.add(stage3);
  }

  return bakeGroupByMaterial(
    g,
    type === 'campfire' || type === 'supply_box' || type === 'boat_site',
    true
  );
}

/**
 * Builds soft volumetric god rays (sun shafts) piercing down through dense jungle canopy gaps.
 */
export function buildVolumetricGodRays(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'volumetric_god_rays';

  const rayCoords = [
    { x: -14.2, z: 46.5, yTop: 16.5, height: 13.0, rx: 0.18, rz: -0.12, radius: 1.4 },
    { x: -11.5, z: 36.5, yTop: 18.0, height: 14.5, rx: 0.12, rz: 0.08, radius: 1.6 },
    { x: -6.0,  z: 44.0, yTop: 15.5, height: 12.0, rx: 0.15, rz: -0.10, radius: 1.2 },
    { x: 2.5,   z: 49.0, yTop: 16.0, height: 12.5, rx: 0.20, rz: -0.15, radius: 1.3 },
    { x: -18.5, z: 54.0, yTop: 14.5, height: 11.5, rx: 0.14, rz: -0.08, radius: 1.5 },
    { x: 8.5,   z: 43.0, yTop: 16.5, height: 13.0, rx: 0.16, rz: -0.12, radius: 1.4 },
  ];

  const rayMat = getCachedMaterial('volumetric_god_ray_mat', () => {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xfffae0,
      transparent: true,
      opacity: 0.17,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    mat.userData.noShadow = true;
    return mat;
  });

  rayCoords.forEach((coord, i) => {
    const coneGeo = new THREE.CylinderGeometry(coord.radius * 0.35, coord.radius * 1.6, coord.height, 14, 1, true);
    const rayMesh = new THREE.Mesh(coneGeo, rayMat);
    rayMesh.position.set(coord.x, coord.yTop - coord.height * 0.5, coord.z);
    rayMesh.rotation.set(coord.rx, 0, coord.rz);
    rayMesh.name = `god_ray_${i}`;
    group.add(rayMesh);
  });

  const bakedRays = bakeGroupByMaterial(group, false, false);
  bakedRays.name = 'volumetric_god_rays';
  return bakedRays;
}

/**
 * Builds animated shoreline surf foam fringe that swells against the southern beach shelf.
 */
export function buildShorelineSurfFoam(): THREE.Mesh {
  const segments = 64;
  const geom = new THREE.BufferGeometry();
  const verts: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = Math.PI * 0.39 + t * Math.PI * 0.22; // Southern Castaway Cove shoreline curve
    const rInner = 66.5;
    const rOuter = 74.0;

    const xInner = Math.cos(angle) * rInner;
    const zInner = Math.sin(angle) * rInner;
    const xOuter = Math.cos(angle) * rOuter;
    const zOuter = Math.sin(angle) * rOuter;

    verts.push(xInner, 0.08, zInner);
    uvs.push(0, t * 10.0);

    verts.push(xOuter, 0.02, zOuter);
    uvs.push(1, t * 10.0);
  }

  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = (i + 1) * 2;
    const d = (i + 1) * 2 + 1;
    indices.push(a, b, c);
    indices.push(b, d, c);
  }

  geom.setIndex(indices);
  geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.computeVertexNormals();

  const foamMat = new THREE.MeshStandardMaterial({
    color: 0xf0fdfa,
    roughness: 0.18,
    metalness: 0.08,
    transparent: true,
    opacity: 0.48,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  foamMat.userData.noShadow = true;

  const mesh = new THREE.Mesh(geom, foamMat);
  mesh.name = 'shoreline_surf_foam';
  return mesh;
}

/**
 * Builds concentric splash and ripple rings at the waterfall plunge pool.
 */
export function buildWaterfallSplashRings(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'waterfall_splash_rings';
  const poolMat = getCachedMaterial('waterfall_plunge_ring_mat', () => {
    const m = new THREE.MeshBasicMaterial({
      color: 0xe0f7fa,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    m.userData.noShadow = true;
    return m;
  });

  for (let i = 0; i < 3; i++) {
    const ringGeo = new THREE.RingGeometry(0.35 + i * 0.45, 0.65 + i * 0.5, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, poolMat);
    ring.position.set(-11.5, 6.22, 37.5);
    ring.name = `wf_ring_${i}`;
    group.add(ring);
  }
  return group;
}

/**
 * Builds a cluster of glowing bioluminescent mushrooms for fallen logs and damp jungle hollows.
 */
export function buildBioluminescentMushroomCluster(scale = 1.0): THREE.Group {
  const group = new THREE.Group();
  const stalkMat = getCachedMaterial('shroom_stalk_mat', () => {
    const m = new THREE.MeshStandardMaterial({
      color: 0xdfede2,
      roughness: 0.7,
      metalness: 0.05,
    });
    m.userData.noShadow = true;
    return m;
  });
  const cyanCapMat = getCachedMaterial('shroom_cap_cyan', () => {
    const m = new THREE.MeshStandardMaterial({
      color: 0x06b6d4,
      emissive: 0x0891b2,
      emissiveIntensity: 0.85,
      roughness: 0.25,
      metalness: 0.1,
    });
    m.userData.noShadow = true;
    return m;
  });
  const amberCapMat = getCachedMaterial('shroom_cap_amber', () => {
    const m = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xd97706,
      emissiveIntensity: 0.85,
      roughness: 0.25,
      metalness: 0.1,
    });
    m.userData.noShadow = true;
    return m;
  });

  const shroomData = [
    { x: 0, z: 0, h: 0.32, r: 0.14, isAmber: false },
    { x: 0.16, z: 0.12, h: 0.44, r: 0.18, isAmber: true },
    { x: -0.15, z: 0.08, h: 0.26, r: 0.12, isAmber: false },
    { x: 0.08, z: -0.16, h: 0.38, r: 0.15, isAmber: true },
  ];

  for (const s of shroomData) {
    const stalk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02 * scale, 0.035 * scale, s.h * scale, 6),
      stalkMat
    );
    stalk.position.set(s.x * scale, (s.h * 0.5) * scale, s.z * scale);
    group.add(stalk);

    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(s.r * scale, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.65),
      s.isAmber ? amberCapMat : cyanCapMat
    );
    cap.position.set(s.x * scale, s.h * scale, s.z * scale);
    group.add(cap);
  }

  return bakeGroupByMaterial(group, false, true);
}

/**
 * Updates bioluminescent mushroom cap emissive intensity in O(1) time via shared material cache.
 */
export function updateBioluminescentMushroomEmissive(intensity: number): void {
  const cyanCap = _materialCache.get('shroom_cap_cyan') as THREE.MeshStandardMaterial | undefined;
  const amberCap = _materialCache.get('shroom_cap_amber') as THREE.MeshStandardMaterial | undefined;
  if (cyanCap) cyanCap.emissiveIntensity = intensity;
  if (amberCap) amberCap.emissiveIntensity = intensity;
}

/**
 * Returns shared cached PBR materials for rocks, boulders, shells, and shipwreck props
 * so bakeGroupByMaterial merges them into minimal GPU draw calls.
 */
export function getSharedEnvironmentMaterials() {
  const bumpTex = createOrganicBumpTexture(256);
  const barkTex = getJungleBarkTexture();
  const fabricTex = getWeatheredFabricTexture();

  const wetBasaltMat = getCachedMaterial('env_wet_basalt', () =>
    new THREE.MeshStandardMaterial({
      color: 0x242322,
      bumpMap: bumpTex,
      bumpScale: 0.12,
      roughness: 0.65,
      metalness: 0.15,
    })
  );

  const mossyRockMat = getCachedMaterial('env_mossy_rock', () =>
    new THREE.MeshStandardMaterial({
      color: 0x384534,
      bumpMap: bumpTex,
      bumpScale: 0.1,
      roughness: 0.85,
      metalness: 0.04,
    })
  );

  const rockMat = getCachedMaterial('env_coastal_rock', () =>
    new THREE.MeshStandardMaterial({
      color: 0x56524e,
      bumpMap: bumpTex,
      bumpScale: 0.08,
      roughness: 0.86,
      metalness: 0.05,
    })
  );

  const shellMat = getCachedMaterial('env_conch_shell', () => {
    const m = new THREE.MeshStandardMaterial({
      color: 0xfff0db,
      roughness: 0.28,
      metalness: 0.08,
    });
    m.userData.noShadow = true;
    return m;
  });

  const timberMat = getCachedMaterial('env_shipwreck_timber', () =>
    new THREE.MeshStandardMaterial({
      color: 0x4e342e,
      map: barkTex,
      bumpMap: bumpTex,
      bumpScale: 0.05,
      roughness: 0.9,
    })
  );

  const sailMat = getCachedMaterial('env_shipwreck_sail', () =>
    new THREE.MeshStandardMaterial({
      color: 0xd7ccc8,
      map: fabricTex,
      bumpMap: bumpTex,
      bumpScale: 0.02,
      roughness: 0.85,
      side: THREE.DoubleSide,
    })
  );

  return {
    bumpTex,
    wetBasaltMat,
    mossyRockMat,
    riverRockMat: rockMat,
    rockMat,
    shellMat,
    timberMat,
    sailMat,
  };
}


