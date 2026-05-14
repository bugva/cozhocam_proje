/**
 * Crops a region from the rendered PDF pages and returns a data URL (PNG).
 *
 * Regions use a coordinate system where y=0 is the top of the first page,
 * and pages are stacked vertically with PAGE_GAP between them.
 */
import * as pdfjsLib from 'pdfjs-dist';

export const SCALE = 2;
export const PAGE_GAP = 12;

export interface PageLayout {
  pageNum: number;
  width: number;
  height: number;
  offsetY: number;
}

/**
 * Build page layout info for a PDF document.
 */
export async function buildPageLayouts(pdf: pdfjsLib.PDFDocumentProxy): Promise<PageLayout[]> {
  const layouts: PageLayout[] = [];
  let cumY = 0;
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: SCALE });
    layouts.push({ pageNum: i, width: vp.width, height: vp.height, offsetY: cumY });
    cumY += vp.height + PAGE_GAP;
  }
  return layouts;
}

/**
 * Render a single PDF page to an offscreen canvas and return it.
 */
async function renderPageToCanvas(pdf: pdfjsLib.PDFDocumentProxy, pageNum: number): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(pageNum);
  const vp = page.getViewport({ scale: SCALE });
  
  let canvasWidth = Math.floor(vp.width);
  let canvasHeight = Math.floor(vp.height);
  
  const MAX_DIM = 4096;
  const MAX_AREA = 16777216;
  let scaleDown = 1;
  
  if (canvasWidth > MAX_DIM || canvasHeight > MAX_DIM || (canvasWidth * canvasHeight) > MAX_AREA) {
    const ratioX = MAX_DIM / canvasWidth;
    const ratioY = MAX_DIM / canvasHeight;
    const ratioArea = Math.sqrt(MAX_AREA / (canvasWidth * canvasHeight));
    scaleDown = Math.min(ratioX, ratioY, ratioArea, 1);
    canvasWidth = Math.floor(canvasWidth * scaleDown);
    canvasHeight = Math.floor(canvasHeight * scaleDown);
  }

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d')!;
  
  const scaleX = canvasWidth / vp.width;
  const scaleY = canvasHeight / vp.height;
  const transform = (scaleX !== 1 || scaleY !== 1) ? [scaleX, 0, 0, scaleY, 0, 0] : undefined;

  await page.render({ canvasContext: ctx, viewport: vp, transform } as any).promise;
  
  // Return original dimensions for mapping, but we actually scaled the internal image
  // So we return the canvas and the scaleDown factor
  (canvas as any)._scaleDown = scaleDown; 
  return canvas;
}

export interface CropRegion {
  x: number;
  y: number; // document-level y
  w: number;
  h: number;
}

/**
 * Crop a rectangular region from the stacked PDF pages and return a data URL.
 * The region may span multiple pages — the result stitches them together.
 */
export async function cropRegionFromPdf(
  pdf: pdfjsLib.PDFDocumentProxy,
  pages: PageLayout[],
  region: CropRegion,
): Promise<string> {
  // Figure out which pages this region overlaps
  const regTop = region.y;
  const regBottom = region.y + region.h;

  const overlapping = pages.filter((p) => {
    const pTop = p.offsetY;
    const pBottom = p.offsetY + p.height;
    return pBottom > regTop && pTop < regBottom;
  });

  if (overlapping.length === 0) {
    // Fallback: return a blank white image
    const c = document.createElement('canvas');
    c.width = Math.max(region.w, 10);
    c.height = Math.max(region.h, 10);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }

  // Use actual page width for the crop, clamped to the region
  const firstPage = overlapping[0];
  const cropWidth = Math.min(region.w, firstPage.width);
  const cropHeight = region.h;

  const result = document.createElement('canvas');
  result.width = Math.floor(cropWidth);
  result.height = Math.floor(cropHeight);
  const rCtx = result.getContext('2d')!;
  rCtx.fillStyle = '#fff';
  rCtx.fillRect(0, 0, result.width, result.height);

  for (const page of overlapping) {
    const pageCanvas = await renderPageToCanvas(pdf, page.pageNum);
    const scaleDown = (pageCanvas as any)._scaleDown || 1;

    // Source rect on the page canvas (must account for scaleDown!)
    const srcTop = Math.max((regTop - page.offsetY) * scaleDown, 0);
    const srcBottom = Math.min((regBottom - page.offsetY) * scaleDown, page.height * scaleDown);
    const srcX = Math.max(region.x * scaleDown, 0);
    const srcW = Math.min(cropWidth * scaleDown, pageCanvas.width - srcX);
    const srcH = srcBottom - srcTop;

    // Dest position on the result canvas
    const destY = Math.max(page.offsetY - regTop, 0);

    // Ensure we map back to the unscaled result coordinates
    rCtx.drawImage(
      pageCanvas,
      srcX, srcTop, srcW, srcH,   // source
      0, destY, srcW / scaleDown, srcH / scaleDown, // dest
    );
  }

  return result.toDataURL('image/png');
}
