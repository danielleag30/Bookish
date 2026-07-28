/**
 * GitHub Models client — the same shape as the Ollama one, for CI.
 *
 * WHY A SECOND CLIENT
 * The pipeline runs on local Ollama because iterating costs nothing there. A
 * GitHub Actions runner has no local model, so an agent invoked from CI needs a
 * hosted one. GitHub Models is the exam-relevant choice and free at low volume,
 * and it authenticates with the workflow's own token — nothing extra to store.
 *
 * Everything here degrades rather than throws: if the token is missing or the
 * endpoint refuses, callers fall back to deterministic behaviour instead of
 * failing the workflow. An agent that cannot reach a model should still produce
 * something a human can review.
 */

const ENDPOINT = 'https://models.github.ai/inference/chat/completions';
export const DEFAULT_CI_MODEL = 'openai/gpt-4o-mini';

export interface CiCallResult {
  text: string;
  ms: number;
}

export class ModelUnavailable extends Error {}

/** True when a token is present. Does not prove the endpoint will answer. */
export function tokenAvailable(): boolean {
  return Boolean(process.env['GITHUB_TOKEN'] ?? process.env['MODELS_TOKEN']);
}

export async function callCiModel(
  prompt: string,
  opts: { model?: string; timeoutMs?: number; maxTokens?: number } = {},
): Promise<CiCallResult> {
  const token = process.env['GITHUB_TOKEN'] ?? process.env['MODELS_TOKEN'];
  if (!token) throw new ModelUnavailable('no GITHUB_TOKEN — set `models: read` on the job');

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
      body: JSON.stringify({
        model: opts.model ?? DEFAULT_CI_MODEL,
        temperature: 0,
        max_tokens: opts.maxTokens ?? 900,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } catch (err) {
    throw new ModelUnavailable(
      `could not reach GitHub Models: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!res.ok) {
    throw new ModelUnavailable(
      `GitHub Models returned HTTP ${res.status}. Rate limits and model access are ` +
      `per-account; the workflow falls back to a deterministic draft.`,
    );
  }

  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return { text: body.choices?.[0]?.message?.content ?? '', ms: Date.now() - started };
}
