import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Pencil, Eraser, Trash2, Eye, EyeOff, Hand, Minus, Plus, Highlighter, PenLine, Grid3x3, Square, CheckCircle2, XCircle } from 'lucide-react';
import { SCALE } from '../utils/pdfCrop';

const A4_W = 794;
const ANSWER_HEIGHT = 420;
const DPR = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 3;

type Tool = 'pencil' | 'pen' | 'highlighter' | 'eraser';

interface StrokePoint { x: number; y: number; p: number; }
interface StrokeData { tool: Tool; color: string; baseSize: number; points: StrokePoint[]; }
interface CroppedItem { regionId: string; type: 'question' | 'solution' | 'stem'; dataUrl: string; width: number; height: number; questionIndex: number; sortY?: number; }

type QuestionStatus = 'correct' | 'wrong' | null;

interface SolveViewProps {
  questions: CroppedItem[];
  stems: CroppedItem[];
  solutions: CroppedItem[];
  allStrokes: Record<number, StrokeData[]>;
  onStrokesChange: (qi: number, strokes: StrokeData[]) => void;
}

type BgStyle = 'plain' | 'grid';
// Module-level shared state
const G = { tool: 'pencil' as Tool, color: '#e8e8ed', baseSize: 2, bg: 'plain' as BgStyle };

// ── Drawing Helpers ───────────────────────────────────────────────────────

function drawStroke(ctx: CanvasRenderingContext2D, s: StrokeData) {
  const pts = s.points;
  if (pts.length === 0) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (s.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.lineWidth = s.baseSize * 8 * DPR;
  } else if (s.tool === 'highlighter') {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.baseSize * 10 * DPR;
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.tool === 'pen'
      ? s.baseSize * 1.8 * DPR
      : s.baseSize * DPR;
  }

  ctx.beginPath();
  if (pts.length === 1) {
    ctx.arc(pts[0].x, pts[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
    ctx.restore(); return;
  }
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  ctx.stroke();
  ctx.restore();
}

function redrawCanvas(ctx: CanvasRenderingContext2D, strokes: StrokeData[], w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
  strokes.forEach(s => drawStroke(ctx, s));
}

// ── Question Card ─────────────────────────────────────────────────────────

const QuestionCard: React.FC<{
  item: CroppedItem;        // soru VEYA öncül
  isQuestion: boolean;      // true→ numara göster, false→ "Öncül"
  questionNumber?: number;  // sadece isQuestion=true
  solution?: CroppedItem;
  strokes: StrokeData[];
  onStrokesChange: (s: StrokeData[]) => void;
  palmRejection: boolean;
  bgStyle: BgStyle;
  zoom: number;
  showSolOverride?: boolean;
}> = ({ item, isQuestion, questionNumber, solution, strokes, onStrokesChange, palmRejection, bgStyle, zoom, showSolOverride }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const activeStroke = useRef<StrokeData | null>(null);
  const strokesRef = useRef(strokes);
  const drawing = useRef(false);
  const [showSolLocal, setShowSolLocal] = useState(false);
  const showSol = showSolOverride ?? showSolLocal;
  const setShowSol = (v: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(showSolLocal) : v;
    setShowSolLocal(next);
  };
  const [status, setStatus] = useState<QuestionStatus>(null);
  const [answerH, setAnswerH] = useState(ANSWER_HEIGHT);
  const resizing = useRef(false);
  const resizeStart = useRef({ y: 0, h: ANSWER_HEIGHT });

  useEffect(() => { strokesRef.current = strokes; }, [strokes]);

  const cW = A4_W * DPR;
  const cH = answerH * DPR;

  const PADDING = 48;
  const maxW = A4_W - PADDING;
  const naturalW = item.width / SCALE;
  const naturalH = item.height / SCALE;
  const scaleRatio = naturalW > maxW ? maxW / naturalW : 1;
  const displayW = Math.round(naturalW * scaleRatio * 1.4);
  const displayH = Math.round(naturalH * scaleRatio * 1.4);

  // Resize handle handlers
  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    resizing.current = true;
    resizeStart.current = { y: e.clientY, h: answerH };
  };
  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizing.current) return;
    // Divide by zoom so drag distance matches visual card size
    const delta = (e.clientY - resizeStart.current.y) / zoom;
    setAnswerH(Math.max(120, resizeStart.current.h + delta));
  };
  const onResizeUp = () => { resizing.current = false; };

  const getOff = () => {
    if (!offRef.current) {
      offRef.current = document.createElement('canvas');
      offRef.current.width = cW;
      offRef.current.height = cH;
    }
    const off = offRef.current;
    // Only reset if dimensions changed (resetting clears the canvas!)
    if (off.width !== cW || off.height !== cH) {
      off.width = cW;
      off.height = cH;
      // Re-bake existing strokes after resize
      redrawCanvas(off.getContext('2d')!, strokesRef.current, cW, cH);
    }
    return off;
  };

  const bakeStrokes = (sl: StrokeData[]) => {
    const off = getOff();
    redrawCanvas(off.getContext('2d')!, sl, cW, cH);
  };

  const composite = (live?: StrokeData) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, cW, cH);
    ctx.drawImage(getOff(), 0, 0);
    if (live) drawStroke(ctx, live);
  };

  useEffect(() => { bakeStrokes(strokesRef.current); composite(); }, []); // eslint-disable-line

  const coord = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) * cW / r.width, y: (e.clientY - r.top) * cH / r.height, p: e.pressure > 0 ? e.pressure : 0.5 };
  };

  const ignore = (e: React.PointerEvent) => palmRejection && e.pointerType === 'touch';

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (ignore(e)) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    drawing.current = true;
    activeStroke.current = { tool: G.tool, color: G.color, baseSize: G.baseSize, points: [coord(e)] };
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !activeStroke.current || ignore(e)) return;
    activeStroke.current.points.push(coord(e));
    composite(activeStroke.current);
  };

  const onUp = () => {
    if (!drawing.current || !activeStroke.current) return;
    drawing.current = false;
    const next = [...strokesRef.current, activeStroke.current];
    activeStroke.current = null;
    strokesRef.current = next;
    bakeStrokes(next); composite();
    onStrokesChange(next);
  };

  const clear = () => {
    strokesRef.current = []; onStrokesChange([]);
    bakeStrokes([]); composite();
  };

  return (
    <div style={{
      width: A4_W,
      background: 'linear-gradient(180deg, #1e1e24 0%, #17171c 100%)',
      borderRadius: 8,
      overflow: 'hidden', flexShrink: 0, userSelect: 'none',
      boxShadow: '0 1px 0 rgba(255,255,255,0.06), 0 4px 6px rgba(0,0,0,0.2), 0 24px 64px rgba(0,0,0,0.45)',
      border: '1px solid rgba(255,255,255,0.08)',
    }}>
      {/* Header */}
      <div style={{ padding: '5px 14px', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {isQuestion ? (
            <>
              <div style={{ width: 16, height: 16, borderRadius: 4, background: 'linear-gradient(135deg,#0a84ff,#5e5ce6)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 5px rgba(10,132,255,0.3)' }}>
                <span style={{ fontSize: 8, fontWeight: 800, color: '#fff' }}>{questionNumber}</span>
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(10,132,255,0.8)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Soru {questionNumber}</span>
            </>
          ) : (
            <>
              <div style={{ width: 16, height: 16, borderRadius: 4, background: 'linear-gradient(135deg,#ff9f0a,#ff6b00)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 8, fontWeight: 800, color: '#fff' }}>Ö</span>
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#ff9f0a', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Öncül</span>
            </>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Correct / Wrong status */}
          <button
            onClick={() => setStatus(s => s === 'correct' ? null : 'correct')}
            title="Doğru"
            style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '3px 9px', borderRadius: 20, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 10, fontWeight: 700,
              background: status === 'correct' ? 'rgba(48,209,88,0.18)' : 'rgba(255,255,255,0.05)',
              color: status === 'correct' ? '#30d158' : 'rgba(255,255,255,0.25)', transition: 'all 0.2s' }}
          ><CheckCircle2 size={11} /> Doğru</button>
          <button
            onClick={() => setStatus(s => s === 'wrong' ? null : 'wrong')}
            title="Yanlış"
            style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '3px 9px', borderRadius: 20, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 10, fontWeight: 700,
              background: status === 'wrong' ? 'rgba(255,69,58,0.18)' : 'rgba(255,255,255,0.05)',
              color: status === 'wrong' ? '#ff453a' : 'rgba(255,255,255,0.25)', transition: 'all 0.2s' }}
          ><XCircle size={11} /> Yanlış</button>
          {solution && (
            <button onClick={() => setShowSol(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 10, fontWeight: 600, background: showSol ? 'rgba(255,69,58,0.15)' : 'rgba(48,209,88,0.12)', color: showSol ? '#ff453a' : '#30d158', transition: 'all 0.15s' }}>
              {showSol ? <EyeOff size={10} /> : <Eye size={10} />} {showSol ? 'Gizle' : 'Çözümü Gör'}
            </button>
          )}
        </div>
      </div>

      {/* Status stripe */}
      {status && (
        <div style={{ height: 3, background: status === 'correct' ? 'linear-gradient(90deg,#30d158,#34c759)' : 'linear-gradient(90deg,#ff453a,#ff375f)', transition: 'all 0.3s' }} />
      )}

      {/* Item image (soru veya öncül) */}
      <div style={{ background: '#ffffff', padding: '14px 24px' }}>
        <img
          src={item.dataUrl}
          alt={isQuestion ? `Soru ${questionNumber}` : 'Öncül'}
          draggable={false}
          style={{ width: displayW, height: displayH, display: 'block', imageRendering: 'crisp-edges' }}
        />
      </div>

      {/* Animated solution reveal */}
      <div style={{
        overflow: 'hidden',
        maxHeight: showSol && solution ? 2000 : 0,
        opacity: showSol && solution ? 1 : 0,
        transition: 'max-height 0.45s cubic-bezier(0.4,0,0.2,1), opacity 0.3s ease',
      }}>
        {solution && (
          <div style={{ background: '#fff', borderTop: '2px solid rgba(255,159,10,0.5)' }}>
            <div style={{ padding: '6px 20px 2px', fontSize: 9, fontWeight: 800, color: '#ff9f0a', letterSpacing: '0.12em', textTransform: 'uppercase' }}>—— ÇÖZÜM ——</div>
            <img src={solution.dataUrl} alt="Çözüm" draggable={false} style={{ width: '100%', display: 'block', padding: '4px 16px 14px', boxSizing: 'border-box', pointerEvents: 'none' }} />
          </div>
        )}
      </div>

      {/* Answer separator */}
      <div style={{
        padding: '7px 20px 6px',
        background: 'rgba(255,255,255,0.02)',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        borderBottom: '1px dashed rgba(100,120,200,0.2)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 3, height: 12, borderRadius: 2, background: 'linear-gradient(135deg,#0a84ff,#5e5ce6)' }} />
          <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Cevap</span>
        </div>
        <button onClick={clear}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.2)', fontSize: 11, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 5, transition: 'color 0.15s' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#ff453a')}
          onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.2)')}
        >
          <Trash2 size={10} /> Temizle
        </button>
      </div>

      {/* Canvas */}
      <canvas ref={canvasRef} width={cW} height={cH}
        style={{
          width: '100%', height: answerH, display: 'block',
          touchAction: 'none',
          cursor: G.tool === 'eraser' ? 'cell' : 'crosshair',
          background: bgStyle === 'grid'
            ? `repeating-linear-gradient(rgba(100,140,255,0.10) 0 1px, transparent 1px 32px),
               repeating-linear-gradient(90deg, rgba(100,140,255,0.10) 0 1px, transparent 1px 32px)`
            : 'transparent',
        }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      />

      {/* Resize handle */}
      <div
        onPointerDown={onResizeDown} onPointerMove={onResizeMove}
        onPointerUp={onResizeUp} onPointerCancel={onResizeUp}
        style={{
          height: 14, cursor: 'ns-resize',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(255,255,255,0.03)',
          borderTop: '1px solid rgba(255,255,255,0.07)',
          touchAction: 'none',
          userSelect: 'none',
        }}
        title="Sürükleyerek boyutlandır"
      >
        <div style={{ width: 36, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.15)' }} />
      </div>
    </div>
  );
};

// ── Draggable Floating Toolbar ────────────────────────────────────────────

const TOOLS: { id: Tool; icon: React.ReactNode; label: string; activeColor: string }[] = [
  { id: 'pencil', icon: <Pencil size={14} />, label: 'Kalem', activeColor: '#0a84ff' },
  { id: 'pen', icon: <PenLine size={14} />, label: 'Pen', activeColor: '#5e5ce6' },
  { id: 'highlighter', icon: <Highlighter size={14} />, label: 'İşaretçi', activeColor: '#ffd60a' },
  { id: 'eraser', icon: <Eraser size={14} />, label: 'Silgi', activeColor: '#ff453a' },
];

const COLORS = [
  '#e8e8ed', '#0a84ff', '#ff453a', '#30d158', '#ffd60a', '#bf5af2', '#ff9f0a', '#ff375f',
];

const FloatingToolbar: React.FC<{
  tool: Tool; color: string; palmRejection: boolean; bgStyle: BgStyle;
  onTool: (t: Tool) => void; onColor: (c: string) => void;
  onPalmToggle: () => void; onBgToggle: () => void;
}> = ({ tool, color, palmRejection, bgStyle, onTool, onColor, onPalmToggle, onBgToggle }) => {
  const [pos, setPos] = useState({ x: 24, y: 80 }); // start on-screen, top-left safe zone
  const dragging = useRef(false);
  const dragStart = useRef({ mx: 0, my: 0, bx: 0, by: 0 });

  const onDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    dragging.current = true;
    dragStart.current = { mx: e.clientX, my: e.clientY, bx: pos.x, by: pos.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    setPos({ x: dragStart.current.bx + e.clientX - dragStart.current.mx, y: dragStart.current.by + e.clientY - dragStart.current.my });
  };

  const onDragEnd = () => { dragging.current = false; };

  return (
    <div
      style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 9999, userSelect: 'none', cursor: 'grab', touchAction: 'none' }}
      onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd}
    >
      <div style={{ background: 'rgba(28,28,30,0.92)', backdropFilter: 'blur(24px) saturate(180%)', WebkitBackdropFilter: 'blur(24px) saturate(180%)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '10px 12px', boxShadow: '0 16px 48px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.08) inset', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 52 }}>

        {/* Drag handle */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 3, paddingBottom: 2 }}>
          {[0,1,2].map(i => <div key={i} style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(255,255,255,0.2)' }} />)}
        </div>

        {/* Tools */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {TOOLS.map(t => (
            <button key={t.id} title={t.label} onClick={() => onTool(t.id)} style={{ width: 36, height: 36, borderRadius: 10, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: tool === t.id ? t.activeColor : 'rgba(255,255,255,0.07)', color: tool === t.id ? '#fff' : 'rgba(255,255,255,0.55)', transition: 'all 0.15s', boxShadow: tool === t.id ? `0 2px 10px ${t.activeColor}66` : 'none', transform: tool === t.id ? 'scale(1.05)' : 'scale(1)' }}>
              {t.icon}
            </button>
          ))}
        </div>

        <div style={{ height: 1, background: 'rgba(255,255,255,0.07)' }} />

        {/* Colors */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'center' }}>
          {COLORS.map(c => (
            <button key={c} onClick={() => onColor(c)} style={{ width: 18, height: 18, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer', padding: 0, outline: color === c && tool !== 'eraser' ? `2.5px solid ${c}` : 'none', outlineOffset: 2.5, transform: color === c && tool !== 'eraser' ? 'scale(1.2)' : 'scale(1)', transition: 'all 0.15s cubic-bezier(0.34,1.56,0.64,1)', boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.3)' }} />
          ))}
        </div>

        <div style={{ height: 1, background: 'rgba(255,255,255,0.07)' }} />

        {/* BG style toggle */}
        <button onClick={onBgToggle} title={bgStyle === 'grid' ? 'Düz' : 'Kareli'} style={{ width: 36, height: 36, borderRadius: 10, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: bgStyle === 'grid' ? 'rgba(255,214,10,0.2)' : 'rgba(255,255,255,0.07)', color: bgStyle === 'grid' ? '#ffd60a' : 'rgba(255,255,255,0.35)', transition: 'all 0.15s' }}>
          {bgStyle === 'grid' ? <Grid3x3 size={14} /> : <Square size={14} />}
        </button>

        {/* Palm rejection */}
        <button onClick={onPalmToggle} title="El Reddi" style={{ width: 36, height: 36, borderRadius: 10, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: palmRejection ? 'rgba(10,132,255,0.2)' : 'rgba(255,255,255,0.07)', color: palmRejection ? '#0a84ff' : 'rgba(255,255,255,0.35)', transition: 'all 0.15s' }}>
          <Hand size={14} />
        </button>
      </div>
    </div>
  );
};

// ── Main SolveView ────────────────────────────────────────────────────────

export const SolveView: React.FC<SolveViewProps> = ({ questions, stems = [], solutions, allStrokes, onStrokesChange }) => {
  const [tool, setTool] = useState<Tool>('pencil');
  const [color, setColor] = useState('#e8e8ed');
  const [palmRejection, setPalmRejection] = useState(true);
  const [bgStyle, setBgStyle] = useState<BgStyle>('plain');
  const [zoom, setZoom] = useState(1);
  const [showAllSol, setShowAllSol] = useState(false);
  const [, tick] = useState(0);

  // Touch tracking for pinch+pan
  const touches = useRef<Map<number, { x: number; y: number }>>(new Map());
  const lastPinchDist = useRef<number | null>(null);
  const lastPinchMid = useRef<{ x: number; y: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const applyTool = useCallback((t: Tool) => { G.tool = t; setTool(t); tick(n => n + 1); }, []);
  const applyColor = useCallback((c: string) => { G.color = c; G.tool = 'pencil'; setColor(c); setTool('pencil'); tick(n => n + 1); }, []);
  const toggleBg = useCallback(() => { const next: BgStyle = bgStyle === 'plain' ? 'grid' : 'plain'; G.bg = next; setBgStyle(next); }, [bgStyle]);

  // Soru + öncüller PDF sırasıyla (sortY), birlikte tek liste
  const sortedItems = [...questions, ...stems].sort((a, b) => (a.sortY ?? a.questionIndex) - (b.sortY ?? b.questionIndex));

  // ── Wheel zoom (Ctrl/Cmd + scroll = zoom, else normal scroll) ──
  const onWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setZoom(z => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z - e.deltaY * 0.005)));
    }
  }, []);

  // ── Touch events for pinch-to-zoom and two-finger pan ──
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    Array.from(e.changedTouches).forEach(t => {
      touches.current.set(t.identifier, { x: t.clientX, y: t.clientY });
    });
    if (touches.current.size === 2) {
      const pts = Array.from(touches.current.values());
      const dx = pts[1].x - pts[0].x;
      const dy = pts[1].y - pts[0].y;
      lastPinchDist.current = Math.hypot(dx, dy);
      lastPinchMid.current = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    }
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (touches.current.size !== 2) return;
    e.preventDefault();
    Array.from(e.changedTouches).forEach(t => {
      touches.current.set(t.identifier, { x: t.clientX, y: t.clientY });
    });
    const pts = Array.from(touches.current.values());
    const dx = pts[1].x - pts[0].x;
    const dy = pts[1].y - pts[0].y;
    const dist = Math.hypot(dx, dy);
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };

    if (lastPinchDist.current !== null) {
      const ratio = dist / lastPinchDist.current;
      setZoom(z => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z * ratio)));
    }
    if (lastPinchMid.current !== null && scrollRef.current) {
      scrollRef.current.scrollLeft -= mid.x - lastPinchMid.current.x;
      scrollRef.current.scrollTop  -= mid.y - lastPinchMid.current.y;
    }
    lastPinchDist.current = dist;
    lastPinchMid.current = mid;
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    Array.from(e.changedTouches).forEach(t => touches.current.delete(t.identifier));
    if (touches.current.size < 2) { lastPinchDist.current = null; lastPinchMid.current = null; }
  }, []);

  const zoomIn  = () => setZoom(z => Math.min(MAX_ZOOM, +(z + 0.15).toFixed(2)));
  const zoomOut = () => setZoom(z => Math.max(MIN_ZOOM, +(z - 0.15).toFixed(2)));
  const zoomReset = () => { setZoom(1); };

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: 'linear-gradient(180deg, #111118 0%, #0a0a0e 100%)', position: 'relative', fontFamily: '-apple-system, "SF Pro Text", "Inter", sans-serif' }}>

      {/* Top action bar */}
      {solutions.length > 0 && (
        <div style={{
          position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
          zIndex: 9990, display: 'flex', gap: 8,
        }}>
          <button
            onClick={() => setShowAllSol(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 18px', borderRadius: 24, cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
              background: showAllSol ? 'rgba(255,159,10,0.25)' : 'rgba(255,255,255,0.08)',
              color: showAllSol ? '#ff9f0a' : 'rgba(255,255,255,0.6)',
              backdropFilter: 'blur(16px)',
              border: `1px solid ${showAllSol ? 'rgba(255,159,10,0.4)' : 'rgba(255,255,255,0.1)'}`,
              boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
              transition: 'all 0.2s',
            }}
          >
            {showAllSol ? <EyeOff size={13} /> : <Eye size={13} />}
            {showAllSol ? 'Tüm Çözümleri Gizle' : 'Tüm Çözümleri Gör'}
          </button>
        </div>
      )}

      <FloatingToolbar
        tool={tool} color={color} palmRejection={palmRejection} bgStyle={bgStyle}
        onTool={applyTool} onColor={applyColor} onPalmToggle={() => setPalmRejection(v => !v)} onBgToggle={toggleBg}
      />

      {/* Zoom pill — bottom right */}
      <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9998, display: 'flex', alignItems: 'center', gap: 3, background: 'rgba(22,22,26,0.95)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, padding: '4px 6px', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
        <button onClick={zoomOut} style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'none', cursor: 'pointer', color: '#636366', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'color 0.15s' }} onMouseEnter={e => (e.currentTarget.style.color = '#fff')} onMouseLeave={e => (e.currentTarget.style.color = '#636366')}><Minus size={13} /></button>
        <button onClick={zoomReset} style={{ minWidth: 46, height: 28, borderRadius: 8, border: 'none', background: 'rgba(255,255,255,0.06)', cursor: 'pointer', color: '#e8e8ed', fontSize: 11, fontWeight: 700, fontFamily: 'inherit', letterSpacing: '0.02em' }}>{Math.round(zoom * 100)}%</button>
        <button onClick={zoomIn}  style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'none', cursor: 'pointer', color: '#636366', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'color 0.15s' }} onMouseEnter={e => (e.currentTarget.style.color = '#fff')} onMouseLeave={e => (e.currentTarget.style.color = '#636366')}><Plus size={13} /></button>
      </div>

      {/* Scrollable + pinch-zoomable viewport */}
      <div
        ref={scrollRef}
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 0 120px' }}
      >
        <div style={{
          transform: `scale(${zoom})`,
          transformOrigin: 'top center',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: 6,
          // Expand layout height so scroll area doesn't collapse at zoomed-out sizes
          marginBottom: zoom < 1 ? `${(1 - zoom) * -400}px` : 0,
        }}>
          {sortedItems.length === 0 && (
            <div style={{ color: 'rgba(255,255,255,0.15)', fontSize: 14, marginTop: 80, letterSpacing: '0.02em' }}>Henüz soru yok.</div>
          )}
          {(() => {
            let qNum = 0;
            return sortedItems.map(item => {
              const isQ = item.type === 'question';
              if (isQ) qNum++;
              return (
                <QuestionCard
                  key={item.regionId}
                  item={item}
                  isQuestion={isQ}
                  questionNumber={isQ ? qNum : undefined}
                  solution={isQ ? solutions.find(s => s.questionIndex === item.questionIndex) : undefined}
                  strokes={allStrokes[item.questionIndex] || []}
                  onStrokesChange={s => onStrokesChange(item.questionIndex, s)}
                  palmRejection={palmRejection}
                  bgStyle={bgStyle}
                  zoom={zoom}
                  showSolOverride={showAllSol ? true : undefined}
                />
              );
            });
          })()}
        </div>
      </div>
    </div>
  );
};
