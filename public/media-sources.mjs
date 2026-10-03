import { ApiError } from './api.mjs';

export const mediaModes = ['audio', 'sound', 'video-visual', 'video-transcript', 'video-joint', 'video-ocr', 'video-subtitle', 'video-av-visual', 'video-av-audio', 'video-av-joint'];
const invalid = () => new ApiError(502, '服务器返回的媒体来源身份或时间格式无效。');
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const text = value => typeof value === 'string' && value.length > 0;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const fields = (value, names) => Object.fromEntries(names.map(name => [name, value[name]]));
const common = ['number', 'kind', 'document_id', 'revision_id', 'source_sha256', 'parser_revision', 'filename', 'media_type', 'start_ms', 'end_ms', 'time_precision', 'source_url', 'content_url'];
const audioTypes = ['audio/wav', 'audio/mpeg', 'audio/flac', 'audio/ogg', 'audio/mp4', 'audio/webm'];
const videoTypes = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'];
function transcript(value) {
  if (!value || !integer(value.start_ms) || !integer(value.end_ms) || value.end_ms <= value.start_ms
    || !text(value.quote) || !hash(value.quote_sha256) || value.text_origin !== 'machine_asr' || value.time_precision !== 'server_chunk') throw invalid();
  return Object.freeze(fields(value, ['start_ms', 'end_ms', 'quote', 'quote_sha256', 'text_origin', 'time_precision']));
}
function frame(value, url) {
  if (!value || !integer(value.frame_us) || value.frame_ms !== value.frame_us / 1000
    || !integer(value.duration_us) || value.duration_us < 1 || !hash(value.frame_sha256)
    || !integer(value.width) || !integer(value.height) || value.width < 1 || value.height < 1
    || value.width * value.height > 12_000_000 || !['image/png', 'image/jpeg'].includes(value.media_type)
    || value.origin !== 'decoded_original' || value.content_url !== `${url}/frame`) throw invalid();
  return Object.freeze(fields(value, ['frame_us', 'frame_ms', 'duration_us', 'frame_sha256', 'width', 'height', 'media_type', 'origin', 'content_url']));
}
function ocr(value, picture) {
  if (!value || !integer(value.start_code_point) || !integer(value.end_code_point) || value.end_code_point <= value.start_code_point
    || !text(value.quote) || [...value.quote].length !== value.end_code_point - value.start_code_point || !hash(value.quote_sha256)
    || !text(value.ocr_revision) || !Array.isArray(value.regions) || !value.regions.length) throw invalid();
  let previousEnd = -1;
  const regions = value.regions.map(region => {
    if (['start', 'end', 'left', 'top', 'right', 'bottom'].some(key => !integer(region[key]))
      || region.start < previousEnd || region.end <= region.start || region.start >= value.end_code_point || region.end <= value.start_code_point
      || region.right <= region.left || region.bottom <= region.top || region.right > picture.width || region.bottom > picture.height) throw invalid();
    previousEnd = region.end;
    return Object.freeze(fields(region, ['start', 'end', 'left', 'top', 'right', 'bottom']));
  });
  return Object.freeze({ ...fields(value, ['start_code_point', 'end_code_point', 'quote', 'quote_sha256', 'ocr_revision']), regions: Object.freeze(regions) });
}
function subtitle(value) {
  if (!value || !id(value.cue_id) || !id(value.track_id) || !integer(value.stream_index) || !integer(value.cue_ordinal)
    || !text(value.codec) || (value.language !== null && typeof value.language !== 'string') || !Number.isSafeInteger(value.pts)
    || !integer(value.duration) || value.duration < 1 || !integer(value.time_base_numerator) || value.time_base_numerator < 1
    || !integer(value.time_base_denominator) || value.time_base_denominator < 1
    || !integer(value.start_code_point) || !integer(value.end_code_point) || value.end_code_point <= value.start_code_point
    || !text(value.quote) || [...value.quote].length !== value.end_code_point - value.start_code_point
    || ['quote_sha256', 'payload_sha256', 'subtitle_manifest_sha256', 'native_manifest_sha256', 'track_text_sha256'].some(key => !hash(value[key]))
    || !text(value.decoder_revision) || !text(value.text_format)) throw invalid();
  return Object.freeze(fields(value, ['cue_id', 'track_id', 'stream_index', 'codec', 'language', 'cue_ordinal', 'pts', 'duration', 'time_base_numerator', 'time_base_denominator', 'start_code_point', 'end_code_point', 'quote', 'quote_sha256', 'payload_sha256', 'subtitle_manifest_sha256', 'native_manifest_sha256', 'track_text_sha256', 'decoder_revision', 'text_format']));
}

export function checkedMediaCitation(value, answerId, ordinal, mode) {
  const audio = mode === 'audio';
  const url = `/v1/${audio ? 'audio' : 'video'}-sources/${answerId}/${ordinal}`;
  if (!value || value.number !== ordinal || !id(value.document_id) || !id(value.revision_id)
    || !hash(value.source_sha256) || !text(value.parser_revision) || !text(value.filename)
    || !(audio ? audioTypes : videoTypes).includes(value.media_type)
    || !Number.isFinite(value.start_ms) || !Number.isFinite(value.end_ms) || value.start_ms < 0 || value.end_ms <= value.start_ms
    || value.source_url !== url || value.content_url !== `${url}/content`
    || ['page', 'start', 'end'].some(key => key in value)) throw invalid();
  if (audio) {
    if (value.kind !== 'audio_span') throw invalid();
    return Object.freeze({ ...fields(value, common), ...transcript(value) });
  }
  const kinds = { 'video-visual': ['video_frame'], 'video-transcript': ['video_transcript'], 'video-joint': ['video_frame', 'video_transcript'], 'video-ocr': ['video_frame_ocr'], 'video-subtitle': ['video_subtitle'] };
  if (!kinds[mode]?.includes(value.kind) || !integer(value.start_us) || !integer(value.end_us)
    || value.end_us <= value.start_us || value.start_ms !== value.start_us / 1000 || value.end_ms !== value.end_us / 1000) throw invalid();
  const isOcr = value.kind === 'video_frame_ocr', isSubtitle = value.kind === 'video_subtitle';
  const origin = { video_frame: 'machine_vlm', video_transcript: 'machine_asr', video_frame_ocr: 'machine_ocr', video_subtitle: 'embedded_subtitle' }[value.kind];
  if (value.proof_origin !== origin || value.time_precision !== (isOcr ? 'frame_interval' : isSubtitle ? 'subtitle_cue' : 'group_interval')
    || ((isOcr || isSubtitle) ? value.group_id !== null : !id(value.group_id))) throw invalid();
  const picture = ['video_frame', 'video_frame_ocr'].includes(value.kind) ? frame(value.frame, url) : null;
  if (!picture && value.frame != null) throw invalid();
  const speech = value.kind === 'video_transcript' ? transcript(value.transcript) : null;
  if (!speech && value.transcript != null) throw invalid();
  if (!isOcr && value.ocr != null || !isSubtitle && value.subtitle != null) throw invalid();
  return Object.freeze({ ...fields(value, common), ...fields(value, ['proof_origin', 'group_id', 'start_us', 'end_us']),
    frame: picture, transcript: speech, ocr: isOcr ? ocr(value.ocr, picture) : null, subtitle: isSubtitle ? subtitle(value.subtitle) : null });
}

export function mediaQuote(source) { return source?.kind === 'video_av_window' ? source.facts.map(fact => fact.text).join('\n') : source?.kind === 'sound_span' ? source.facts.join('\n') : source?.quote ?? source?.transcript?.quote ?? source?.ocr?.quote ?? source?.subtitle?.quote ?? ''; }
export function timeLabel(milliseconds) {
  const seconds = milliseconds / 1000;
  const minutes = Math.floor(seconds / 60);
  const precision = Number.isInteger(milliseconds) ? 3 : 6;
  return `${minutes}:${(seconds - minutes * 60).toFixed(precision).padStart(precision + 3, '0')}`;
}
