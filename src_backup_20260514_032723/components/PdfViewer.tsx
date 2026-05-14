import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.js?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface Region {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  type: 'question' | 'solution' | 'stem';
}

interface PageInfo {
  pageNum: number;
  width: number;
  height: number;
  offsetY: number;
}

interface PdfViewerProps {
  pdfData: ArrayBuffer;
  mode?: 'SELECT_QUESTIONS' | 'ADJUST_SOLUTIONS' | 'SOLVE';
  regions?: Region[];
  onRegionsChange?: (regions: Region[]) => void;
  showOriginal?: boolean;
}

import { SCALE, PAGE_GAP } from '../utils/pdfCrop';

/* ── Single page renderer (self-contained, StrictMode safe) ── */
const PageCanvas: React.FC<{ pdf: pdfjsLib.PDFDocumentProxy; pageNum: number }> = ({ pdf, pageNum }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<any>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const render = async () => {
      await new Promise(r => setTimeout(r, 0));
      if (cancelled || !canvasRef.current) return;

      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch (_) {}
      }

      try {
        setPageError(null);
        const page = await pdf.getPage(pageNum);
        if (cancelled || !canvasRef.current) return;

        const viewport = page.getViewport({ scale: SCALE });
        const canvas = canvasRef.current;
        const dpr = window.devicePixelRatio || 1;

        let canvasWidth = Math.floor(viewport.width * dpr);
        let canvasHeight = Math.floor(viewport.height * dpr);

        // Prevent exceeding browser canvas limits (e.g. 4096px or 16M pixels)
        const MAX_DIM = 4096;
        const MAX_AREA = 16777216; // 16MB
        if (canvasWidth > MAX_DIM || canvasHeight > MAX_DIM || (canvasWidth * canvasHeight) > MAX_AREA) {
          const ratioX = MAX_DIM / canvasWidth;
          const ratioY = MAX_DIM / canvasHeight;
          const ratioArea = Math.sqrt(MAX_AREA / (canvasWidth * canvasHeight));
          const scaleDown = Math.min(ratioX, ratioY, ratioArea, 1);
          canvasWidth = Math.floor(canvasWidth * scaleDown);
          canvasHeight = Math.floor(canvasHeight * scaleDown);
        }

        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        const ctx = canvas.getContext('2d')!;
        
        // Correct way to handle high-DPI and scaled down canvas in PDF.js
        const scaleX = canvasWidth / viewport.width;
        const scaleY = canvasHeight / viewport.height;
        const transform = (scaleX !== 1 || scaleY !== 1) ? [scaleX, 0, 0, scaleY, 0, 0] : undefined;

        const renderTask = page.render({ 
          canvasContext: ctx, 
          viewport,
          transform
        } as any);
        
        renderTaskRef.current = renderTask;
        await renderTask.promise;
      } catch (err: any) {
        if (err?.name === 'RenderingCancelledException') return;
        console.error(`Page ${pageNum} render error:`, err);
        setPageError(`Sayfa ${pageNum} çizilemedi: ${err?.message || 'Bilinmeyen hata'}`);
      } finally {
        if (renderTaskRef.current) renderTaskRef.current = null;
      }
    };

    render();

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch (_) {}
        renderTaskRef.current = null;
      }
    };
  }, [pdf, pageNum]);

  if (pageError) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ff453a', padding: 16, textAlign: 'center', fontWeight: 500, fontSize: 14 }}>
        {pageError}
      </div>
    );
  }

  return <canvas ref={canvasRef} style={{ display: 'block' }} />;
};

/* ── PdfViewer ── */
export const PdfViewer: React.FC<PdfViewerProps> = ({
  pdfData,
  mode = 'SELECT_QUESTIONS',
  regions = [],
  onRegionsChange,
  showOriginal = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [renderError, setRenderError] = useState<string | null>(null);
  const isDrawingRef = useRef(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [currentPos, setCurrentPos] = useState({ x: 0, y: 0 });
  const [drawType, setDrawType] = useState<'question' | 'stem'>('question');
  // Drag/resize refs — NO useState (avoids stale closures)
  const dragRef = useRef<{ id: string; lastY: number; lastX: number } | null>(null);
  const resizeRef = useRef<{ id: string; edge: 'top' | 'bottom'; lastY: number } | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null); // only for cursor style

  // Load PDF
  useEffect(() => {
    if (!pdfData) return;
    let cancelled = false;

    (async () => {
      try {
        console.log('Loading PDF...');
        const doc = await pdfjsLib.getDocument({
          data: new Uint8Array(pdfData.slice(0)),
          cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/standard_fonts/`,
        }).promise;
        console.log('PDF loaded, numPages:', doc.numPages);
        if (cancelled) return;

        const infos: PageInfo[] = [];
        let cumY = 0;
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          if (cancelled) return;
          const vp = page.getViewport({ scale: SCALE });
          infos.push({ pageNum: i, width: vp.width, height: vp.height, offsetY: cumY });
          cumY += vp.height + PAGE_GAP;
        }

        console.log('Pages built:', infos.length);
        if (cancelled) return;
        setPdf(doc);
        setPages(infos);
      } catch (err: any) {
        if (cancelled) return;
        console.error('PdfViewer load error:', err);
        setRenderError('PDF Yükleme Hatası: ' + (err?.message ?? err));
      }
    })();

    return () => { cancelled = true; };
  }, [pdfData]);

  // Total size
  const totalHeight = pages.length > 0 ? pages[pages.length - 1].offsetY + pages[pages.length - 1].height : 0;
  const docWidth = pages.length > 0 ? pages[0].width : 0;

  // Pointer handlers
  const getPos = (e: React.PointerEvent) => {
    const r = containerRef.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(e.clientX - r.left, r.width)), y: Math.max(0, Math.min(e.clientY - r.top, r.height)) };
  };

  const onDown = (e: React.PointerEvent) => {
    if (mode !== 'SELECT_QUESTIONS' && mode !== 'ADJUST_SOLUTIONS') return;
    // ADJUST_SOLUTIONS modunda drag handle'larını atla
    if ((e.target as HTMLElement).dataset.resizeHandle) return;
    if ((e.target as HTMLElement).closest('button')) return;
    // Drag halindeyse yeni çizim başlatma
    if (mode === 'ADJUST_SOLUTIONS' && (e.target as HTMLElement).closest('[data-region="true"]')) return;
    const p = getPos(e);
    isDrawingRef.current = true; setIsDrawing(true); setStartPos(p); setCurrentPos(p);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!isDrawingRef.current) return;
    if (mode !== 'SELECT_QUESTIONS' && mode !== 'ADJUST_SOLUTIONS') return;
    setCurrentPos(getPos(e));
  };
  const onUp = (e: React.PointerEvent) => {
    if (!isDrawingRef.current) return;
    if (mode !== 'SELECT_QUESTIONS' && mode !== 'ADJUST_SOLUTIONS') return;
    isDrawingRef.current = false; setIsDrawing(false);
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch (_) {}
    const end = getPos(e);
    const x = Math.min(startPos.x, end.x), y = Math.min(startPos.y, end.y);
    const w = Math.abs(end.x - startPos.x), h = Math.abs(end.y - startPos.y);
    if (w > 8 && h > 8 && onRegionsChange) {
      if (mode === 'SELECT_QUESTIONS') {
        onRegionsChange([...regions, { id: `${drawType}-${Date.now()}`, x, y, w, h, type: drawType }]);
      } else {
        // ADJUST_SOLUTIONS: yeni çözüm alanı — serbest boyut, hiçbir kısıtlama yok
        const solId = `sol-${Date.now()}`;
        onRegionsChange([...regions, { id: solId, x, y, w, h, type: 'solution' }]);
      }
    }
  };

  const removeRegion = (id: string, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    onRegionsChange?.(regions.filter(r => r.id !== id));
  };

  const questionRegions = regions.filter(r => r.type === 'question');

  return (
    <div style={{ position: 'relative', display: 'inline-block', userSelect: 'none' }}>
      {renderError && (
        <div style={{ padding: 16, background: '#ff453a', color: '#fff', fontWeight: 600, fontSize: 14, borderRadius: 8 }}>
          {renderError}
        </div>
      )}

      {/* Draw mode toolbar (SELECT_QUESTIONS only) */}
      {mode === 'SELECT_QUESTIONS' && (
        <div style={{
          position: 'sticky', top: 0, zIndex: 100,
          display: 'flex', gap: 6, padding: '8px 12px',
          background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(0,0,0,0.08)',
        }}>
          {([
            { t: 'question' as const, label: '① Soru Seç', color: '#34c759' },
            { t: 'stem' as const, label: '② Öncül Ekle', color: '#ff9f0a' },
          ] as const).map(item => (
            <button key={item.t} onClick={() => setDrawType(item.t)} style={{
              padding: '5px 14px', borderRadius: 8, border: `1.5px solid ${drawType === item.t ? item.color : 'rgba(0,0,0,0.12)'}`,
              background: drawType === item.t ? `${item.color}18` : 'transparent',
              color: drawType === item.t ? item.color : '#666',
              fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
              transition: 'all 0.15s',
            }}>{item.label}</button>
          ))}
          <span style={{ fontSize: 11, color: '#999', alignSelf: 'center', marginLeft: 6 }}>
            {drawType === 'question' ? 'Soru bölgesini çizmek için sürükle' : 'Öncül/Bağlam metni için sürükle'}
          </span>
        </div>
      )}

      <div
        ref={containerRef}
        style={{
          position: 'relative', width: docWidth || 'auto', height: totalHeight || 'auto',
          cursor: (mode === 'SELECT_QUESTIONS' || mode === 'ADJUST_SOLUTIONS') ? 'crosshair' : 'default',
          touchAction: (mode === 'SELECT_QUESTIONS' || mode === 'ADJUST_SOLUTIONS') ? 'none' : 'pan-y',
        }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
      >
        {/* Per-page canvases */}
        {pdf && pages.map(p => (
          <div key={p.pageNum} style={{
            position: 'absolute', top: p.offsetY, left: 0, width: p.width, height: p.height,
            backgroundColor: '#fff', boxShadow: '0 1px 8px rgba(0,0,0,0.10)',
          }}>
            <PageCanvas pdf={pdf} pageNum={p.pageNum} />
          </div>
        ))}

        {/* Rubber-band selection */}
        {isDrawing && (
          <div style={{
            position: 'absolute',
            left: Math.min(startPos.x, currentPos.x), top: Math.min(startPos.y, currentPos.y),
            width: Math.abs(currentPos.x - startPos.x), height: Math.abs(currentPos.y - startPos.y),
            border: `2px dashed ${mode === 'ADJUST_SOLUTIONS' ? '#ff453a' : drawType === 'stem' ? '#ff9f0a' : '#007aff'}`,
            backgroundColor: mode === 'ADJUST_SOLUTIONS' ? 'rgba(255,69,58,0.08)' : drawType === 'stem' ? 'rgba(255,159,10,0.08)' : 'rgba(0,122,255,0.08)',
            pointerEvents: 'none', zIndex: 20,
          }} />
        )}

        {/* Region overlays */}
        {regions.map(region => {
          if (mode === 'SOLVE' && region.type === 'solution' && !showOriginal) {
            return <div key={region.id} style={{ position: 'absolute', left: 0, top: region.y, width: '100%', height: region.h, backgroundColor: '#fff', zIndex: 5, pointerEvents: 'none' }} />;
          }
          if (mode === 'SOLVE') return null;

          const isQ = region.type === 'question';
          const isStem = region.type === 'stem';
          const isSol = region.type === 'solution';
          const qIdx = isQ ? questionRegions.indexOf(region) : -1;
          const color = isQ ? '#34c759' : isStem ? '#ff9f0a' : '#ff453a';
          const bg = isQ ? 'rgba(52,199,89,0.10)' : isStem ? 'rgba(255,159,10,0.08)' : 'rgba(255,69,58,0.08)';
          const label = isQ ? `Soru ${qIdx + 1}` : isStem ? 'Öncül' : 'Çözüm ↕ sürükle';
          const isDraggable = mode === 'ADJUST_SOLUTIONS' && isSol;

          return (
            <div
              key={region.id}
              data-region="true"
              style={{
                position: 'absolute',
                left: isQ || isStem ? region.x : 0,
                top: region.y,
                width: isQ || isStem ? region.w : '100%',
                height: region.h,
                border: `2px solid ${color}`, backgroundColor: bg,
                zIndex: 15, borderRadius: 4, pointerEvents: 'all',
                cursor: isDraggable ? (activeDragId === region.id ? 'grabbing' : 'grab') : 'default',
              }}
              onPointerDown={isDraggable ? (e) => {
                if ((e.target as HTMLElement).dataset.resizeHandle) return;
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                dragRef.current = { id: region.id, lastY: e.clientY, lastX: e.clientX };
                setActiveDragId(region.id);

                const onMv = (ev: PointerEvent) => {
                  if (!dragRef.current || dragRef.current.id !== region.id) return;
                  const dy = ev.clientY - dragRef.current.lastY;
                  dragRef.current.lastY = ev.clientY;
                  onRegionsChange?.(regions.map(r =>
                    r.id !== region.id ? r : { ...r, y: Math.max(0, r.y + dy) }
                  ));
                };
                const onUp = () => {
                  dragRef.current = null;
                  setActiveDragId(null);
                  window.removeEventListener('pointermove', onMv);
                  window.removeEventListener('pointerup', onUp);
                };
                window.addEventListener('pointermove', onMv);
                window.addEventListener('pointerup', onUp);
              } : undefined}
            >
              <span style={{ position: 'absolute', top: 4, left: 8, fontSize: 11, fontWeight: 700, color, pointerEvents: 'none', userSelect: 'none' }}>
                {label}
              </span>
              <button
                onPointerDown={e => e.stopPropagation()}
                onClick={e => removeRegion(region.id, e)}
                style={{
                  position: 'absolute', top: -11, right: -11, width: 22, height: 22,
                  borderRadius: '50%', background: '#fff', border: `2px solid ${color}`,
                  color, fontWeight: 700, fontSize: 14, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  zIndex: 30, padding: 0, boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
                }}
              >×</button>

              {mode === 'ADJUST_SOLUTIONS' && isSol && (['top','bottom'] as const).map(edge => (
                <div key={edge} data-resize-handle="1" style={{
                  position: 'absolute', [edge === 'top' ? 'top' : 'bottom']: -6,
                  left: '50%', transform: 'translateX(-50%)', width: 56, height: 12,
                  backgroundColor: color, borderRadius: 6, cursor: 'ns-resize', zIndex: 25, opacity: 0.85,
                }} onPointerDown={e => {
                  e.stopPropagation();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  resizeRef.current = { id: region.id, edge, lastY: e.clientY };

                  const onMv = (ev: PointerEvent) => {
                    if (!resizeRef.current || resizeRef.current.id !== region.id) return;
                    const d = ev.clientY - resizeRef.current.lastY;
                    resizeRef.current.lastY = ev.clientY;
                    onRegionsChange?.(regions.map(r => {
                      if (r.id !== region.id) return r;
                      return edge === 'top'
                        ? { ...r, y: r.y + d, h: Math.max(r.h - d, 20) }
                        : { ...r, h: Math.max(r.h + d, 20) };
                    }));
                  };
                  const onUp = () => {
                    resizeRef.current = null;
                    window.removeEventListener('pointermove', onMv);
                    window.removeEventListener('pointerup', onUp);
                  };
                  window.addEventListener('pointermove', onMv);
                  window.addEventListener('pointerup', onUp);
                }} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};

