/** Single registration point for gallery scenes; the runner and tests both consume this. */
import type { SceneSpec } from "./scene";
import { scene as castleKeep } from "./scenes/castle-keep";
import { scene as harborLighthouse } from "./scenes/harbor-lighthouse";
import { scene as neonCity } from "./scenes/neon-city";
import { scene as oasis } from "./scenes/oasis";
import { scene as plasmaFalls } from "./scenes/plasma-falls";
import { scene as sailShip } from "./scenes/sail-ship";
import { scene as shapeGarden } from "./scenes/shape-garden";
import { scene as skyTemple } from "./scenes/sky-temple";
import { scene as winterCabin } from "./scenes/winter-cabin";

export const GALLERY_SCENES: readonly SceneSpec[] = [
  harborLighthouse,
  skyTemple,
  castleKeep,
  sailShip,
  winterCabin,
  neonCity,
  plasmaFalls,
  shapeGarden,
  oasis,
];
