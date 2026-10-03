import { ApiError } from './api.mjs';
import { answerRequest } from './answers.mjs';
import { checkedQueryAttachments, encodeQueryAttachments } from './query-attachments.mjs';

const fields = ['transcript', 'transcript_sha256', 'source_sha256', 'decoder_revision', 'model_revision', 'compiler_revision', 'duration_ms', 'policy_revision'];
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const revision = value => typeof value === 'string' && value.trim().length > 0 && [...value].length <= 200
  && !/[\u0000-\u001f\u007f-\u009f\p{Cs}]/u.test(value);
const idle = () => ({ phase: 'idle', filename: '', bytes: 0, transcript: '', error: null });
const invalid = () => new ApiError(502, '语音转录结果与所选原文件不一致，请重新核对。');
const unavailable = () => new ApiError(503, '当前服务或证据模式未启用语音提问，请稍后重试。');
const utf8 = new TextEncoder();

export function voiceQuestionsEnabled(config) {
  return Array.isArray(config?.capabilities) && config.capabilities.includes('voice_questions');
}

async function sha(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sourceSha(encoded) {
  // Hash the exact already-encoded request bytes, without a second read of the selected File.
  const decoded = atob(encoded);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index);
  return sha(bytes);
}

async function checked(value, originalSha) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== fields.length || !fields.every(field => Object.hasOwn(value, field))
    || value.policy_revision !== 'java-voice-question-v1' || value.source_sha256 !== originalSha
    || !hash(value.source_sha256) || !hash(value.transcript_sha256)
    || !['decoder_revision', 'model_revision', 'compiler_revision'].every(field => revision(value[field]))
    || !Number.isSafeInteger(value.duration_ms) || value.duration_ms < 1 || value.duration_ms > 600000
    || typeof value.transcript !== 'string' || !value.transcript.trim()
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\p{Cs}]/u.test(value.transcript)) throw invalid();
  const bytes = utf8.encode(value.transcript);
  if (bytes.length > 65536 || await sha(bytes) !== value.transcript_sha256) throw invalid();
  return value.transcript;
}

/** A voice input is only a draft question: confirmation neither asks nor stores library evidence. */
export class VoiceQuestionSession {
  #request;
  #canUseVoice;
  #onChange;
  #onAuthenticationFailure;
  #file = null;
  #serial = 0;
  #controller = null;
  #value = Object.freeze(idle());

  constructor({ request, canUseVoice = () => false, onChange = () => {}, onAuthenticationFailure = () => {} }) {
    this.#request = request; this.#canUseVoice = canUseVoice;
    this.#onChange = onChange; this.#onAuthenticationFailure = onAuthenticationFailure;
  }

  get value() { return this.#value; }

  #emit(value) { this.#value = Object.freeze(value); this.#onChange(this.#value); }

  reset() {
    this.#serial++; this.#controller?.abort(); this.#controller = null; this.#file = null;
    this.#emit(idle());
  }

  cancel() { this.reset(); }

  select(file) {
    this.reset();
    try {
      if (!this.#canUseVoice()) throw unavailable();
      const selection = checkedQueryAttachments([{ file, kind: 'audio' }]);
      this.#file = selection[0].file;
      this.#emit({ ...idle(), phase: 'selected', filename: file.name, bytes: file.size });
      return this.value;
    } catch (error) { this.#emit({ ...idle(), phase: 'error', error }); throw error; }
  }

  async transcribe() {
    if (this.value.phase === 'loading') return this.value;
    const file = this.#file;
    const serial = ++this.#serial, controller = new AbortController();
    this.#controller?.abort(); this.#controller = controller;
    this.#emit({ ...this.value, phase: 'loading', transcript: '', error: null });
    const current = () => serial === this.#serial;
    try {
      if (!this.#canUseVoice()) throw unavailable();
      if (!file) throw new ApiError(422, '请先选择一个语音文件。');
      const [body] = await encodeQueryAttachments([{ file, kind: 'audio' }], controller.signal);
      if (!current()) return this.value;
      const originalSha = await sourceSha(body.content_base64);
      if (!current()) return this.value;
      if (!this.#canUseVoice()) throw unavailable();
      const response = await this.#request('/v1/voice-questions', { method: 'POST', body, signal: controller.signal });
      if (!current()) return this.value;
      const transcript = await checked(response, originalSha);
      if (!current()) return this.value;
      if (!this.#canUseVoice()) throw unavailable();
      this.#emit({ ...this.value, phase: 'ready', transcript, error: null });
    } catch (error) {
      if (!current()) return this.value;
      this.#emit({ ...this.value, phase: 'error', transcript: '', error });
      if (error?.status === 401) this.#onAuthenticationFailure(error);
    } finally { if (this.#controller === controller) this.#controller = null; }
    return this.value;
  }

  edit(text) {
    if (this.value.phase !== 'ready') return;
    if (typeof text !== 'string') throw new ApiError(422, '请填写要确认的问题文字。');
    this.#emit({ ...this.value, transcript: text, error: null });
  }

  confirm() {
    if (!this.#canUseVoice()) throw unavailable();
    if (this.value.phase !== 'ready') throw new ApiError(422, '请先完成语音转录并核对文字。');
    return answerRequest(this.value.transcript).question;
  }
}
