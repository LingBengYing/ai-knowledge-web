/** Local file preview. Never fetches, uploads, or associates files with corpus evidence. */
const MiB = 1024 * 1024;
const formats = {
  png: ['image', 'image/png'], jpg: ['image', 'image/jpeg'], jpeg: ['image', 'image/jpeg'],
  gif: ['image', 'image/gif'], webp: ['image', 'image/webp'], bmp: ['image', 'image/bmp'],
  mp3: ['audio', 'audio/mpeg'], wav: ['audio', 'audio/wav'], m4a: ['audio', 'audio/mp4'],
  ogg: ['audio', 'audio/ogg'], mp4: ['video', 'video/mp4'], webm: ['video', 'video/webm'],
  mov: ['video', 'video/quicktime'], ogv: ['video', 'video/ogg'], pdf: ['pdf', 'application/pdf'],
  txt: ['text', 'text/plain'], md: ['text', 'text/plain'],
};
export async function inspectFile(file) {
  if (!(file instanceof Blob) || typeof file.name !== 'string') throw new Error('请选择一个本地文件。');
  if (!file.size) throw new Error('空文件没有可预览的内容。');
  const ext = file.name.split('.').at(-1).toLowerCase();
  const format = formats[ext];
  if (!format) throw new Error('暂不支持这种格式。支持PNG/JPG/GIF/WebP/BMP、MP3/WAV/M4A/OGG、MP4/WebM/MOV、PDF、TXT和Markdown。');
  const [kind, mime] = format;
  if (file.size > (kind === 'text' ? 2 : 100) * MiB) throw new Error(kind === 'text' ? '文本预览最多2 MiB。' : '单个文件预览最多100 MiB。');
  const declared = file.type.toLowerCase().split(';')[0];
  const compatible = new Set([mime, '', 'application/octet-stream', ...(ext === 'md' ? ['text/markdown', 'text/x-markdown'] : []), ...(ext === 'wav' ? ['audio/x-wav', 'audio/wave'] : []), ...(ext === 'm4a' ? ['audio/x-m4a'] : []), ...(ext === 'mp3' ? ['audio/mp3'] : []), ...(ext === 'bmp' ? ['image/x-ms-bmp'] : []), ...(ext === 'ogg' ? ['application/ogg'] : [])]);
  if (!compatible.has(declared)) throw new Error('文件类型与扩展名不一致，请选择原始文件。');
  if (kind === 'text') {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const encoding = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8';
    let text;
    try { text = new TextDecoder(encoding, { fatal: true }).decode(buffer); } catch { throw new Error('无法作为UTF-8或带BOM的UTF-16文本读取。'); }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text)) throw new Error('文件包含二进制内容，无法作为文本预览。');
    return { kind, mime, text, name: file.name, size: file.size };
  }
  const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const starts = values => values.every((value, index) => bytes[index] === value);
  const ascii = (offset, value) => [...value].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
  const valid = ext === 'png' ? starts([137,80,78,71,13,10,26,10])
    : ['jpg', 'jpeg'].includes(ext) ? starts([255,216,255])
    : ext === 'gif' ? ascii(0, 'GIF87a') || ascii(0, 'GIF89a')
    : ext === 'webp' ? ascii(0, 'RIFF') && ascii(8, 'WEBP')
    : ext === 'bmp' ? ascii(0, 'BM')
    : ext === 'pdf' ? ascii(0, '%PDF-')
    : ext === 'wav' ? ascii(0, 'RIFF') && ascii(8, 'WAVE')
    : ext === 'mp3' ? ascii(0, 'ID3') || (bytes[0] === 255 && (bytes[1] & 224) === 224)
    : ['m4a', 'mp4', 'mov'].includes(ext) ? ascii(4, 'ftyp')
    : ext === 'webm' ? starts([26,69,223,163])
    : ['ogg', 'ogv'].includes(ext) && ascii(0, 'OggS');
  if (!valid) throw new Error('文件内容与格式不符，或文件已损坏。请重新选择原文件。');
  return { kind, mime, name: file.name, size: file.size };
}

export class PreviewResource {
  constructor(urls = URL) { this.urls = urls; this.sequence = 0; this.current = null; }
  clear() {
    this.sequence += 1;
    if (this.current?.url) this.urls.revokeObjectURL(this.current.url);
    this.current = null;
  }
  async load(file) {
    this.clear();
    const sequence = this.sequence;
    let descriptor;
    try { descriptor = await inspectFile(file); } catch (error) { if (sequence !== this.sequence) return null; throw error; }
    if (sequence !== this.sequence) return null;
    this.current = { ...descriptor, ...(descriptor.kind === 'text' ? {} : { url: this.urls.createObjectURL(new Blob([file], { type: descriptor.mime })) }) };
    return this.current;
  }
}

export function mountPreview(doc = document) {
  const $ = id => doc.getElementById(id);
  const dialog = $('preview-dialog');
  const resource = new PreviewResource();
  let media = null;
  let image = null;
  let canvas = null;
  let zoom = 1;
  let rotation = 0;
  let attempt = 0;
  const make = (tag, text) => { const node = doc.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
  const release = () => {
    attempt += 1;
    if (media) { media.pause(); media.removeAttribute('src'); media.load(); }
    media = null; image = null; canvas = null;
    $('preview-stage').replaceChildren();
    $('preview-image-tools').hidden = true;
    $('preview-media-tools').hidden = true;
    $('preview-pdf-tools').hidden = true;
    $('preview-pdf-open').removeAttribute('href');
    resource.clear();
  };
  const message = (text, error = false) => {
    $('preview-message').textContent = text;
    $('preview-message').className = error ? 'notice error' : 'help-text';
    $('preview-stage').setAttribute('aria-busy', 'false');
  };
  const transform = () => {
    if (image && canvas && image.naturalWidth) {
      const stage = $('preview-stage');
      const fit = Math.min((stage.clientWidth - 40) / image.naturalWidth, (stage.clientHeight - 40) / image.naturalHeight, 1);
      const width = Math.max(1, image.naturalWidth * fit * zoom);
      const height = Math.max(1, image.naturalHeight * fit * zoom);
      image.style.width = `${width}px`; image.style.height = `${height}px`;
      image.style.transform = `rotate(${rotation}deg)`;
      canvas.style.width = `${(rotation % 180 ? height : width) + 40}px`;
      canvas.style.height = `${(rotation % 180 ? width : height) + 40}px`;
    }
    $('preview-zoom-value').textContent = `${Math.round(zoom * 100)}%`;
  };
  const open = () => {
    if (!dialog.open) dialog.showModal();
    if (!resource.current) {
      $('preview-title').textContent = '本地文件预览'; $('preview-info').textContent = '';
      message('选择或拖入图片、音频、视频、PDF或文本。单文件最多100 MiB，文本最多2 MiB。');
      const welcome = make('div', '选择本地文件，或将一个文件拖入此窗口。');
      welcome.className = 'preview-welcome'; $('preview-stage').replaceChildren(welcome);
    }
    $('preview-choose').focus();
  };
  const close = () => { release(); $('preview-input').value = ''; dialog.close(); };
  const load = async file => {
    if (!dialog.open) return;
    release();
    const current = attempt;
    $('preview-title').textContent = '本地文件预览';
    $('preview-info').textContent = '';
    message('正在读取本地文件…');
    $('preview-stage').setAttribute('aria-busy', 'true');
    try {
      const value = await resource.load(file);
      if (!value || current !== attempt) return;
      if (!dialog.open) { release(); return; }
      $('preview-title').textContent = value.name;
      $('preview-info').textContent = `${(value.size / MiB).toFixed(2)} MiB · ${value.mime}`;
      const stage = $('preview-stage');
      if (value.kind === 'text') {
        const text = make('pre', value.text); text.className = 'preview-text'; text.tabIndex = 0; stage.append(text);
        message('纯文本显示，不执行文档中的代码或标记。');
      } else if (value.kind === 'image') {
        image = make('img'); image.alt = value.name; image.className = 'preview-image';
        const thisImage = image;
        image.addEventListener('load', () => { if (current === attempt) { transform(); message(`${thisImage.naturalWidth} × ${thisImage.naturalHeight} 像素`); } });
        image.addEventListener('error', () => { if (current === attempt) message('浏览器无法解码这张图片，文件可能损坏。', true); });
        zoom = 1; rotation = 0;
        canvas = make('div'); canvas.className = 'preview-canvas'; canvas.append(image); stage.append(canvas);
        transform(); image.src = value.url;
        $('preview-image-tools').hidden = false;
      } else if (value.kind === 'audio' || value.kind === 'video') {
        media = make(value.kind); media.controls = true; media.preload = 'metadata'; media.setAttribute('aria-label', value.name);
        if (value.kind === 'video') media.playsInline = true;
        const thisMedia = media;
        media.addEventListener('loadedmetadata', () => { if (current === attempt) message(`时长 ${Number.isFinite(thisMedia.duration) ? thisMedia.duration.toFixed(1) + ' 秒' : '由播放器显示'} · 点击播放，支持进度拖动与音量控制。`); });
        media.addEventListener('error', () => { if (current === attempt && thisMedia.getAttribute('src')) message('当前浏览器不支持该编码，或文件已损坏。可尝试MP4（H.264/AAC）、WebM或WAV。', true); });
        media.src = value.url;
        if (value.kind === 'audio') stage.append(make('div', '音频预览'));
        stage.append(media); $('preview-rate').value = '1'; $('preview-media-tools').hidden = false;
      } else {
        // Only signature-checked application/pdf blobs reach the browser's native PDF renderer.
        const pdf = make('object'); pdf.type = 'application/pdf'; pdf.data = value.url;
        pdf.setAttribute('aria-label', `PDF预览：${value.name}`);
        pdf.append(make('p', '浏览器不支持内嵌PDF，请使用“在新窗口查看PDF”。'));
        stage.append(pdf); $('preview-pdf-tools').hidden = false;
        $('preview-pdf-open').href = value.url;
        message('使用浏览器内置PDF查看器翻页和缩放；若未显示，请在新窗口查看。');
      }
    } catch (error) { if (current === attempt) message(error.message, true); }
  };
  $('preview-local').addEventListener('click', open);
  doc.addEventListener('click', event => { if (event.target.closest('[data-open-local-preview]')) open(); });
  $('preview-close').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', release);
  doc.addEventListener('knowledge-context-reset', close);
  $('preview-choose').addEventListener('click', () => { $('preview-input').value = ''; $('preview-input').click(); });
  $('preview-input').addEventListener('change', () => { const file = $('preview-input').files[0]; if (file) load(file); });
  dialog.addEventListener('dragover', event => { event.preventDefault(); });
  dialog.addEventListener('drop', event => {
    event.preventDefault();
    if (event.dataTransfer.files.length !== 1) { message('请每次拖入一个文件。', true); return; }
    load(event.dataTransfer.files[0]);
  });
  $('preview-zoom-in').addEventListener('click', () => { zoom = Math.min(3, zoom + 0.25); transform(); });
  $('preview-zoom-out').addEventListener('click', () => { zoom = Math.max(0.25, zoom - 0.25); transform(); });
  $('preview-fit').addEventListener('click', () => { zoom = 1; rotation = 0; transform(); });
  $('preview-rotate').addEventListener('click', () => { rotation = (rotation + 90) % 360; transform(); });
  $('preview-rate').addEventListener('change', () => { if (media) media.playbackRate = Number($('preview-rate').value); });
  return { open, load, close };
}
if (typeof document !== 'undefined') mountPreview();
