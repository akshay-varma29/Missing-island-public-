import * as THREE from 'three';
import {
  groundHeightAt,
  lavaChannelProximity,
  jungleTrailProximity,
  freshwaterStreamInfo,
  getStage2HydrologyAt,
  grassColorVariationAt,
} from './rules';
import { createOrganicBumpTexture } from './worldBuilders';

// Pre-allocated terrain vertex color palette for zero-GC chunk population
const _color = new THREE.Color();
const _sandColor = new THREE.Color(0xe6c88c);
const _wetSandColor = new THREE.Color(0xb8965c);
const _grassLight = new THREE.Color(0x3a8742);
const _grassDeep = new THREE.Color(0x1e5628);
const _grassSunOlive = new THREE.Color(0x5a9e3e);
const _grassTurf = new THREE.Color(0x2d6e36);
const _duneGrass = new THREE.Color(0x7fa052);
const _basaltRock = new THREE.Color(0x3a3532);
const _scorchedRim = new THREE.Color(0x241d1a);
const _lavaGlow = new THREE.Color(0xff4500);
const _dirtTrail = new THREE.Color(0x7c5333);
const _streamBed = new THREE.Color(0x2d4c46);
const _wetWaterfallRock = new THREE.Color(0x22302d);
const _darkLoam = new THREE.Color(0x23381e);
const _richJungleSoil = new THREE.Color(0x2d4c25);
const _emeraldMoss = new THREE.Color(0x33692b);
const _deepMoss = new THREE.Color(0x1b4319);
const _riverbankMoss = new THREE.Color(0x2a5c34);
const _mountainGranite = new THREE.Color(0x4b4844);
const _alpineRidge = new THREE.Color(0x8c8780);
const _expScratchColor = new THREE.Color();
const _coastalTempColor = new THREE.Color();

// Reusable height grid buffer (supports up to 160x160 grid with zero GC allocations)
const _heightGrid = new Float32Array(256 * 256);

/**
 * Evaluates vertex color (r, g, b) at world coordinates (x, z, y).
 * - Preserves the core sanctuary's sandy beach, wet sand, jungle moss, dirt trails, stream bed,
 *   and volcanic basalt/lava glow inside the central sanctuary.
 * - Covers the expanded 10 km radius (20 km diameter) landmass with natural green grass,
 *   Stage 2 hills/mountains, lakes/rivers, and outer sandy coastline.
 */
export function evaluateTerrainColor(x: number, z: number, y: number, outColor: THREE.Color): void {
  const r = Math.hypot(x, z);

  const sandColor = _sandColor;
  const wetSandColor = _wetSandColor;
  const grassLight = _grassLight;
  const grassDeep = _grassDeep;
  const grassSunOlive = _grassSunOlive;
  const grassTurf = _grassTurf;
  const duneGrass = _duneGrass;
  const basaltRock = _basaltRock;
  const scorchedRim = _scorchedRim;
  const lavaGlow = _lavaGlow;
  const dirtTrail = _dirtTrail;
  const streamBed = _streamBed;
  const wetWaterfallRock = _wetWaterfallRock;

  // 1. Inside or near the core sanctuary (r < 96), evaluate core coloration
  if (r < 96) {
    const lavaProx = lavaChannelProximity(x, z);
    const trailProx = jungleTrailProximity(x, z);
    const streamInfo = freshwaterStreamInfo(x, z);

    if (lavaProx > 0.35) {
      outColor.lerpColors(scorchedRim, lavaGlow, Math.min(1, (lavaProx - 0.35) * 1.6));
    } else if (y < 0.3) {
      outColor.copy(wetSandColor);
    } else if (y < 2.35) {
      const t = Math.max(0, Math.min(1, (y - 0.3) / 2.05));
      outColor.lerpColors(wetSandColor, sandColor, t);
    } else if (y < 8.6 && r > 30) {
      const t = Math.max(0, Math.min(1, (y - 2.35) / 6.25));
      outColor.lerpColors(grassLight, grassDeep, t);
    } else if (r < 17) {
      outColor.copy(scorchedRim);
    } else {
      const t = Math.max(0, Math.min(1, (y - 8.6) / 14));
      outColor.lerpColors(grassDeep, basaltRock, t);
    }

    if (z >= 20 && z <= 69 && x >= -33 && x <= 22 && lavaProx <= 0.28 && y > 1.8 && y < 9.2) {
      const soilNoise = Math.sin(x * 0.72 + z * 0.54) * Math.cos(x * 0.48 - z * 0.82);
      const mossNoise = Math.sin(x * 0.36 - z * 0.44) * 0.5 + 0.5;
      const groundBase = soilNoise > 0.15 ? _darkLoam : _richJungleSoil;
      const mossTone = mossNoise > 0.4 ? _emeraldMoss : _deepMoss;
      outColor.lerp(groundBase, 0.42);
      outColor.lerp(mossTone, mossNoise * 0.58);
    }

    if (trailProx > 0 && lavaProx <= 0.3) {
      outColor.lerp(dirtTrail, trailProx * 0.82);
    }

    if (streamInfo.distToStream < 3.2 && z >= 32.5 && z <= 68.5) {
      const st = Math.max(0, 1 - streamInfo.distToStream / 3.2);
      if (streamInfo.isWaterfall) {
        outColor.lerp(wetWaterfallRock, st * 0.95);
      } else if (streamInfo.distToStream < 1.15) {
        outColor.lerp(streamBed, st * 0.92);
      } else {
        outColor.lerp(_riverbankMoss, st * 0.84);
      }
    }

    if (r <= 74) {
      // Apply Stage 2 lake/river bed & shore coloration inside outer sanctuary fringe (r > 40)
      if (r > 40) {
        const hydro = getStage2HydrologyAt(x, z);
        if (hydro.inWater) {
          outColor.lerp(streamBed, 0.88);
        } else if (hydro.nearShore) {
          outColor.lerp(sandColor, hydro.bedBlend * 0.65);
        }
      }
      return;
    }
  }

  // 2. Stage 2 Expanded Island Coloration: Extended Beach, Hills, Mountains, Lakes & Rivers
  const expColor = _expScratchColor;
  const hydro = getStage2HydrologyAt(x, z);

  if (hydro.inWater) {
    expColor.lerpColors(wetSandColor, streamBed, 0.82);
  } else if (y < 0.35) {
    expColor.copy(wetSandColor);
  } else if (y < 2.38) {
    const t = Math.max(0, Math.min(1, (y - 0.35) / 2.03));
    expColor.lerpColors(wetSandColor, sandColor, t);
  } else {
    const { lushness, sunWarmth, microTone } = grassColorVariationAt(x, z);
    expColor.lerpColors(grassDeep, grassLight, lushness);
    expColor.lerp(grassSunOlive, sunWarmth * 0.46);
    expColor.lerp(grassTurf, (1 - microTone) * 0.34);

    // Stage 2 Hills (y = 10..26m) & Rugged Mountain Peaks (y > 26m)
    if (y > 10.0) {
      const hillFactor = Math.max(0, Math.min(1, (y - 10.0) / 15.0));
      expColor.lerp(grassSunOlive, hillFactor * 0.35);
    }
    if (y > 22.0) {
      const rockFactor = Math.max(0, Math.min(1, (y - 22.0) / 18.0));
      expColor.lerp(_mountainGranite, rockFactor * 0.88);
    }
    if (y > 42.0) {
      const alpineFactor = Math.max(0, Math.min(1, (y - 42.0) / 26.0));
      expColor.lerp(_alpineRidge, alpineFactor * 0.72);
    }

    // Stage 2 Lake & Riverbank sandy-moss shore transition
    if (hydro.nearShore) {
      _coastalTempColor.lerpColors(_riverbankMoss, sandColor, 0.55);
      expColor.lerp(_coastalTempColor, hydro.bedBlend * 0.78);
    }

    // Extended Coastal Dune transition between sandy beach (y=2.38) and full grassland (y=3.25)
    if (y < 3.25) {
      const coastBlend = Math.max(0, Math.min(1, (y - 2.38) / 0.87));
      _coastalTempColor.lerpColors(sandColor, duneGrass, Math.min(1, coastBlend * 1.4));
      expColor.lerpColors(_coastalTempColor, expColor, coastBlend);
    }
  }

  if (r < 96) {
    const blendT = Math.max(0, Math.min(1, (r - 74) / 22));
    outColor.lerp(expColor, blendT);
  } else {
    outColor.copy(expColor);
  }
}

/**
 * Populates a chunk BufferGeometry with a 1-quad vertical perimeter skirt so adjacent chunks
 * across different LOD tiers (220m Near, 660m Mid, 1980m Far) join with zero cracks or seams.
 * Uses a 1-sample-per-vertex height grid cache to cut groundHeightAt() calls by ~75%.
 */
export function populateChunkGeometry(
  geo: THREE.BufferGeometry,
  centerX: number,
  centerZ: number,
  size: number,
  innerSegs: number,
  skirtDepth = 3.2
): void {
  const posAttr = geo.attributes.position as THREE.BufferAttribute;
  const normAttr = geo.attributes.normal as THREE.BufferAttribute;
  const uvAttr = geo.attributes.uv as THREE.BufferAttribute;
  let colorAttr = geo.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!colorAttr) {
    colorAttr = new THREE.BufferAttribute(new Float32Array(posAttr.count * 3), 3);
    geo.setAttribute('color', colorAttr);
  }

  const innerCount = innerSegs + 1;
  const cellStep = size / innerSegs;

  // Pass 1: Sample groundHeightAt once per unique (clampedRow, clampedCol) grid coordinate
  for (let r = 0; r < innerCount; r++) {
    const v = r / innerSegs - 0.5;
    const wz = centerZ + v * size;
    const rowOffset = r * innerCount;
    for (let c = 0; c < innerCount; c++) {
      const u = c / innerSegs - 0.5;
      const wx = centerX + u * size;
      _heightGrid[rowOffset + c] = groundHeightAt(wx, wz);
    }
  }

  const gridCols = innerSegs + 3;
  let idx = 0;

  // Pass 2: Populate position, analytical/grid normal, UV, and vertex color
  for (let row = 0; row < gridCols; row++) {
    const isRowSkirt = row === 0 || row === innerSegs + 2;
    const clampedRow = Math.max(1, Math.min(innerSegs + 1, row)) - 1;
    const v = clampedRow / innerSegs - 0.5;
    const localZ = v * size;
    const wz = centerZ + localZ;
    const isRowInterior = clampedRow > 0 && clampedRow < innerSegs;

    for (let col = 0; col < gridCols; col++) {
      const isColSkirt = col === 0 || col === innerSegs + 2;
      const clampedCol = Math.max(1, Math.min(innerSegs + 1, col)) - 1;
      const u = clampedCol / innerSegs - 0.5;
      const localX = u * size;
      const wx = centerX + localX;

      const surfaceY = _heightGrid[clampedRow * innerCount + clampedCol];
      const wy = isRowSkirt || isColSkirt ? surfaceY - skirtDepth : surfaceY;

      posAttr.setXYZ(idx, localX, wy, localZ);
      uvAttr.setXY(idx, wx / 220, wz / 220);

      let nx: number;
      let ny: number;
      let nz: number;

      // Interior vertices reuse cached neighbor heights; border vertices evaluate exact eps for seamless chunk edges
      if (isRowInterior && clampedCol > 0 && clampedCol < innerSegs && cellStep <= 20) {
        const centerGridIdx = clampedRow * innerCount + clampedCol;
        const hL = _heightGrid[centerGridIdx - 1];
        const hR = _heightGrid[centerGridIdx + 1];
        const hD = _heightGrid[centerGridIdx - innerCount];
        const hU = _heightGrid[centerGridIdx + innerCount];
        nx = hL - hR;
        ny = 2 * cellStep;
        nz = hD - hU;
      } else {
        const r = Math.hypot(wx, wz);
        const eps = r < 105 ? 0.65 : 2.5;
        const hL = groundHeightAt(wx - eps, wz);
        const hR = groundHeightAt(wx + eps, wz);
        const hD = groundHeightAt(wx, wz - eps);
        const hU = groundHeightAt(wx, wz + eps);
        nx = hL - hR;
        ny = 2 * eps;
        nz = hD - hU;
      }

      const invLen = 1 / (Math.hypot(nx, ny, nz) || 1);
      normAttr.setXYZ(idx, nx * invLen, ny * invLen, nz * invLen);

      evaluateTerrainColor(wx, wz, surfaceY, _color);
      colorAttr.setXYZ(idx, _color.r, _color.g, _color.b);

      idx++;
    }
  }

  posAttr.needsUpdate = true;
  normAttr.needsUpdate = true;
  uvAttr.needsUpdate = true;
  colorAttr.needsUpdate = true;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}

/**
 * Manages the 3-Tier Chunked LOD Terrain System for the 10 km radius (20 km diameter) island:
 * - Tier 0 (Near Focus): 3×3 grid of 220m × 220m High-Detail Chunks (+ permanent Sanctuary Core Chunk at 0,0)
 * - Tier 1 (Mid Distance): 8 surrounding 660m × 660m Medium-Detail Chunks covering 1,980m × 1,980m
 * - Tier 2 (Far Distance): 8 surrounding 1,980m × 1,980m Regional Chunks spanning 5,940m × 5,940m
 */
export class TerrainSystem {
  public terrainMat!: THREE.MeshStandardMaterial;
  public sanctuaryCoreMesh!: THREE.Mesh;
  public nearLodChunks: THREE.Mesh[] = [];
  public midLodChunks: THREE.Mesh[] = [];
  public farLodChunks: THREE.Mesh[] = [];

  private nearLodInnerSegs = 28;
  private midLodInnerSegs = 18;
  private farLodInnerSegs = 14;
  private currentTerrainMx = 9999;
  private currentTerrainMz = 9999;
  private currentTerrainRx = 9999;
  private currentTerrainRz = 9999;

  constructor(private scene: THREE.Scene, private isHeadless: boolean) {
    this.buildIslandTerrain();
  }

  private buildIslandTerrain(): void {
    const bumpTex = createOrganicBumpTexture(128);
    this.terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.86,
      metalness: 0.04,
      bumpMap: bumpTex,
      bumpScale: 0.18,
    });

    // 1. Permanent High-Resolution Core Sanctuary Chunk (ix=0, iz=0 -> [-110, +110] × [-110, +110])
    const coreSegs = this.isHeadless ? 112 : 148;
    const coreGeo = new THREE.PlaneGeometry(220, 220, coreSegs + 2, coreSegs + 2);
    coreGeo.rotateX(-Math.PI / 2);
    populateChunkGeometry(coreGeo, 0, 0, 220, coreSegs, 3.2);
    this.sanctuaryCoreMesh = new THREE.Mesh(coreGeo, this.terrainMat);
    this.sanctuaryCoreMesh.name = 'terrain_core_sanctuary';
    this.sanctuaryCoreMesh.receiveShadow = true;
    this.sanctuaryCoreMesh.castShadow = false;
    this.sanctuaryCoreMesh.matrixAutoUpdate = false;
    this.sanctuaryCoreMesh.updateMatrix();
    this.scene.add(this.sanctuaryCoreMesh);

    // 2. Pool of 9 Near-Focus LOD 0 Chunks (220m × 220m each -> 660m × 660m high-detail zone)
    this.nearLodInnerSegs = this.isHeadless ? 22 : 34;
    for (let i = 0; i < 9; i++) {
      const geo = new THREE.PlaneGeometry(
        220,
        220,
        this.nearLodInnerSegs + 2,
        this.nearLodInnerSegs + 2
      );
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, this.terrainMat);
      mesh.name = `terrain_lod0_${i}`;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      this.scene.add(mesh);
      this.nearLodChunks.push(mesh);
    }

    // 3. Pool of 8 Mid-Distance LOD 1 Chunks (660m × 660m each -> 1,980m × 1,980m mid-detail zone)
    this.midLodInnerSegs = this.isHeadless ? 10 : 18;
    for (let i = 0; i < 8; i++) {
      const geo = new THREE.PlaneGeometry(
        660,
        660,
        this.midLodInnerSegs + 2,
        this.midLodInnerSegs + 2
      );
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, this.terrainMat);
      mesh.name = `terrain_lod1_${i}`;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      this.scene.add(mesh);
      this.midLodChunks.push(mesh);
    }

    // 4. Pool of 8 Far-Distance LOD 2 Regional Chunks (1,980m × 1,980m each -> 5,940m × 5,940m horizon zone)
    this.farLodInnerSegs = this.isHeadless ? 8 : 14;
    for (let i = 0; i < 8; i++) {
      const geo = new THREE.PlaneGeometry(
        1980,
        1980,
        this.farLodInnerSegs + 2,
        this.farLodInnerSegs + 2
      );
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, this.terrainMat);
      mesh.name = `terrain_lod2_${i}`;
      mesh.receiveShadow = false;
      mesh.castShadow = false;
      this.scene.add(mesh);
      this.farLodChunks.push(mesh);
    }

    // Initial LOD chunk assignment around starting beach (0, 66)
    this.updateLODChunks(0, 66, true);
  }

  /**
   * Dynamically updates the 3-tier nested chunk hierarchy when the focal point crosses a 660m macro-chunk boundary.
   */
  public updateLODChunks(px: number, pz: number, force = false): void {
    const nearIx = THREE.MathUtils.clamp(Math.round(px / 220), -53, 53);
    const nearIz = THREE.MathUtils.clamp(Math.round(pz / 220), -53, 53);
    const activeMx = THREE.MathUtils.clamp(Math.floor((nearIx + 1) / 3), -18, 18);
    const activeMz = THREE.MathUtils.clamp(Math.floor((nearIz + 1) / 3), -18, 18);
    const activeRx = THREE.MathUtils.clamp(Math.floor((activeMx + 1) / 3), -6, 6);
    const activeRz = THREE.MathUtils.clamp(Math.floor((activeMz + 1) / 3), -6, 6);

    if (
      !force &&
      activeMx === this.currentTerrainMx &&
      activeMz === this.currentTerrainMz &&
      activeRx === this.currentTerrainRx &&
      activeRz === this.currentTerrainRz
    ) {
      return;
    }

    const regionChanged =
      force || activeRx !== this.currentTerrainRx || activeRz !== this.currentTerrainRz;

    this.currentTerrainMx = activeMx;
    this.currentTerrainMz = activeMz;
    this.currentTerrainRx = activeRx;
    this.currentTerrainRz = activeRz;

    // 1. Populate the 8 LOD 2 (1,980m × 1,980m) surrounding regional chunks when activeRx/activeRz changes
    if (regionChanged) {
      let farPoolIdx = 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue; // Subdivided into LOD 1 + LOD 0 below
          const rx = activeRx + dx;
          const rz = activeRz + dz;
          const mesh = this.farLodChunks[farPoolIdx++];
          if (!mesh) continue;
          const cx = rx * 1980;
          const cz = rz * 1980;
          populateChunkGeometry(mesh.geometry, cx, cz, 1980, this.farLodInnerSegs, 4.5);
          mesh.position.set(cx, 0, cz);
          mesh.updateMatrixWorld();
          mesh.visible = true;
        }
      }
    }

    // 2. Populate the 8 LOD 1 (660m × 660m) sibling chunks inside (activeRx, activeRz)
    let midPoolIdx = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const mx = activeRx * 3 + dx;
        const mz = activeRz * 3 + dz;
        if (mx === activeMx && mz === activeMz) {
          continue; // Subdivided into 9 LOD 0 near chunks below
        }
        const mesh = this.midLodChunks[midPoolIdx++];
        if (!mesh) continue;
        const cx = mx * 660;
        const cz = mz * 660;
        populateChunkGeometry(mesh.geometry, cx, cz, 660, this.midLodInnerSegs, 3.8);
        mesh.position.set(cx, 0, cz);
        mesh.updateMatrixWorld();
        mesh.visible = true;
      }
    }

    // 3. Populate the 9 LOD 0 (220m × 220m) high-detail near chunks inside (activeMx, activeMz)
    this.sanctuaryCoreMesh.visible = activeMx === 0 && activeMz === 0;
    let nearPoolIdx = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ix = activeMx * 3 + dx;
        const iz = activeMz * 3 + dz;
        const mesh = this.nearLodChunks[nearPoolIdx++];
        if (!mesh) continue;

        if (ix === 0 && iz === 0) {
          // Covered by the high-resolution permanent sanctuaryCoreMesh
          mesh.visible = false;
          continue;
        }

        const cx = ix * 220;
        const cz = iz * 220;
        populateChunkGeometry(mesh.geometry, cx, cz, 220, this.nearLodInnerSegs, 3.2);
        mesh.position.set(cx, 0, cz);
        mesh.updateMatrixWorld();
        mesh.visible = true;
      }
    }
  }
}
