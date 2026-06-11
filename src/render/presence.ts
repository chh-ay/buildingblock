/**
 * Remote-peer presence: a colored wireframe marker on the voxel each peer points at,
 * plus a DOM name label projected to screen space every frame (cheap for room-sized
 * peer counts; no extra render pass).
 */
import {
  BoxGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  type PerspectiveCamera,
  Vector3,
} from "three";
import type { PresenceCursor } from "../net/room";

interface PeerVisual {
  marker: LineSegments;
  label: HTMLDivElement;
  cursor: PresenceCursor | null;
}

const markerGeometry = new EdgesGeometry(new BoxGeometry(1.06, 1.06, 1.06));

export class PresenceRenderer {
  /** Voxel-space group; add to the world group. */
  readonly group = new Group();
  private readonly labelLayer: HTMLElement;
  private readonly peers = new Map<string, PeerVisual>();
  private readonly projected = new Vector3();

  constructor(labelLayer: HTMLElement) {
    this.labelLayer = labelLayer;
  }

  upsertPeer(id: string, name: string, cssColor: string, hexColor: number): void {
    if (this.peers.has(id)) return;
    const marker = new LineSegments(
      markerGeometry,
      new LineBasicMaterial({ color: hexColor, transparent: true, opacity: 0.9 }),
    );
    marker.visible = false;
    this.group.add(marker);
    const label = document.createElement("div");
    label.className = "peer-label";
    label.textContent = name;
    label.style.borderColor = cssColor;
    label.style.display = "none";
    this.labelLayer.appendChild(label);
    this.peers.set(id, { marker, label, cursor: null });
  }

  setCursor(id: string, cursor: PresenceCursor | null): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.cursor = cursor;
    peer.marker.visible = cursor !== null;
    if (cursor) {
      peer.marker.position.set(cursor.x + 0.5, Math.max(cursor.y, 0) + 0.5, cursor.z + 0.5);
    } else {
      peer.label.style.display = "none";
    }
  }

  removePeer(id: string): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.group.remove(peer.marker);
    (peer.marker.material as LineBasicMaterial).dispose();
    peer.label.remove();
    this.peers.delete(id);
  }

  /** Drop peers no longer in the roster (markers for newcomers are upserted by the caller). */
  pruneTo(ids: readonly string[]): void {
    const keep = new Set(ids);
    for (const id of [...this.peers.keys()]) {
      if (!keep.has(id)) this.removePeer(id);
    }
  }

  clear(): void {
    for (const id of [...this.peers.keys()]) this.removePeer(id);
  }

  /** Project name labels above their markers; call once per rendered frame. */
  updateLabels(
    camera: PerspectiveCamera,
    worldOffsetX: number,
    worldOffsetZ: number,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    for (const peer of this.peers.values()) {
      const { cursor, label } = peer;
      if (!cursor) continue;
      this.projected.set(
        cursor.x + 0.5 - worldOffsetX,
        Math.max(cursor.y, 0) + 1.45,
        cursor.z + 0.5 - worldOffsetZ,
      );
      this.projected.project(camera);
      if (this.projected.z > 1 || this.projected.z < -1) {
        label.style.display = "none";
        continue;
      }
      label.style.display = "";
      label.style.left = `${((this.projected.x + 1) / 2) * viewportWidth}px`;
      label.style.top = `${((1 - this.projected.y) / 2) * viewportHeight}px`;
    }
  }
}
