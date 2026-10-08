const idle = () => ({ phase: 'idle', page: null, pages: null, error: null });
const engineUrl = '/vendor/pdfjs/pdf.min.mjs';
const workerUrl = '/vendor/pdfjs/pdf.worker.min.mjs';
const maxPixels = 4_000_000;
const maxDimension = 4096;

async function loadPdfEngine() {
  const engine = await import(engineUrl);
  engine.GlobalWorkerOptions.workerSrc = workerUrl;
  return engine;
}

/** Renders one server-selected page from original bytes already verified by AnswerSession. */
export class PdfPreviewSession {
  #loadEngine; #onChange; #sequence = 0; #loading = null; #render = null; #canvas = null;
  value = idle();

  constructor({ loadEngine = loadPdfEngine, onChange = () => {} } = {}) {
    this.#loadEngine = loadEngine; this.#onChange = onChange;
  }

  #publish(value) { this.value = value; this.#onChange(value); }

  close() {
    this.#sequence += 1;
    this.#render?.cancel(); this.#render = null;
    if (this.#loading) Promise.resolve(this.#loading.destroy()).catch(() => {});
    this.#loading = null;
    if (this.#canvas) { this.#canvas.width = 0; this.#canvas.height = 0; }
    this.#canvas = null; this.#publish(idle());
  }

  async open({ blob, page, canvas, width = 720, pixelRatio = 1 }) {
    this.close();
    const sequence = this.#sequence;
    const current = () => sequence === this.#sequence;
    this.#publish({ phase: 'loading', page, pages: null, error: null });
    let pageProxy;
    try {
      if (!(blob instanceof Blob) || blob.type !== 'application/pdf' || blob.size < 1 || blob.size > 20 * 1024 * 1024
        || !Number.isSafeInteger(page) || page < 1
        || !canvas || typeof canvas.getContext !== 'function') throw new Error('invalid_page');
      this.#canvas = canvas;
      const data = new Uint8Array(await blob.arrayBuffer());
      if (!current()) return this.value;
      const engine = await this.#loadEngine();
      if (!current()) return this.value;
      const loading = engine.getDocument({ data, isEvalSupported: false, useWasm: false,
        disableAutoFetch: true, disableRange: true, disableStream: true,
        cMapUrl: '/vendor/pdfjs/cmaps/', cMapPacked: true,
        standardFontDataUrl: '/vendor/pdfjs/standard_fonts/' });
      this.#loading = loading;
      const document = await loading.promise;
      if (!current()) return this.value;
      if (!Number.isSafeInteger(document.numPages) || page > document.numPages) throw new Error('invalid_page');
      pageProxy = await document.getPage(page);
      if (!current()) return this.value;
      const natural = pageProxy.getViewport({ scale: 1 });
      if (![natural.width, natural.height].every(size => Number.isFinite(size) && size > 0)) throw new Error('invalid_page');
      const displayWidth = Math.min(1100, Math.max(240, Number.isFinite(width) ? width : 720));
      const density = Math.min(2, Math.max(1, Number.isFinite(pixelRatio) ? pixelRatio : 1));
      const scale = Math.min(displayWidth / natural.width * density,
        maxDimension / natural.width, maxDimension / natural.height,
        Math.sqrt(maxPixels / natural.width / natural.height));
      const viewport = pageProxy.getViewport({ scale });
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('render_failed');
      const render = pageProxy.render({ canvasContext: context, viewport });
      this.#render = render;
      await render.promise;
      if (current()) {
        this.#render = null;
        this.#publish({ phase: 'ready', page, pages: document.numPages, error: null });
      }
    } catch (error) {
      if (current()) {
        if (canvas) { canvas.width = 0; canvas.height = 0; }
        const reason = error?.message === 'invalid_page' ? '服务器引用页码无效，未显示其他页。' : '原 PDF 页面未能显示，请使用下方链接打开或下载原文件。';
        this.#publish({ phase: 'error', page, pages: null, error: reason });
      }
    } finally {
      pageProxy?.cleanup();
      if (current() && this.#loading) {
        const loading = this.#loading; this.#loading = null;
        await Promise.resolve(loading.destroy()).catch(() => {});
      }
    }
    return this.value;
  }
}
