import * as THREE from 'three';
import {
  groundHeightAt,
  WATER_LEVEL,
  evaluateDayNightCycle,
} from './rules';
import {
  bakeGroupByMaterial,
  buildFreshwaterStreamWaterMesh,
  buildStage2LakesAndRiversMesh,
  buildShorelineSurfFoam,
  buildWaterfallSplashRings,
  updateBioluminescentMushroomEmissive,
} from './worldBuilders';

const _dummyObj = new THREE.Object3D();
const _color = new THREE.Color();
const _skyNoon = new THREE.Color(0x5bb8ff);
const _skyGolden = new THREE.Color(0xf48c56);
const _skyNight = new THREE.Color(0x132a4a);

/**
 * Manages ocean waves, shoreline surf foam, freshwater stream & waterfall,
 * Stage 2 lakes & rivers, volcano caldera lava, particle instanced meshes,
 * and day/night atmospheric lighting.
 */
export class WaterAndAtmosphereSystem {
  public oceanMesh!: THREE.Mesh;
  public lavaCoreMesh!: THREE.Mesh;
  public smokeInstanced!: THREE.InstancedMesh;
  public emberInstanced!: THREE.InstancedMesh;
  public streamRibbonMesh: THREE.Mesh | null = null;
  public waterfallCascadeMesh: THREE.Mesh | null = null;
  public waterfallMistInstanced!: THREE.InstancedMesh;
  public jungleSporeInstanced!: THREE.InstancedMesh;
  public shorelineFoamMesh: THREE.Mesh | null = null;
  public waterfallSplashGroup: THREE.Group | null = null;

  private smokeParticles: Array<{
    x: number;
    y: number;
    z: number;
    vy: number;
    vx: number;
    vz: number;
    scale: number;
    life: number;
    maxLife: number;
  }> = [];

  private emberParticles: Array<{
    x: number;
    y: number;
    z: number;
    vy: number;
    vx: number;
    vz: number;
    life: number;
    maxLife: number;
  }> = [];

  private waterfallMistParticles: Array<{
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    scale: number;
    life: number;
    maxLife: number;
  }> = [];

  private jungleSporeParticles: Array<{
    x: number;
    y: number;
    z: number;
    baseY: number;
    phase: number;
    speed: number;
  }> = [];

  constructor(private scene: THREE.Scene) {
    this.buildOceanAndWaterBodies();
    this.buildVolcanoLavaAndParticles();
    this.buildAtmosphericMistAndSpores();
  }

  private buildOceanAndWaterBodies(): void {
    // Horizon-spanning opaque ocean plane covering both 3rd-person and 20km aerial views
    const oceanGeo = new THREE.PlaneGeometry(32000, 32000, 16, 16);
    oceanGeo.rotateX(-Math.PI / 2);

    const oceanMat = new THREE.MeshStandardMaterial({
      color: 0x0b7285,
      roughness: 0.2,
      metalness: 0.14,
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 4,
    });

    this.oceanMesh = new THREE.Mesh(oceanGeo, oceanMat);
    this.oceanMesh.position.y = WATER_LEVEL;
    this.oceanMesh.receiveShadow = false;
    this.scene.add(this.oceanMesh);

    // Realistic coastal surf foam fringe along southern beach shelf
    this.shorelineFoamMesh = buildShorelineSurfFoam();
    this.scene.add(this.shorelineFoamMesh);

    // Dynamic expanding plunge pool ripples at the waterfall basin
    this.waterfallSplashGroup = buildWaterfallSplashRings();
    this.scene.add(this.waterfallSplashGroup);

    // Freshwater Stream, Waterfall & Stage 2 Lakes and Rivers across the map
    const streamGroup = buildFreshwaterStreamWaterMesh();
    this.streamRibbonMesh = streamGroup.getObjectByName('freshwater_stream_ribbon') as THREE.Mesh;
    this.waterfallCascadeMesh = streamGroup.getObjectByName('waterfall_cascade_mesh') as THREE.Mesh;
    this.scene.add(streamGroup);

    const stage2WaterGroup = buildStage2LakesAndRiversMesh();
    this.scene.add(stage2WaterGroup);
  }

  private buildVolcanoLavaAndParticles(): void {
    // Central molten caldera pool inside the crater
    const calderaGeo = new THREE.CircleGeometry(9.8, 28);
    calderaGeo.rotateX(-Math.PI / 2);
    const lavaMat = new THREE.MeshStandardMaterial({
      color: 0xff5500,
      emissive: 0xff3300,
      emissiveIntensity: 2.4,
      roughness: 0.25,
    });
    this.lavaCoreMesh = new THREE.Mesh(calderaGeo, lavaMat);
    this.lavaCoreMesh.position.set(0, 22.8, 0);
    this.lavaCoreMesh.matrixAutoUpdate = false;
    this.lavaCoreMesh.updateMatrix();
    this.scene.add(this.lavaCoreMesh);

    // 6 glowing lava stream ribbons down the volcano slopes merged into 1 static draw call
    const streamAngles = [0.65, 2.35, -0.85, -2.25, 1.32, 1.82];
    const lavaStreamsRaw = new THREE.Group();
    for (const baseAngle of streamAngles) {
      const points: THREE.Vector3[] = [];
      for (let r = 8.5; r <= 41.5; r += 2.2) {
        const meander = Math.sin(r * 0.26) * 0.11;
        const a = baseAngle + meander;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const y = groundHeightAt(x, z) + 0.25;
        points.push(new THREE.Vector3(x, y, z));
      }
      const curve = new THREE.CatmullRomCurve3(points);
      const tubeGeo = new THREE.TubeGeometry(curve, 24, 1.45, 6, false);
      const streamMesh = new THREE.Mesh(tubeGeo, lavaMat);
      lavaStreamsRaw.add(streamMesh);
    }
    const bakedStreams = bakeGroupByMaterial(lavaStreamsRaw, false, false);
    this.scene.add(bakedStreams);

    // Smoke plume InstancedMesh (32 rising volumetric smoke puffs)
    const smokeCount = 32;
    const smokeGeo = new THREE.DodecahedronGeometry(1.6, 1);
    const smokeMat = new THREE.MeshStandardMaterial({
      color: 0x454545,
      roughness: 0.95,
      transparent: true,
      opacity: 0.55,
    });
    this.smokeInstanced = new THREE.InstancedMesh(smokeGeo, smokeMat, smokeCount);
    this.smokeInstanced.frustumCulled = false;
    this.scene.add(this.smokeInstanced);

    for (let i = 0; i < smokeCount; i++) {
      this.smokeParticles.push({
        x: (Math.random() - 0.5) * 6,
        y: 23 + Math.random() * 34,
        z: (Math.random() - 0.5) * 6,
        vy: 2.2 + Math.random() * 1.6,
        vx: 0.35 + (Math.random() - 0.5) * 0.4,
        vz: (Math.random() - 0.5) * 0.4,
        scale: 0.8 + Math.random() * 2.4,
        life: Math.random() * 10,
        maxLife: 8 + Math.random() * 5,
      });
    }

    // Glowing Embers InstancedMesh (48 rising sparks)
    const emberCount = 48;
    const emberGeo = new THREE.OctahedronGeometry(0.24, 0);
    const emberMat = new THREE.MeshBasicMaterial({
      color: 0xff9100,
    });
    this.emberInstanced = new THREE.InstancedMesh(emberGeo, emberMat, emberCount);
    this.emberInstanced.frustumCulled = false;
    this.scene.add(this.emberInstanced);

    for (let i = 0; i < emberCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const rad = Math.random() * 18;
      this.emberParticles.push({
        x: Math.cos(a) * rad,
        y: 16 + Math.random() * 26,
        z: Math.sin(a) * rad,
        vy: 3.5 + Math.random() * 3.0,
        vx: (Math.random() - 0.5) * 1.4,
        vz: (Math.random() - 0.5) * 1.4,
        life: Math.random() * 5,
        maxLife: 3.5 + Math.random() * 2.5,
      });
    }
  }

  private buildAtmosphericMistAndSpores(): void {
    // Waterfall rising mist puffs at plunge pool (-11.5, 37.5)
    const mistCount = 20;
    const mistGeo = new THREE.DodecahedronGeometry(0.85, 1);
    const mistMat = new THREE.MeshStandardMaterial({
      color: 0xe0f7fa,
      roughness: 0.95,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    });
    mistMat.userData.noShadow = true;
    this.waterfallMistInstanced = new THREE.InstancedMesh(mistGeo, mistMat, mistCount);
    this.waterfallMistInstanced.frustumCulled = false;
    this.scene.add(this.waterfallMistInstanced);

    for (let i = 0; i < mistCount; i++) {
      this.waterfallMistParticles.push({
        x: -11.5 + (Math.random() - 0.5) * 2.8,
        y: 6.4 + Math.random() * 2.2,
        z: 37.5 + (Math.random() - 0.5) * 2.6,
        vx: (Math.random() - 0.5) * 0.45,
        vy: 0.65 + Math.random() * 0.8,
        vz: 0.2 + (Math.random() - 0.5) * 0.4,
        scale: 0.6 + Math.random() * 1.2,
        life: Math.random() * 4.0,
        maxLife: 3.5 + Math.random() * 2.0,
      });
    }

    // Floating sunlit jungle spores / fireflies
    const sporeCount = 36;
    const sporeGeo = new THREE.SphereGeometry(0.065, 5, 5);
    const sporeMat = new THREE.MeshBasicMaterial({
      color: 0xcdff7a,
    });
    this.jungleSporeInstanced = new THREE.InstancedMesh(sporeGeo, sporeMat, sporeCount);
    this.jungleSporeInstanced.frustumCulled = false;
    this.scene.add(this.jungleSporeInstanced);

    for (let i = 0; i < sporeCount; i++) {
      const a = (i / sporeCount) * Math.PI * 2;
      const r = 34 + (i % 6) * 4.0;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = groundHeightAt(x, z) + 1.2 + Math.random() * 2.5;
      this.jungleSporeParticles.push({
        x,
        y,
        z,
        baseY: y,
        phase: Math.random() * Math.PI * 2,
        speed: 0.8 + Math.random() * 0.8,
      });
    }
  }

  public updateOceanAndLavaAnimation(
    elapsed: number,
    dt: number,
    focusX: number,
    focusZ: number,
    calderaLight: THREE.PointLight
  ): void {
    // Gentle ocean tide bob and horizon-following XZ alignment
    this.oceanMesh.position.set(
      Math.round(focusX / 64) * 64,
      WATER_LEVEL + Math.sin(elapsed * 1.35) * 0.14,
      Math.round(focusZ / 64) * 64
    );

    // Pulsing molten caldera glow
    const lavaPulse = 2.0 + Math.sin(elapsed * 3.4) * 0.55;
    (this.lavaCoreMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = lavaPulse;
    calderaLight.intensity = 5.0 + Math.sin(elapsed * 4.1) * 1.4;

    // Update rising volcano smoke plume instances
    for (let i = 0; i < this.smokeParticles.length; i++) {
      const p = this.smokeParticles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.life = 0;
        p.x = (Math.random() - 0.5) * 6.5;
        p.y = 22.5;
        p.z = (Math.random() - 0.5) * 6.5;
      } else {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
      }
      const progress = p.life / p.maxLife;
      const s = p.scale * (0.7 + progress * 2.2);
      _dummyObj.position.set(p.x, p.y, p.z);
      _dummyObj.scale.set(s, s * 0.8, s);
      _dummyObj.rotation.set(elapsed * 0.2 + i, elapsed * 0.3, 0);
      _dummyObj.updateMatrix();
      this.smokeInstanced.setMatrixAt(i, _dummyObj.matrix);
    }
    this.smokeInstanced.instanceMatrix.needsUpdate = true;

    // Update glowing volcano embers
    for (let i = 0; i < this.emberParticles.length; i++) {
      const e = this.emberParticles[i];
      e.life += dt;
      if (e.life >= e.maxLife) {
        e.life = 0;
        const a = Math.random() * Math.PI * 2;
        const rad = Math.random() * 14;
        e.x = Math.cos(a) * rad;
        e.y = 20 + Math.random() * 5;
        e.z = Math.sin(a) * rad;
      } else {
        e.x += (e.vx + Math.sin(elapsed * 2 + i) * 0.5) * dt;
        e.y += e.vy * dt;
        e.z += (e.vz + Math.cos(elapsed * 2 + i) * 0.5) * dt;
      }
      const scale = 1 - (e.life / e.maxLife) * 0.7;
      _dummyObj.position.set(e.x, e.y, e.z);
      _dummyObj.scale.setScalar(scale);
      _dummyObj.rotation.set(elapsed * 3, i, 0);
      _dummyObj.updateMatrix();
      this.emberInstanced.setMatrixAt(i, _dummyObj.matrix);
    }
    this.emberInstanced.instanceMatrix.needsUpdate = true;

    const distSqToSanctuary = focusX * focusX + focusZ * focusZ;
    const nearSanctuary = distSqToSanctuary < 190 * 190;

    if (nearSanctuary) {
      // Animate subtle ripples along the freshwater stream ribbon using precomputed baseY array
      if (this.streamRibbonMesh) {
        const pos = this.streamRibbonMesh.geometry.attributes.position;
        const baseY = this.streamRibbonMesh.userData.baseY as Float32Array | undefined;
        for (let i = 0; i < pos.count; i++) {
          const z = pos.getZ(i);
          const bY = baseY
            ? baseY[i]
            : 6.2 * Math.pow(1 - Math.max(0, Math.min(1, (z - 33) / 35)), 1.35) + 0.12;
          const wave = Math.sin(elapsed * 3.8 + z * 1.6) * 0.025;
          pos.setY(i, bY + wave);
        }
        pos.needsUpdate = true;
      }

      // Animate rising waterfall mist particles at plunge pool (-11.5, 37.5)
      if (this.waterfallMistInstanced) {
        for (let i = 0; i < this.waterfallMistParticles.length; i++) {
          const m = this.waterfallMistParticles[i];
          m.life += dt;
          if (m.life >= m.maxLife) {
            m.life = 0;
            m.x = -11.5 + (Math.random() - 0.5) * 2.8;
            m.y = 6.4 + Math.random() * 1.5;
            m.z = 37.5 + (Math.random() - 0.5) * 2.6;
          } else {
            m.x += m.vx * dt;
            m.y += m.vy * dt;
            m.z += m.vz * dt;
          }
          const progress = m.life / m.maxLife;
          const scale = m.scale * (0.8 + progress * 1.8);
          _dummyObj.position.set(m.x, m.y, m.z);
          _dummyObj.scale.set(scale, scale * 0.7, scale);
          _dummyObj.rotation.set(0, elapsed * 0.4 + i, 0);
          _dummyObj.updateMatrix();
          this.waterfallMistInstanced.setMatrixAt(i, _dummyObj.matrix);
        }
        this.waterfallMistInstanced.instanceMatrix.needsUpdate = true;
      }

      // Animate drifting jungle canopy spores / sunlit fireflies
      if (this.jungleSporeInstanced) {
        for (let i = 0; i < this.jungleSporeParticles.length; i++) {
          const sp = this.jungleSporeParticles[i];
          sp.phase += dt * sp.speed;
          const bob = Math.sin(sp.phase) * 0.45;
          const swayX = Math.cos(sp.phase * 0.7) * 0.35;
          _dummyObj.position.set(sp.x + swayX, sp.baseY + bob, sp.z);
          _dummyObj.scale.setScalar(0.8 + Math.sin(sp.phase * 2) * 0.3);
          _dummyObj.updateMatrix();
          this.jungleSporeInstanced.setMatrixAt(i, _dummyObj.matrix);
        }
        this.jungleSporeInstanced.instanceMatrix.needsUpdate = true;
      }

      // Animate waterfall splash and plunge pool ripples
      if (this.waterfallSplashGroup) {
        for (let i = 0; i < this.waterfallSplashGroup.children.length; i++) {
          const ring = this.waterfallSplashGroup.children[i] as THREE.Mesh;
          const cycle = (elapsed * 2.2 + i * 0.33) % 1.0;
          const ringScale = 0.75 + cycle * 1.85;
          ring.scale.set(ringScale, 1, ringScale);
          const ringMat = ring.material as THREE.MeshBasicMaterial;
          if (ringMat) {
            ringMat.opacity = (1.0 - cycle) * 0.55;
          }
        }
      }
    }

    // Animate shoreline surf foam swell surging against the beach
    if (this.shorelineFoamMesh) {
      const swell = Math.sin(elapsed * 1.6) * 0.5 + 0.5;
      const scaleSwell = 1.0 + swell * 0.016;
      this.shorelineFoamMesh.scale.set(scaleSwell, 1, scaleSwell);
      const foamMat = this.shorelineFoamMesh.material as THREE.MeshStandardMaterial;
      if (foamMat) {
        foamMat.opacity = 0.32 + swell * 0.28;
      }
    }
  }

  public updateDayNightEnvironment(
    timeOfDay: number,
    elapsedSimTime: number,
    playerX: number,
    playerZ: number,
    sunLight: THREE.DirectionalLight,
    hemiLight: THREE.HemisphereLight,
    fog: THREE.FogExp2,
    godRaysGroup: THREE.Group | null
  ) {
    const cycle = evaluateDayNightCycle(timeOfDay);
    const { sunElevation, sunAzimuth, daylightFactor, phase } = cycle;

    // Position directional sun or tropical full moon light along orbital arc centered on player
    const sunDist = 110;
    const isNight = phase === 'Night';
    const lightY = isNight
      ? Math.max(42, Math.abs(sunElevation) * sunDist + 36)
      : Math.max(16, sunElevation * sunDist + 22);
    sunLight.position.set(
      playerX + (isNight ? -sunAzimuth : sunAzimuth) * sunDist,
      lightY,
      playerZ + 38
    );
    sunLight.target.position.set(playerX, 0, playerZ);

    if (phase === 'Noon') {
      _color.copy(_skyNoon);
      sunLight.color.setHex(0xfff4d6);
      sunLight.intensity = 2.25;
      hemiLight.intensity = 0.82;
    } else if (phase === 'Dawn' || phase === 'Dusk') {
      _color.lerpColors(_skyNight, _skyGolden, Math.max(0.32, daylightFactor));
      sunLight.color.setHex(0xff9e5e);
      sunLight.intensity = 1.55;
      hemiLight.intensity = 0.65;
    } else {
      // Luminous tropical full-moon night so the island remains vibrant and playable during IST night hours
      _color.copy(_skyNight);
      sunLight.color.setHex(0x9ec5ff);
      sunLight.intensity = 1.38;
      hemiLight.intensity = 0.68;
    }

    (this.scene.background as THREE.Color).copy(_color);
    fog.color.copy(_color);

    // Update volumetric jungle god rays & moonlight beams (single merged mesh)
    if (godRaysGroup) {
      const rayMat = (godRaysGroup.children[0] as THREE.Mesh)?.material as THREE.MeshBasicMaterial;
      if (rayMat) {
        if (phase === 'Noon') {
          rayMat.color.setHex(0xfffae0);
          rayMat.opacity = 0.18 + Math.sin(elapsedSimTime * 1.5) * 0.04;
        } else if (phase === 'Dawn' || phase === 'Dusk') {
          rayMat.color.setHex(0xffba77);
          rayMat.opacity = 0.14 + Math.sin(elapsedSimTime * 1.2) * 0.03;
        } else {
          rayMat.color.setHex(0xa5c9ff);
          rayMat.opacity = 0.09 + Math.sin(elapsedSimTime * 0.9) * 0.02;
        }
      }
    }

    // O(1) update of bioluminescent mushroom cap emissive intensity via shared cached materials
    const isNightOrDusk = phase === 'Night' || phase === 'Dusk';
    const pulseBase = isNightOrDusk ? 1.2 : 0.45;
    const pulseWave = Math.sin(elapsedSimTime * 2.2) * 0.35;
    updateBioluminescentMushroomEmissive(pulseBase + pulseWave);

    return cycle;
  }
}
