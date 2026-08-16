"use client";

import { Box, Check, Maximize2, Minimize2, Minus, MousePointer2, Plus, Rotate3D, RotateCcw, Trash2 } from "lucide-react";
import { CSSProperties, PointerEvent, useEffect, useMemo, useRef, useState, WheelEvent } from "react";

type Dimension = { id: string; leftLabel: string; rightLabel: string };
type Asset = { id: string; name: string; thumbnailUrl: string | null; dimensionValues: Record<string, number>; width?: number; height?: number };
type CameraDrag = { pointerId: number; startX: number; startY: number; rotateX: number; rotateZ: number };
type AssetDrag = {
  pointerId: number;
  assetId: string;
  startX: number;
  startY: number;
  startValues: Record<string, number>;
  startLocalX: number;
  startLocalY: number;
  startLocalZ: number;
  grabOffsetX: number;
  grabOffsetY: number;
  moved: boolean;
};

const clampValue = (value: number) => Math.max(0, Math.min(1000, Math.round(value)));
const wrapRotation = (value: number) => ((value % 360) + 360) % 360;
const aspectRatioFor = (asset: Asset) => {
  const width = asset.width ?? 0;
  const height = asset.height ?? 0;
  if (width > 0 && height > 0) {
    if (width === height) return "1 / 1";
    return height > width ? "3 / 4" : "4 / 3";
  }
  return "1 / 1";
};

export function DimensionPreview({
  dimensions,
  assets,
  onSelectAsset,
  onUpdateAssetDimensions,
  onAddDimension,
  onDeleteDimension,
}: {
  dimensions: Dimension[];
  assets: Asset[];
  onSelectAsset: (assetId: string) => void;
  onUpdateAssetDimensions: (assetId: string, values: Record<string, number>) => Promise<void>;
  onAddDimension: () => void;
  onDeleteDimension: (dimension: Dimension) => void;
}) {
  const [selectedIds, setSelectedIds] = useState(() => dimensions.slice(0, 3).map((dimension) => dimension.id));
  const [zoom, setZoom] = useState(1);
  const [rotateX, setRotateX] = useState(52);
  const [rotateZ, setRotateZ] = useState(352);
  const [cameraMoving, setCameraMoving] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [draggingAssetId, setDraggingAssetId] = useState<string | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, Record<string, number>>>({});
  const scenePlaneRef = useRef<HTMLDivElement>(null);
  const sceneViewportRef = useRef<HTMLDivElement>(null);
  const cameraDrag = useRef<CameraDrag | null>(null);
  const assetDrag = useRef<AssetDrag | null>(null);
  const dragValues = useRef<Record<string, number>>({});
  const spaceHeldRef = useRef(false);

  const selected = useMemo(
    () => selectedIds.map((id) => dimensions.find((dimension) => dimension.id === id)).filter(Boolean) as Dimension[],
    [dimensions, selectedIds],
  );
  const mode = selected.length;
  const gridTicks = useMemo(() => Array.from({ length: 11 }, (_, index) => index), []);
  const sceneRotateX = ((rotateX + 180) % 360 + 360) % 360 - 180;
  const sceneRotateZ = ((rotateZ + 180) % 360 + 360) % 360 - 180;
  const [modeTransitioning, setModeTransitioning] = useState(false);
  const [prevMode, setPrevMode] = useState(mode);
  if (prevMode !== mode) {
    setPrevMode(mode);
    setModeTransitioning(true);
  }

  useEffect(() => {
    document.body.classList.toggle("preview-focus-active", focusMode);
    return () => document.body.classList.remove("preview-focus-active");
  }, [focusMode]);

  useEffect(() => {
    const releaseActiveControl = () => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body && typeof active.blur === "function") {
        const tag = active.tagName;
        if (tag === "BUTTON" || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || active.isContentEditable) {
          active.blur();
        }
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (mode !== 3 || event.code !== "Space") return;
      releaseActiveControl();
      spaceHeldRef.current = true;
      setSpaceHeld(true);
      event.preventDefault();
      event.stopPropagation();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      spaceHeldRef.current = false;
      setSpaceHeld(false);
      if (mode === 3) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const clearSpace = () => {
      spaceHeldRef.current = false;
      setSpaceHeld(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", clearSpace);
    return () => {
      spaceHeldRef.current = false;
      setSpaceHeld(false);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", clearSpace);
    };
  }, [mode]);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => dimensions.some((dimension) => dimension.id === id)));
  }, [dimensions]);

  useEffect(() => {
    if (!modeTransitioning) return;
    const timer = window.setTimeout(() => setModeTransitioning(false), 1050);
    return () => window.clearTimeout(timer);
  }, [modeTransitioning, mode]);

  function toggleDimension(id: string) {
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      if (current.length >= 3) return current;
      return [...current, id];
    });
  }

  function toggleFocusMode() {
    setFocusMode((active) => !active);
  }

  function zoomWithWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * .0014);
    setZoom((current) => Math.max(.35, Math.min(2.8, current * factor)));
  }

  function unprojectPointerToPlane(clientX: number, clientY: number, localZ: number) {
    const viewport = sceneViewportRef.current;
    if (!viewport) return null;
    const rect = viewport.getBoundingClientRect();
    const screenX = clientX - (rect.left + rect.width / 2);
    const screenY = clientY - (rect.top + rect.height / 2);
    const pitch = (mode === 3 ? rotateX : 0) * Math.PI / 180;
    const yaw = (mode === 3 ? rotateZ : 0) * Math.PI / 180;
    const sinPitch = Math.sin(pitch);
    const cosPitch = Math.cos(pitch);
    const sinYaw = Math.sin(yaw);
    const cosYaw = Math.cos(yaw);
    const perspective = 1100;
    const denominator = zoom * (perspective * cosPitch + screenY * sinPitch);
    if (Math.abs(denominator) < 1) return null;
    const localAlongY = (
      screenY * perspective
      - screenY * zoom * cosPitch * localZ
      + zoom * perspective * sinPitch * localZ
    ) / denominator;
    const perspectiveDenominator = perspective - zoom * (sinPitch * localAlongY + cosPitch * localZ);
    const localAlongX = screenX * perspectiveDenominator / (zoom * perspective);
    return {
      x: cosYaw * localAlongX + sinYaw * localAlongY,
      y: -sinYaw * localAlongX + cosYaw * localAlongY,
    };
  }

  function projectLocalPoint(x: number, y: number, z: number) {
    const pitch = (mode === 3 ? rotateX : 0) * Math.PI / 180;
    const yaw = (mode === 3 ? rotateZ : 0) * Math.PI / 180;
    const alongX = Math.cos(yaw) * x - Math.sin(yaw) * y;
    const alongY = Math.sin(yaw) * x + Math.cos(yaw) * y;
    const worldY = Math.cos(pitch) * alongY - Math.sin(pitch) * z;
    const worldZ = Math.sin(pitch) * alongY + Math.cos(pitch) * z;
    const perspective = 1100;
    const factor = perspective / (perspective - zoom * worldZ);
    return { x: zoom * alongX * factor, y: zoom * worldY * factor };
  }

  function startCameraMove(event: PointerEvent<HTMLDivElement>) {
    if (mode !== 3 || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    cameraDrag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      rotateX,
      rotateZ,
    };
    setCameraMoving(true);
  }

  function moveCamera(event: PointerEvent<HTMLDivElement>) {
    const active = cameraDrag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    setRotateZ(wrapRotation(active.rotateZ - dx * .24));
    setRotateX(Math.max(0, Math.min(180, active.rotateX - dy * .24)));
  }

  function endCameraMove(event: PointerEvent<HTMLDivElement>) {
    if (cameraDrag.current?.pointerId !== event.pointerId) return;
    cameraDrag.current = null;
    setCameraMoving(false);
  }

  function resetView() {
    cameraDrag.current = null;
    assetDrag.current = null;
    setCameraMoving(false);
    setDraggingAssetId(null);
    setRotateX(52);
    setRotateZ(352);
    setZoom(1);
  }

  function startAssetMove(event: PointerEvent<HTMLButtonElement>, asset: Asset) {
    if (event.button !== 0) return;
    if (mode === 3 && spaceHeldRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const currentValues = { ...asset.dimensionValues, ...overrides[asset.id] };
    const plane = scenePlaneRef.current;
    if (!plane || !selected.length) return;
    const startLocalX = ((currentValues[selected[0].id] ?? 500) / 1000 - .5) * plane.offsetWidth;
    const startLocalY = mode >= 2
      ? (.5 - (currentValues[selected[1].id] ?? 500) / 1000) * plane.offsetHeight
      : 0;
    const startLocalZ = mode === 3 ? ((currentValues[selected[2].id] ?? 500) - 500) * .34 : 0;
    const pointerOnPlane = unprojectPointerToPlane(event.clientX, event.clientY, startLocalZ);
    assetDrag.current = {
      pointerId: event.pointerId,
      assetId: asset.id,
      startX: event.clientX,
      startY: event.clientY,
      startValues: currentValues,
      startLocalX,
      startLocalY,
      startLocalZ,
      grabOffsetX: startLocalX - (pointerOnPlane?.x ?? startLocalX),
      grabOffsetY: startLocalY - (pointerOnPlane?.y ?? startLocalY),
      moved: false,
    };
    dragValues.current = currentValues;
    setDraggingAssetId(asset.id);
  }

  function moveAsset(event: PointerEvent<HTMLButtonElement>) {
    const active = assetDrag.current;
    const plane = scenePlaneRef.current;
    if (!active || active.pointerId !== event.pointerId || !plane || !selected.length) return;
    event.preventDefault();
    event.stopPropagation();
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    if (Math.hypot(dx, dy) > 3) active.moved = true;

    const next = { ...active.startValues };
    if (mode === 3 && event.shiftKey) {
      const projectedStart = projectLocalPoint(active.startLocalX, active.startLocalY, active.startLocalZ);
      const projectedDepth = projectLocalPoint(active.startLocalX, active.startLocalY, active.startLocalZ + 100);
      const axisX = projectedDepth.x - projectedStart.x;
      const axisY = projectedDepth.y - projectedStart.y;
      const axisLengthSquared = axisX * axisX + axisY * axisY;
      const depthDelta = axisLengthSquared > 9
        ? (dx * axisX + dy * axisY) / axisLengthSquared * 100
        : -dy * 1.5 / zoom;
      next[selected[2].id] = clampValue(500 + (active.startLocalZ + depthDelta) / .34);
    } else {
      const pointerOnPlane = unprojectPointerToPlane(event.clientX, event.clientY, active.startLocalZ);
      if (pointerOnPlane) {
        const localX = pointerOnPlane.x + active.grabOffsetX;
        const localY = pointerOnPlane.y + active.grabOffsetY;
        next[selected[0].id] = clampValue((localX / plane.offsetWidth + .5) * 1000);
        if (mode >= 2) {
          next[selected[1].id] = clampValue((.5 - localY / plane.offsetHeight) * 1000);
        }
      }
    }
    dragValues.current = next;
    setOverrides((current) => ({ ...current, [active.assetId]: next }));
  }

  async function endAssetMove(event: PointerEvent<HTMLButtonElement>) {
    const active = assetDrag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    assetDrag.current = null;
    setDraggingAssetId(null);
    if (!active.moved) {
      setOverrides((current) => {
        const next = { ...current };
        delete next[active.assetId];
        return next;
      });
      onSelectAsset(active.assetId);
      return;
    }
    const changedValues = Object.fromEntries(
      selected
        .map((dimension) => [dimension.id, dragValues.current[dimension.id] ?? 500] as const)
        .filter(([id, value]) => value !== (active.startValues[id] ?? 500)),
    );
    if (Object.keys(changedValues).length) {
      await onUpdateAssetDimensions(active.assetId, changedValues);
    }
    setOverrides((current) => {
      const next = { ...current };
      delete next[active.assetId];
      return next;
    });
  }

  return (
    <section className={`preview-layout ${focusMode ? "focus-mode" : ""}`}>
      <aside className="preview-settings">
        <div className="preview-settings-heading"><Box size={17} /><div><strong>选择预览维度</strong><span>最多同时使用 3 个</span></div></div>
        <div className="preview-dimension-options">
          {dimensions.map((dimension, index) => {
            const active = selectedIds.includes(dimension.id);
            const disabled = !active && selectedIds.length >= 3;
            return (
              <div
                className={`preview-dimension-option ${active ? "active" : ""} ${disabled ? "disabled" : ""}`}
                key={dimension.id}
                role="button"
                tabIndex={0}
                onClick={() => { if (!disabled) toggleDimension(dimension.id); }}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (!disabled) toggleDimension(dimension.id); } }}
              >
                <span className="preview-dimension-index">{active ? <Check size={13} /> : index + 1}</span>
                <div className="preview-dimension-labels"><strong>{dimension.leftLabel}</strong><i>—</i><strong>{dimension.rightLabel}</strong></div>
                <button className="preview-dimension-delete" type="button" onClick={(event) => { event.stopPropagation(); onDeleteDimension(dimension); }} aria-label={`删除${dimension.leftLabel}到${dimension.rightLabel}维度`}><Trash2 size={13} /></button>
              </div>
            );
          })}
          <button className="preview-dimension-add" type="button" onClick={onAddDimension}><Plus size={14} /> 添加维度</button>
        </div>
      </aside>
      <div className="preview-workspace">
        <div className="preview-toolbar">
          <span>{mode ? `${mode}D 预览` : "未选择维度"} · {mode === 1 ? "左右拖动图片改变维度值" : mode === 2 ? "在平面中拖动图片改变两项维度" : mode === 3 ? "左键拖动改变前两项；Shift + 拖动改变深度" : "选择 1～3 个维度开始预览"}</span>
          <div className="preview-tools">
            {mode === 3 ? <span className="camera-hint"><MousePointer2 size={13} />空格 + 左键拖动视角</span> : null}
            {mode === 3 ? <><label><Rotate3D size={14} />俯仰<input aria-label="三维预览俯仰角" type="range" min="0" max="180" value={rotateX} onChange={(event) => setRotateX(Number(event.target.value))} /></label><label>旋转<input aria-label="三维预览水平旋转" type="range" min="0" max="360" value={rotateZ} onChange={(event) => setRotateZ(Number(event.target.value))} /></label></> : null}
            <div className="preview-zoom"><button type="button" onClick={() => setZoom((value) => Math.max(.35, value - .1))} aria-label="缩小"><Minus size={14} /></button><span>{Math.round(zoom * 100)}%</span><button type="button" onClick={() => setZoom((value) => Math.min(2.8, value + .1))} aria-label="放大"><Plus size={14} /></button></div>
            <button className="fullscreen-button" type="button" onClick={resetView} aria-label="重置视角" title="重置视角"><RotateCcw size={15} /></button>
            <button className="fullscreen-button" type="button" onClick={toggleFocusMode} aria-label={focusMode ? "退出专注模式" : "专注显示视图"}>{focusMode ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
          </div>
        </div>
        {mode ? (
          <div className={`dimension-scene mode-${mode} ${cameraMoving ? "camera-moving" : ""} ${modeTransitioning ? "mode-transitioning" : ""} ${spaceHeld ? "space-held" : ""}`}>
            <div
              ref={sceneViewportRef}
              className="scene-viewport"
              onPointerDown={startCameraMove}
              onPointerMove={moveCamera}
              onPointerUp={endCameraMove}
              onPointerCancel={endCameraMove}
              onAuxClick={(event) => event.preventDefault()}
              onWheel={zoomWithWheel}
            >
              <div className="scene-scale" style={{ "--scene-scale": zoom, "--asset-size": `${82 / zoom}px` } as CSSProperties}>
                <div
                  ref={scenePlaneRef}
                  className="scene-plane"
                  style={{
                    "--scene-rx": `${mode === 3 ? sceneRotateX : 0}deg`,
                    "--scene-rz": `${mode === 3 ? sceneRotateZ : 0}deg`,
                  } as CSSProperties}
                >
                {mode >= 2 ? <div className="xy-grid-plane" aria-hidden="true">
                  {gridTicks.map((tick) => <span className="grid-line grid-line-x" style={{ left: `${tick * 10}%` }} key={`grid-x-${tick}`} />)}
                  {gridTicks.map((tick) => <span className="grid-line grid-line-y" style={{ top: `${tick * 10}%` }} key={`grid-y-${tick}`} />)}
                  {gridTicks.map((tick) => <span className="grid-number grid-number-x" style={{ left: `${tick * 10}%` }} key={`grid-number-x-${tick}`}>{tick}</span>)}
                  {gridTicks.map((tick) => <span className="grid-number grid-number-y" style={{ top: `${(10 - tick) * 10}%` }} key={`grid-number-y-${tick}`}>{tick}</span>)}
                </div> : null}
                <div className="coordinate-axis coordinate-axis-x" />
                {mode >= 2 ? <div className="coordinate-axis coordinate-axis-y" /> : null}
                {mode === 3 ? <div className="coordinate-axis coordinate-axis-z" /> : null}
                <span className="axis-origin" />
                <span className="axis-label axis-label-x-start"><i style={{ "--billboard-rx": `${mode === 3 ? -sceneRotateX : 0}deg`, "--billboard-rz": `${mode === 3 ? -sceneRotateZ : 0}deg` } as CSSProperties}>{selected[0].leftLabel}</i></span>
                <span className="axis-label axis-label-x-end"><i style={{ "--billboard-rx": `${mode === 3 ? -sceneRotateX : 0}deg`, "--billboard-rz": `${mode === 3 ? -sceneRotateZ : 0}deg` } as CSSProperties}>{selected[0].rightLabel}</i></span>
                {mode >= 2 ? <><span className="axis-label axis-label-y-start"><i style={{ "--billboard-rx": `${mode === 3 ? -sceneRotateX : 0}deg`, "--billboard-rz": `${mode === 3 ? -sceneRotateZ : 0}deg` } as CSSProperties}>{selected[1].rightLabel}</i></span><span className="axis-label axis-label-y-end"><i style={{ "--billboard-rx": `${mode === 3 ? -sceneRotateX : 0}deg`, "--billboard-rz": `${mode === 3 ? -sceneRotateZ : 0}deg` } as CSSProperties}>{selected[1].leftLabel}</i></span></> : null}
                {mode === 3 ? <><span className="axis-label axis-label-z-start"><i style={{ "--billboard-rx": `${-sceneRotateX}deg`, "--billboard-rz": `${-sceneRotateZ}deg` } as CSSProperties}>{selected[2].leftLabel}</i></span><span className="axis-label axis-label-z-end"><i style={{ "--billboard-rx": `${-sceneRotateX}deg`, "--billboard-rz": `${-sceneRotateZ}deg` } as CSSProperties}>{selected[2].rightLabel}</i></span></> : null}
                {assets.map((asset) => {
                  const values = { ...asset.dimensionValues, ...overrides[asset.id] };
                  const x = values[selected[0].id] ?? 500;
                  const y = mode >= 2 ? 1000 - (values[selected[1].id] ?? 500) : 500;
                  const z = mode === 3 ? (values[selected[2].id] ?? 500) - 500 : 0;
                  const planeSize = scenePlaneRef.current?.offsetWidth ?? 0;
                  const pitch = (mode === 3 ? rotateX : 0) * Math.PI / 180;
                  const yaw = (mode === 3 ? rotateZ : 0) * Math.PI / 180;
                  const localX = (x / 1000 - 0.5) * planeSize;
                  const localY = (y / 1000 - 0.5) * planeSize;
                  const localZ = z * 0.34;
                  const alongY = Math.sin(yaw) * localX + Math.cos(yaw) * localY;
                  const worldZ = Math.sin(pitch) * alongY + Math.cos(pitch) * localZ;
                  const persp = 1 - worldZ / 1100;
                  return (
                    <button
                      type="button"
                      className={`preview-asset ${draggingAssetId === asset.id ? "dragging" : ""}`}
                      key={asset.id}
                      style={{
                        left: `${x / 10}%`,
                        top: `${y / 10}%`,
                        "--asset-z": `${z * .34}px`,
                        "--asset-ratio": aspectRatioFor(asset),
                        "--persp": persp,
                        "--billboard-rx": `${mode === 3 ? -sceneRotateX : 0}deg`,
                        "--billboard-rz": `${mode === 3 ? -sceneRotateZ : 0}deg`,
                      } as CSSProperties}
                      onPointerDown={(event) => startAssetMove(event, asset)}
                      onPointerMove={moveAsset}
                      onPointerUp={(event) => void endAssetMove(event)}
                      onPointerCancel={(event) => void endAssetMove(event)}
                      title={`${asset.name} · 拖动修改维度`}
                    >
                      <span className="preview-asset-face">
                        {asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt="" draggable={false} /> : <i>{asset.name.slice(0, 1)}</i>}
                        {draggingAssetId === asset.id ? <em>{selected.map((dimension) => `${dimension.leftLabel} ${(values[dimension.id] ?? 500) / 100}`).join(" · ")}</em> : null}
                      </span>
                    </button>
                  );
                })}
                </div>
              </div>
            </div>
          </div>
        ) : <div className="preview-empty"><Box size={28} /><h3>选择预览维度</h3><p>项目可以拥有任意数量的维度，每次预览最多选择 3 个。</p></div>}
      </div>
    </section>
  );
}
