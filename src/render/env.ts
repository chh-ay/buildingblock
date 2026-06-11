/**
 * Static environment: day/night gradient sky with a visible sun/moon disc,
 * baseplate, unit/chunk grids, world-bounds frame. Sky colors and the disc are
 * TSL uniforms so setSky() regrades without shader recompilation.
 */
import {
  Box3,
  Box3Helper,
  Color,
  GridHelper,
  type LineBasicMaterial,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  type Scene,
  Vector3,
} from "three";
import { clamp, dot, mix, positionWorldDirection, pow, uniform } from "three/tsl";
import { CHUNK_SIZE, WORLD_SX, WORLD_SY, WORLD_SZ } from "../core/types";
import type { SkyState } from "./renderer";

export interface Environment {
  setGridVisible(visible: boolean): void;
  /** Regrade the sky palette and move the sun/moon disc. */
  setSky(sky: SkyState): void;
}

const DAY_TOP = new Color(0x3f5070);
const NIGHT_TOP = new Color(0x0b0f1b);
const DAY_HORIZON = new Color(0x131722);
const NIGHT_HORIZON = new Color(0x05070c);
const SUN_DISC = new Color(0xfff0c8).multiplyScalar(1.6);
const MOON_DISC = new Color(0xdfe9ff).multiplyScalar(0.9);

export const createEnvironment = (scene: Scene): Environment => {
  const topColor = uniform(DAY_TOP.clone());
  const horizonColor = uniform(DAY_HORIZON.clone());
  const lightDirection = uniform(new Vector3(0.4, 0.7, 0.59));
  const discColor = uniform(SUN_DISC.clone());
  const discHardness = uniform(700);
  const haloStrength = uniform(0.1);

  const viewDirection = positionWorldDirection;
  const gradient = mix(horizonColor, topColor, viewDirection.y.mul(0.5).add(0.5).clamp());
  const towardLight = clamp(dot(viewDirection, lightDirection), 0, 1);
  const disc = discColor.mul(pow(towardLight, discHardness));
  const halo = discColor.mul(pow(towardLight, 14).mul(haloStrength));
  scene.backgroundNode = gradient.add(disc).add(halo);

  const baseplate = new Mesh(
    new PlaneGeometry(WORLD_SX, WORLD_SZ),
    new MeshStandardMaterial({ color: 0x202229, roughness: 0.96, metalness: 0 }),
  );
  baseplate.rotation.x = -Math.PI / 2;
  baseplate.position.y = -0.004;
  baseplate.receiveShadow = true;
  scene.add(baseplate);

  const unitGrid = new GridHelper(WORLD_SX, WORLD_SX, 0x3a3d45, 0x2c2e35);
  unitGrid.position.y = 0.004;
  const unitGridMaterial = unitGrid.material as LineBasicMaterial;
  unitGridMaterial.transparent = true;
  unitGridMaterial.opacity = 0.4;

  const chunkGrid = new GridHelper(WORLD_SX, WORLD_SX / CHUNK_SIZE, 0x4a5160, 0x4a5160);
  chunkGrid.position.y = 0.006;
  const chunkGridMaterial = chunkGrid.material as LineBasicMaterial;
  chunkGridMaterial.transparent = true;
  chunkGridMaterial.opacity = 0.5;

  const bounds = new Box3Helper(
    new Box3(
      new Vector3(-WORLD_SX / 2, 0, -WORLD_SZ / 2),
      new Vector3(WORLD_SX / 2, WORLD_SY, WORLD_SZ / 2),
    ),
    0x2e3340,
  );
  scene.add(unitGrid, chunkGrid, bounds);

  return {
    setGridVisible: (visible) => {
      unitGrid.visible = visible;
      chunkGrid.visible = visible;
      bounds.visible = visible;
    },
    setSky: (sky) => {
      const azimuth = (sky.azimuthDeg * Math.PI) / 180;
      const elevation = (sky.elevationDeg * Math.PI) / 180;
      lightDirection.value.set(
        Math.cos(elevation) * Math.sin(azimuth),
        Math.sin(elevation),
        Math.cos(elevation) * Math.cos(azimuth),
      );
      topColor.value.lerpColors(NIGHT_TOP, DAY_TOP, sky.dayness);
      horizonColor.value.lerpColors(NIGHT_HORIZON, DAY_HORIZON, sky.dayness);
      discColor.value.copy(sky.moon ? MOON_DISC : SUN_DISC);
      discHardness.value = sky.moon ? 3200 : 700;
      haloStrength.value = sky.moon ? 0.04 : 0.1;
    },
  };
};
