/**
 * Local Ollama client.
 *
 * Everything runs on the machine, so the pipeline costs nothing and can be
 * iterated on freely — which matters, because tuning prompts against an eval set
 * means hundreds of calls. Models tagged `:cloud` in `ollama list` run on
 * Ollama's servers and are deliberately not used here.
 *
 * Ollama's `format` parameter takes a JSON Schema and constrains decoding to it,
 * so a malformed response is not a failure mode we have to handle. What we do
 * have to handle is a response that is well-formed and wrong.
 */

export const DEFAULT_MODEL = 'gemma4:latest';
const ENDPOINT = 'http://localhost:11434/api/chat';

export interface CallOptions {
  model?: string;
  /**
   * Let a reasoning model emit its thinking. Off by default.
   *
   * Reasoning models are a poor fit for schema-constrained extraction: the
   * thinking tokens are discarded, but you wait for them. qwen3:8b took 204s on
   * an extraction call with reasoning on and 34s with it off — and answered
   * *better* without it, finding both of Violet's dragon bonds where the
   * reasoning run missed them entirely. Models without a thinking mode ignore
   * this field.
   */
  think?: boolean;
  /** JSON Schema constraining the response. */
  format?: unknown;
  temperature?: number;
  /** Abort after this many milliseconds. */
  timeoutMs?: number;
  /** Base64 images for a vision-capable model. gemma4 accepts these. */
  images?: string[];
}

export interface CallResult<T> {
  value: T;
  /** Raw response text, kept for the trace. */
  raw: string;
  ms: number;
  promptTokens: number;
  responseTokens: number;
}

export class OllamaError extends Error {}

/** One constrained chat call. Throws OllamaError on transport or parse failure. */
export async function call<T>(
  prompt: string,
  opts: CallOptions = {},
): Promise<CallResult<T>> {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 300_000);

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: opts.model ?? DEFAULT_MODEL,
        stream: false,
        options: { temperature: opts.temperature ?? 0 },
        think: opts.think ?? false,
        ...(opts.format ? { format: opts.format } : {}),
        messages: [{
          role: 'user',
          content: prompt,
          ...(opts.images?.length ? { images: opts.images } : {}),
        }],
      }),
    });
  } catch (err) {
    throw new OllamaError(
      `could not reach Ollama at ${ENDPOINT} — is \`ollama serve\` running? ` +
      `(${err instanceof Error ? err.message : String(err)})`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new OllamaError(`Ollama returned HTTP ${res.status}`);

  const body = (await res.json()) as {
    message?: { content?: string };
    error?: string;
    prompt_eval_count?: number;
    eval_count?: number;
  };
  if (body.error) throw new OllamaError(body.error);

  const raw = body.message?.content ?? '';
  let value: T;
  try {
    value = JSON.parse(raw) as T;
  } catch {
    throw new OllamaError(`response was not JSON: ${raw.slice(0, 200)}`);
  }

  return {
    value,
    raw,
    ms: Date.now() - started,
    promptTokens: body.prompt_eval_count ?? 0,
    responseTokens: body.eval_count ?? 0,
  };
}

/** True when a local Ollama is reachable — used to skip rather than fail. */
export async function available(): Promise<boolean> {
  try {
    const res = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(2500),
    });
    return res.ok;
  } catch {
    return false;
  }
}
