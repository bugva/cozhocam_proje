import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Eye, EyeOff, Pencil, Eraser, PenLine, Highlighter, Minus, Plus, Hand, Grid3x3, Square, Trash2 } from 'lucide-react';
import { SCALE, type PageLayout } from '../utils/pdfCrop';
import type { Region } from './PdfViewer';
import type { CroppedItem } from '../utils/db';

const DPR = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3;

type Tool = 'pencil' | 'pen' | 'highlighter' | 'eraser';
interface StrokePoint { x: number; y: number; p: number }
interface StrokeData { tool: Tool; color: string; baseSize: number; points: StrokePoint[] }

function drawStroke(ctx: CanvasRenderingContext2D, s: StrokeData) {
  const pts = s.points; if (!pts.length) return;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (s.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)'; ctx.lineWidth = s.baseSize * 8 * DPR;
  } else if (s.tool === 'highlighter') {
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 0.35;
    ctx.strokeStyle = s.color; ctx.lineWidth = s.baseSize * 10 * DPR;
  } else {
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.tool === 'pen' ? s.baseSize * 1.8 * DPR : s.baseSize * DPR;
  }
  ctx.beginPath();
  if (pts.length === 1) {
    ctx.arc(pts[0].x, pts[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle; ctx.fill(); ctx.restore(); return;
  }
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  ctx.stroke(); ctx.restore();
}

const G = { tool: 'pencil' as Tool, color: '#1a1a1f', baseSize: 2 };

// ── Per-page canvas with drawing ──
const DocPage: React.FC<{
  layout: PageLayout;
  items: { item: CroppedItem; region: Region }[];
  solMap: Map<number, CroppedItem>;
  strokes: StrokeData[];
  onStrokesChange: (s: StrokeData[]) => void;
  palmRejection: boolean;
  shownSols: Set<number>;
  onToggleSol: (qi: number) => void;
  allQRegions: Region[];
}> = ({ layout, items, solMap, strokes, onStrokesChange, palmRejection, shownSols, onToggleSol, allQRegions }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const activeStroke = useRef<StrokeData | null>(null);
  const strokesRef = useRef(strokes);
  const drawing = useRef(false);

  const dW = Math.round(layout.width / SCALE);
  const dH = Math.round(layout.height / SCALE);
  const cW = layout.width, cH = layout.height;

  useEffect(() => { strokesRef.current = strokes; }, [strokes]);

  const getOff = () => {
    if (!offRef.current) { offRef.current = document.createElement('canvas'); offRef.current.width = cW; offRef.current.height = cH; }
    return offRef.current;
  };
  const bake = (sl: StrokeData[]) => { const o = getOff(); const c = o.getContext('2d')!; c.clearRect(0, 0, cW, cH); sl.forEach(s => drawStroke(c, s)); };
  const composite = (live?: StrokeData) => {
    const cv = canvasRef.current; if (!cv) return;
    const c = cv.getContext('2d')!; c.clearRect(0, 0, cW, cH); c.drawImage(getOff(), 0, 0);
    if (live) drawStroke(c, live);
  };

  useEffect(() => { bake(strokesRef.current); composite(); }, []);

  const coord = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) * cW / r.width, y: (e.clientY - r.top) * cH / r.height, p: e.pressure > 0 ? e.pressure : 0.5 };
  };
  const ign = (e: React.PointerEvent) => palmRejection && e.pointerType === 'touch';

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (ign(e)) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    drawing.current = true;
    activeStroke.current = { tool: G.tool, color: G.color, baseSize: G.baseSize, points: [coord(e)] };
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !activeStroke.current || ign(e)) return;
    activeStroke.current.points.push(coord(e)); composite(activeStroke.current);
  };
  const onUp = () => {
    if (!drawing.current || !activeStroke.current) return;
    drawing.current = false;
    const next = [...strokesRef.current, activeStroke.current];
    activeStroke.current = null; strokesRef.current = next;
    bake(next); composite(); onStrokesChange(next);
  };
  const clear = () => { strokesRef.current = []; onStrokesChange([]); bake([]); composite(); };

  const sorted = [...items].sort((a, b) => a.region.y - b.region.y);

  return (
    <div style={{ position: 'relative', width: dW, height: dH, background: '#fff', borderRadius: 4, boxShadow: '0 2px 20px rgba(0,0,0,0.12)', overflow: 'visible', flexShrink: 0 }}>
      {/* Question images at original positions */}
      {sorted.map(({ item, region }) => {
        const left = region.x / SCALE;
        const top = (region.y - layout.offsetY) / SCALE;
        const w = item.width / SCALE;
        const h = item.height / SCALE;
        return (
          <img key={item.regionId} src={item.dataUrl} draggable={false}
            style={{ position: 'absolute', left, top, width: w, height: h, pointerEvents: 'none', imageRendering: 'crisp-edges', zIndex: 1 }}
          />
        );
      })}

      {/* Drawing canvas overlay */}
      <canvas ref={canvasRef} width={cW} height={cH}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 2, touchAction: 'none', cursor: G.tool === 'eraser' ? 'cell' : 'crosshair' }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      />

      {/* Solution buttons + reveals per question */}
      {sorted.filter(({ item }) => item.type === 'question').map(({ item, region }) => {
        const sol = solMap.get(item.questionIndex);
        if (!sol) return null;
        const shown = shownSols.has(item.questionIndex);
        const btnTop = (region.y + region.h - layout.offsetY) / SCALE + 6;

        // Find space below this question until next question or page bottom
        const qRegsOnPage = allQRegions.filter(r => {
          const ry = r.y; return ry >= layout.offsetY && ry < layout.offsetY + layout.height;
        }).sort((a, b) => a.y - b.y);
        const myIdx = qRegsOnPage.findIndex(r => r.id === region.id);
        const nextQTop = myIdx < qRegsOnPage.length - 1 ? (qRegsOnPage[myIdx + 1].y - layout.offsetY) / SCALE : dH;
        const spaceTop = (region.y + region.h - layout.offsetY) / SCALE;
        const spaceH = nextQTop - spaceTop;

        return (
          <React.Fragment key={`sol-${item.regionId}`}>
            {/* Toggle button */}
            <button onClick={() => onToggleSol(item.questionIndex)}
              style={{
                position: 'absolute', right: 12, top: btnTop, zIndex: 10,
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 12px', borderRadius: 20, border: 'none', cursor: 'pointer',
                fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
                background: shown ? 'rgba(255,69,58,0.12)' : 'rgba(48,209,88,0.12)',
                color: shown ? '#ff453a' : '#30d158',
                transition: 'all 0.2s',
              }}
            >
              {shown ? <EyeOff size={11} /> : <Eye size={11} />}
              {shown ? 'Gizle' : 'Çözüm'}
            </button>

            {/* Solution image (right side of white space) */}
            {shown && (
              <div style={{
                position: 'absolute',
                left: dW + 12, top: spaceTop,
                width: dW, zIndex: 10,
                background: '#fff', borderRadius: 8,
                boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
                border: '2px solid rgba(255,159,10,0.3)',
                overflow: 'hidden',
                animation: 'fadeIn 0.25s ease',
              }}>
                <div style={{ padding: '6px 12px', fontSize: 10, fontWeight: 800, color: '#ff9f0a', letterSpacing: '0.1em', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,159,10,0.2)' }}>
                  Çözüm
                </div>
                <img src={sol.dataUrl} draggable={false}
                  style={{ width: '100%', display: 'block' }}
                />
              </div>
            )}
          </React.Fragment>
        );
      })}

      {/* Clear button */}
      <button onClick={clear}
        style={{
          position: 'absolute', left: 8, bottom: 8, zIndex: 10,
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '4px 10px', borderRadius: 16, border: 'none', cursor: 'pointer',
          fontSize: 10, fontWeight: 700, fontFamily: 'inherit',
          background: 'rgba(0,0,0,0.06)', color: '#999',
          transition: 'all 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = '#ff453a'; e.currentTarget.style.background = 'rgba(255,69,58,0.1)'; }}
        onMouseLeave={e => { e.currentTarget.style.color = '#999'; e.currentTarget.style.background = 'rgba(0,0,0,0.06)'; }}
      >
        <Trash2 size={10} /> Temizle
      </button>
    </div>
  );
};

// ── Floating Toolbar ──
const TOOLS: { id: Tool; icon: React.ReactNode; label: string; color: string }[] = [
  { id: 'pencil', icon: <Pencil size={15} />, label: 'Kalem', color: '#0a84ff' },
  { id: 'pen', icon: <PenLine size={15} />, label: 'Dolma', color: '#5e5ce6' },
  { id: 'highlighter', icon: <Highlighter size={15} />, label: 'İşaretçi', color: '#ffd60a' },
  { id: 'eraser', icon: <Eraser size={15} />, label: 'Silgi', color: '#ff453a' },
];
const COLORS = ['#1a1a1f', '#0a84ff', '#ff453a', '#30d158', '#ffd60a', '#bf5af2', '#ff9f0a', '#ff375f'];

const Toolbar: React.FC<{
  tool: Tool; color: string; palm: boolean; size: number;
  onTool: (t: Tool) => void; onColor: (c: string) => void; onPalm: () => void; onSize: (s: number) => void;
  onGoEdit?: () => void;
}> = ({ tool, color, palm, size, onTool, onColor, onPalm, onSize, onGoEdit }) => {
  const [visible, setVisible] = useState(true);
  const activeToolColor = TOOLS.find(t => t.id === tool)?.color ?? '#0a84ff';

  return (
    <>
      {/* Toggle pill — always visible */}
      {!visible && (
        <button onClick={() => setVisible(true)} style={{
          position: 'fixed', top: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 10000,
          border: 'none', cursor: 'pointer',
          background: 'rgba(20,20,24,0.95)', backdropFilter: 'blur(20px)',
          color: '#0a84ff', padding: '8px 18px', borderRadius: 14,
          fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', gap: 6,
          boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.08) inset',
          transition: 'all 0.25s cubic-bezier(0.34,1.56,0.64,1)',
        }}>
          <Pencil size={13} /> Araç Paneli
        </button>
      )}

      {/* Main toolbar */}
      {visible && (
        <div style={{
          position: 'fixed', top: 14, left: '50%', transform: 'translateX(-50%)',
          zIndex: 9999, userSelect: 'none',
        }}>
          <div style={{
            background: 'linear-gradient(180deg, rgba(38,38,42,0.98) 0%, rgba(22,22,26,0.98) 100%)',
            backdropFilter: 'blur(40px) saturate(200%)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderTop: '1px solid rgba(255,255,255,0.18)',
            borderRadius: 22,
            boxShadow: '0 24px 80px rgba(0,0,0,0.75), 0 8px 24px rgba(0,0,0,0.4), 0 1px 0 rgba(255,255,255,0.08) inset, 0 -1px 0 rgba(0,0,0,0.3) inset',
            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
          }}>
            {/* Back to edit */}
            {onGoEdit && (<>
              <button onClick={onGoEdit} style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '6px 12px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)',
                fontSize: 11, fontWeight: 700, fontFamily: 'inherit', transition: 'all 0.18s',
              }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.14)'; (e.currentTarget as HTMLElement).style.color = '#fff'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)'; (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.6)'; }}
              >← Düzenle</button>
              <div style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.08)' }} />
            </>)}

            {/* Tool buttons */}
            {TOOLS.map(t => (
              <button key={t.id} title={t.label} onClick={() => onTool(t.id)} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                width: 48, padding: '6px 0', borderRadius: 12, border: 'none', cursor: 'pointer',
                background: tool === t.id ? `${t.color}22` : 'transparent',
                color: tool === t.id ? t.color : 'rgba(255,255,255,0.4)',
                transition: 'all 0.18s cubic-bezier(0.34,1.56,0.64,1)',
                boxShadow: tool === t.id ? `0 0 0 1.5px ${t.color}55` : 'none',
                transform: tool === t.id ? 'scale(1.06)' : 'scale(1)',
              }}>
                {t.icon}
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.04em' }}>{t.label}</span>
              </button>
            ))}

            <div style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.08)' }} />

            {/* Colors */}
            <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              {COLORS.map(c => (
                <button key={c} onClick={() => onColor(c)} style={{
                  width: tool === 'eraser' ? 16 : (color === c ? 22 : 16),
                  height: tool === 'eraser' ? 16 : (color === c ? 22 : 16),
                  borderRadius: '50%', background: c, border: 'none', cursor: 'pointer', padding: 0,
                  outline: color === c && tool !== 'eraser' ? `2px solid ${c}` : 'none', outlineOffset: 2,
                  transition: 'all 0.18s cubic-bezier(0.34,1.56,0.64,1)',
                  boxShadow: color === c && tool !== 'eraser' ? `0 0 8px ${c}88` : 'inset 0 0 0 0.5px rgba(0,0,0,0.3)',
                  opacity: tool === 'eraser' ? 0.35 : 1,
                }} />
              ))}
            </div>

            <div style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.08)' }} />

            {/* Size */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 4px' }}>
              <div style={{
                width: Math.max(6, size * 1.4), height: Math.max(6, size * 1.4),
                borderRadius: '50%', flexShrink: 0,
                background: tool === 'eraser' ? '#ff453a' : color,
                boxShadow: `0 0 8px ${tool === 'eraser' ? '#ff453a' : color}88`,
                transition: 'all 0.15s',
              }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {tool === 'eraser' ? 'Silgi' : 'Uç'}
                </span>
                <input type="range" min={1} max={24} step={1} value={size}
                  onChange={e => onSize(Number(e.target.value))}
                  style={{ width: 72, accentColor: tool === 'eraser' ? '#ff453a' : activeToolColor, cursor: 'pointer', margin: 0 }}
                />
                <span style={{ fontSize: 8, fontWeight: 600, color: 'rgba(255,255,255,0.35)', textAlign: 'center' }}>{size}px</span>
              </div>
            </div>

            <div style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.08)' }} />

            {/* Palm */}
            <button onClick={onPalm} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              width: 44, padding: '6px 0', borderRadius: 12, border: 'none', cursor: 'pointer',
              background: palm ? 'rgba(10,132,255,0.15)' : 'transparent',
              color: palm ? '#0a84ff' : 'rgba(255,255,255,0.25)',
              transition: 'all 0.18s', boxShadow: palm ? '0 0 0 1.5px rgba(10,132,255,0.35)' : 'none',
            }}>
              <Hand size={15} />
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.04em' }}>El</span>
            </button>

            <div style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.08)' }} />

            {/* Hide */}
            <button onClick={() => setVisible(false)} title="Paneli Gizle" style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28, borderRadius: 8, border: 'none', cursor: 'pointer',
              background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.3)',
              transition: 'all 0.18s', fontSize: 11, fontWeight: 700,
            }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ff453a'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.3)'; }}
            >✕</button>
          </div>
        </div>
      )}
    </>
  );
};

// ── Main Component ──
interface SolveViewDocProps {
  questions: CroppedItem[];
  stems: CroppedItem[];
  solutions: CroppedItem[];
  regions: Region[];
  pageLayouts: PageLayout[];
  allStrokes: Record<number, StrokeData[]>;
  onStrokesChange: (key: number, strokes: StrokeData[]) => void;
  onGoEdit?: () => void;
}

export const SolveViewDoc: React.FC<SolveViewDocProps> = ({ questions, stems, solutions, regions, pageLayouts, allStrokes, onStrokesChange, onGoEdit }) => {
  const [tool, setTool] = useState<Tool>('pencil');
  const [color, setColor] = useState('#1a1a1f');
  const [size, setSize] = useState(2);
  const [palm, setPalm] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [shownSols, setShownSols] = useState<Set<number>>(new Set());
  const [, tick] = useState(0);
  const [isFar, setIsFar] = useState(false); // true when user is far from content

  // Free-form pan+zoom: all refs, zero re-renders during gesture
  const touchesRef    = useRef<Map<number, { x: number; y: number }>>(new Map());
  const lastPinchDist = useRef<number | null>(null);
  const lastPinchMid  = useRef<{ x: number; y: number } | null>(null);
  const viewportRef   = useRef<HTMLDivElement>(null); // overflow:hidden container
  const contentRef    = useRef<HTMLDivElement>(null); // transform target
  const txRef = useRef(0);   // translateX
  const tyRef = useRef(0);   // translateY
  const scRef = useRef(1);   // scale

  const FAR_THRESHOLD = 400; // px
  const applyTransform = (tx: number, ty: number, sc: number) => {
    txRef.current = tx; tyRef.current = ty; scRef.current = sc;
    if (!contentRef.current) return;
    contentRef.current.style.transform = `translate(${tx}px, ${ty}px) scale(${sc})`;
    // Show 'return' button when far from content or very zoomed out
    const far = Math.abs(tx) > FAR_THRESHOLD || Math.abs(ty) > FAR_THRESHOLD || sc < 0.4;
    setIsFar(far);
  };

  const SOFT_LIMIT = 2000;
  const softApply = (tx: number, ty: number, sc: number) => {
    const clampedTx = Math.max(-SOFT_LIMIT, Math.min(SOFT_LIMIT, tx));
    const clampedTy = Math.max(-SOFT_LIMIT, Math.min(SOFT_LIMIT, ty));
    applyTransform(clampedTx, clampedTy, sc);
  };

  // Animate back to origin with a smooth CSS transition
  const returnToPage = () => {
    if (!contentRef.current) return;
    contentRef.current.style.transition = 'transform 0.45s cubic-bezier(0.25, 1, 0.5, 1)';
    applyTransform(0, 0, 1);
    setZoom(1);
    setTimeout(() => {
      if (contentRef.current) contentRef.current.style.transition = '';
    }, 460);
  };

  const applyTool  = useCallback((t: Tool) => { G.tool = t; setTool(t); tick(n => n + 1); }, []);
  const applyColor = useCallback((c: string) => { G.color = c; G.tool = 'pencil'; setColor(c); setTool('pencil'); tick(n => n + 1); }, []);
  const applySize  = useCallback((s: number) => { G.baseSize = s; setSize(s); tick(n => n + 1); }, []);

  const toggleSol = useCallback((qi: number) => {
    setShownSols(prev => { const n = new Set(prev); n.has(qi) ? n.delete(qi) : n.add(qi); return n; });
  }, []);

  // Build region map
  const regionMap = new Map(regions.map(r => [r.id, r]));
  const allItems = [...questions, ...stems];

  const solMap = new Map<number, CroppedItem>();
  solutions.forEach(s => solMap.set(s.questionIndex, s));
  const allQRegions = regions.filter(r => r.type === 'question').sort((a, b) => a.y - b.y);

  const pageItems = new Map<number, { item: CroppedItem; region: Region }[]>();
  allItems.forEach(item => {
    const reg = regionMap.get(item.regionId);
    if (!reg) return;
    const pg = pageLayouts.find(p => reg.y >= p.offsetY && reg.y < p.offsetY + p.height);
    if (!pg) return;
    const arr = pageItems.get(pg.pageNum) || [];
    arr.push({ item, region: reg });
    pageItems.set(pg.pageNum, arr);
  });

  // Zoom pill helpers
  const zoomTo = (sc: number) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const midX = vp.offsetWidth / 2;
    const midY = vp.offsetHeight / 2;
    const ratio = sc / scRef.current;
    const tx = midX - (midX - txRef.current) * ratio;
    const ty = midY - (midY - tyRef.current) * ratio;
    softApply(tx, ty, sc);
    setZoom(sc);
  };
  const zoomIn  = () => zoomTo(Math.min(MAX_ZOOM, +(scRef.current + 0.25).toFixed(2)));
  const zoomOut = () => zoomTo(Math.max(MIN_ZOOM, +(scRef.current - 0.25).toFixed(2)));
  const zoomReset = () => { softApply(0, 0, 1); setZoom(1); };

  // Native wheel + touch listeners — bypasses React's event system for max smoothness
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        // Pinch-to-zoom: exponential scale for perceptually linear feel
        const rect = vp.getBoundingClientRect();
        const midX = e.clientX - rect.left;
        const midY = e.clientY - rect.top;
        const factor = Math.exp(-e.deltaY * 0.008); // exponential = perfectly smooth
        const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scRef.current * factor));
        const ratio = next / scRef.current;
        softApply(
          midX - (midX - txRef.current) * ratio,
          midY - (midY - tyRef.current) * ratio,
          next,
        );
        setZoom(next);
      } else {
        // Two-finger pan — direct pixel delta, same smoothness as native scroll
        applyTransform(
          txRef.current - e.deltaX,
          tyRef.current - e.deltaY,
          scRef.current,
        );
      }
    };

    vp.addEventListener('wheel', handleWheel, { passive: false });
    return () => vp.removeEventListener('wheel', handleWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Touch: two-finger pan + pinch zoom centered at midpoint
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    Array.from(e.changedTouches).forEach(t => {
      touchesRef.current.set(t.identifier, { x: t.clientX, y: t.clientY });
    });
    if (touchesRef.current.size === 2) {
      const pts = Array.from(touchesRef.current.values());
      lastPinchDist.current = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      lastPinchMid.current  = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    }
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchesRef.current.size !== 2) return;
    e.preventDefault();
    Array.from(e.changedTouches).forEach(t => {
      touchesRef.current.set(t.identifier, { x: t.clientX, y: t.clientY });
    });
    const pts  = Array.from(touchesRef.current.values());
    const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    const mid  = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };

    const vp = viewportRef.current;
    if (!vp) return;
    const rect = vp.getBoundingClientRect();
    // Midpoint relative to viewport
    const localMidX = mid.x - rect.left;
    const localMidY = mid.y - rect.top;

    let tx = txRef.current;
    let ty = tyRef.current;
    let sc = scRef.current;

    // Pinch zoom centered at fingers
    if (lastPinchDist.current !== null && lastPinchDist.current > 0) {
      const ratio = dist / lastPinchDist.current;
      const next  = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, sc * ratio));
      const r     = next / sc;
      tx = localMidX - (localMidX - tx) * r;
      ty = localMidY - (localMidY - ty) * r;
      sc = next;
    }

    // Two-finger pan
    if (lastPinchMid.current !== null) {
      const prevLocalX = lastPinchMid.current.x - rect.left;
      const prevLocalY = lastPinchMid.current.y - rect.top;
      tx += localMidX - prevLocalX;
      ty += localMidY - prevLocalY;
    }

    // Apply directly — no clamp during gesture, fully free
    applyTransform(tx, ty, sc);

    lastPinchDist.current = dist;
    lastPinchMid.current  = mid;
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    Array.from(e.changedTouches).forEach(t => touchesRef.current.delete(t.identifier));
    if (touchesRef.current.size < 2) {
      lastPinchDist.current = null;
      lastPinchMid.current  = null;
      setZoom(scRef.current);
    }
  }, []);

  const anySolShown = shownSols.size > 0;

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#e8e8ed', position: 'relative', fontFamily: '-apple-system, "SF Pro Text", "Inter", sans-serif' }}>
      <Toolbar tool={tool} color={color} palm={palm} size={size} onTool={applyTool} onColor={applyColor} onPalm={() => setPalm(v => !v)} onSize={applySize} onGoEdit={onGoEdit} />

      {/* Zoom pill */}
      <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9998, display: 'flex', alignItems: 'center', gap: 3, background: 'rgba(22,22,26,0.95)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, padding: '4px 6px', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
        <button onClick={zoomOut} style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'none', cursor: 'pointer', color: '#636366', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Minus size={13} /></button>
        <button onClick={zoomReset} style={{ minWidth: 46, height: 28, borderRadius: 8, border: 'none', background: 'rgba(255,255,255,0.06)', cursor: 'pointer', color: '#e8e8ed', fontSize: 11, fontWeight: 700, fontFamily: 'inherit' }}>{Math.round(zoom * 100)}%</button>
        <button onClick={zoomIn} style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'none', cursor: 'pointer', color: '#636366', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Plus size={13} /></button>
      </div>

      {/* Return to page button — appears when user drifts far away */}
      <div style={{
        position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
        zIndex: 9998, pointerEvents: isFar ? 'auto' : 'none',
        opacity: isFar ? 1 : 0,
        transition: 'opacity 0.3s, transform 0.3s',
        transform: isFar ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(12px)',
      }}>
        <button onClick={returnToPage} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 20px', borderRadius: 16, border: 'none', cursor: 'pointer',
          background: 'linear-gradient(135deg, rgba(10,132,255,0.9), rgba(10,100,220,0.9))',
          backdropFilter: 'blur(20px)',
          color: '#fff', fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
          boxShadow: '0 8px 32px rgba(10,132,255,0.4), 0 2px 8px rgba(0,0,0,0.3)',
          transition: 'all 0.18s',
        }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1.05)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M3 12h18M3 12l7-7M3 12l7 7"/>
          </svg>
          Sayfaya Dön
        </button>
      </div>

      {/* Free-form viewport — all events handled natively via useEffect */}
      <div ref={viewportRef}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        style={{ flex: 1, overflow: 'hidden', position: 'relative', touchAction: 'none' }}>
        <div ref={contentRef} style={{
          transform: `translate(0px, 0px) scale(1)`,
          transformOrigin: '0 0',
          willChange: 'transform',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
          padding: '48px 40px 120px',
          paddingRight: anySolShown ? 440 : 40,
          transition: 'padding 0.3s',
          width: 'max-content',
          minWidth: '100%',
        }}>
          {pageLayouts.map(pg => (
            <DocPage
              key={pg.pageNum}
              layout={pg}
              items={pageItems.get(pg.pageNum) || []}
              solMap={solMap}
              strokes={allStrokes[10000 + pg.pageNum] || []}
              onStrokesChange={s => onStrokesChange(10000 + pg.pageNum, s)}
              palmRejection={palm}
              shownSols={shownSols}
              onToggleSol={toggleSol}
              allQRegions={allQRegions}
            />
          ))}
        </div>
      </div>
    </div>
  );

};
