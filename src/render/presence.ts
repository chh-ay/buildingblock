/**
 * Remote-peer presence: a colored wireframe marker on the voxel each peer points at,
 * an inner overlay tinted with the peer's live paint color, a quad hugging the hovered
 * face, and a DOM name label (with a tool glyph) projected to screen space every frame
 * (cheap for room-sized peer counts; no extra render pass).
 */
import {
  BoxGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  type PerspectiveCamera,
  PlaneGeometry,
  Vector3,
} from "three";
import { FACE_NORMAL } from "../core/types";
import type { PresenceCursor } from "../net/room";

interface PeerVisual {
  /** Wireframe, tint overlay, and face quad travel together. */
  holder: Group;
  wire: LineSegments;
  tint: Mesh;
  faceQuad: Mesh;
  label: HTMLDivElement;
  name: string;
  cursor: PresenceCursor | null;
  /** Where the marker is headed; the holder lerps toward it each frame. */
  target: Vector3;
}

const markerGeometry = new EdgesGeometry(new BoxGeometry(1.06, 1.06, 1.06));
const tintGeometry = new BoxGeometry(0.98, 0.98, 0.98);
const faceGeometry = new PlaneGeometry(0.96, 0.96);

/** Fraction of the remaining distance the marker covers per updateLabels frame. */
const MARKER_LERP = 0.25;

/** Distance from the voxel center to the face quad (just proud of the wireframe). */
const FACE_QUAD_OFFSET = 0.56;

/** Tool wire id → label glyph: place, erase, paint, box, pick. */
const TOOL_GLYPHS = ["▣", "✕", "◉", "▭", "⊙"] as const;

/** PlaneGeometry faces +Z by default; quads rotate from here onto the face normal. */
const PLANE_FORWARD = new Vector3(0, 0, 1);

export class PresenceRenderer {
  /** Voxel-space group; add to the world group. */
  readonly group = new Group();
  private readonly labelLayer: HTMLElement;
  private readonly peers = new Map<string, PeerVisual>();
  private readonly projected = new Vector3();
  private readonly normal = new Vector3();

  constructor(labelLayer: HTMLElement) {
    this.labelLayer = labelLayer;
  }

  upsertPeer(id: string, name: string, cssColor: string, hexColor: number): void {
    if (this.peers.has(id)) return;

    const wire = new LineSegments(
      markerGeometry,
      new LineBasicMaterial({ color: hexColor, transparent: true, opacity: 0.9 }),
    );
    const tint = new Mesh(
      tintGeometry,
      new MeshBasicMaterial({ transparent: true, opacity: 0.22, depthWrite: false }),
    );
    const faceQuad = new Mesh(
      faceGeometry,
      new MeshBasicMaterial({
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        side: DoubleSide,
      }),
    );

    const holder = new Group();
    holder.add(wire, tint, faceQuad);
    holder.visible = false;
    this.group.add(holder);

    const label = document.createElement("div");
    label.className = "peer-label";
    label.textContent = name;
    label.style.borderColor = cssColor;
    label.style.display = "none";
    this.labelLayer.appendChild(label);

    this.peers.set(id, {
      holder,
      wire,
      tint,
      faceQuad,
      label,
      name,
      cursor: null,
      target: new Vector3(),
    });
  }

  setCursor(id: string, cursor: PresenceCursor | null): void {
    const peer = this.peers.get(id);
    if (!peer) return;

    const wasHidden = peer.cursor === null;
    peer.cursor = cursor;
    peer.holder.visible = cursor !== null;

    if (!cursor) {
      peer.label.style.display = "none";
      return;
    }

    peer.target.set(cursor.x + 0.5, Math.max(cursor.y, 0) + 0.5, cursor.z + 0.5);
    if (wasHidden) peer.holder.position.copy(peer.target); // never lerp in from a stale spot

    (peer.tint.material as MeshBasicMaterial).color.setHex(cursor.color);
    (peer.faceQuad.material as MeshBasicMaterial).color.setHex(cursor.color);
    this.alignFaceQuad(peer.faceQuad, cursor.face);

    const glyph = TOOL_GLYPHS[cursor.tool];
    peer.label.textContent = glyph === undefined ? peer.name : `${peer.name} ${glyph}`;
  }

  /** Park the quad on the hovered face; hidden when the face id is out of range. */
  private alignFaceQuad(quad: Mesh, face: number): void {
    const o = face * 3;
    if (face < 0 || o + 2 >= FACE_NORMAL.length) {
      quad.visible = false;
      return;
    }

    quad.visible = true;
    this.normal.set(FACE_NORMAL[o], FACE_NORMAL[o + 1], FACE_NORMAL[o + 2]);
    quad.position.copy(this.normal).multiplyScalar(FACE_QUAD_OFFSET);
    quad.quaternion.setFromUnitVectors(PLANE_FORWARD, this.normal);
  }

  removePeer(id: string): void {
    const peer = this.peers.get(id);
    if (!peer) return;

    this.group.remove(peer.holder);
    (peer.wire.material as LineBasicMaterial).dispose();
    (peer.tint.material as MeshBasicMaterial).dispose();
    (peer.faceQuad.material as MeshBasicMaterial).dispose();
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

  /** Ease markers toward their targets and project name labels; call once per rendered frame. */
  updateLabels(
    camera: PerspectiveCamera,
    worldOffsetX: number,
    worldOffsetZ: number,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    for (const peer of this.peers.values()) {
      const { cursor, label, holder, target } = peer;
      if (!cursor) continue;

      holder.position.lerp(target, MARKER_LERP);

      this.projected.set(
        holder.position.x - worldOffsetX,
        holder.position.y + 0.95,
        holder.position.z - worldOffsetZ,
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
