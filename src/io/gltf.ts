/** GLB export — the only io module allowed to touch three. */

import type { Object3D } from "three";

const downloadGlb = (bytes: ArrayBuffer, filename: string): void => {
  const url = URL.createObjectURL(new Blob([bytes]));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const glbStamp = (): string => {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

/** Export an object graph as a binary glTF (.glb) download. */
export const exportGlbFile = async (object: Object3D): Promise<void> => {
  // Dynamic import keeps GLTFExporter (and its deps) out of the main bundle.
  const { GLTFExporter } = await import("three/addons/exporters/GLTFExporter.js");
  const glb = await new GLTFExporter().parseAsync(object, { binary: true });
  if (!(glb instanceof ArrayBuffer)) throw new Error("GLTFExporter did not produce binary output");
  downloadGlb(glb, `world-${glbStamp()}.glb`);
};
