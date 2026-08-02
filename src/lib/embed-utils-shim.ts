/**
 * Disk-caching replacement for `@astro-community/astro-embed-utils`, whose own
 * cache is an in-memory LRU. astro.config.mjs aliases the package here, so one
 * interception point covers every embed that uses it.
 *
 * Stores the raw response body, not the parsed result: LinkPreview's
 * `safeGetDOM` returns a parse5 document, which cannot be serialised. Replaying
 * it through a synthetic Response leaves each caller's own parsing untouched.
 */
import { cached } from './embed-cache';
// Relative path: astro.config.mjs aliases the bare specifier to this file, so
// importing it by name here would resolve back to this module and recurse.
import * as upstream from '../../node_modules/@astro-community/astro-embed-utils/index.ts';

interface StoredResponse {
  status: number;
  contentType: string;
  body: string;
}

export function makeSafeGetter<T>(
  handleResponse: (res: Response) => T | Promise<T>,
  options?: { cacheSize?: number },
) {
  return async function safeGet(url: string): Promise<T | undefined> {
    const stored = await cached<StoredResponse>('http', url, async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return null as any;
        const contentType = res.headers.get('content-type') ?? '';
        let body = await res.text();
        if (contentType.includes('html')) {
          const headEnd = body.toLowerCase().indexOf('</head>');
          if (headEnd !== -1) body = `${body.slice(0, headEnd + 7)}</html>`;
        }
        return { status: res.status, contentType, body };
      } catch {
        return null as any;
      }
    });

    if (!stored) return undefined;

    try {
      return await handleResponse(
        new Response(stored.body, {
          status: stored.status,
          headers: { 'content-type': stored.contentType },
        }),
      );
    } catch {
      return undefined;
    }
  };
}

export const safeGet = makeSafeGetter<Record<string, any>>((res) => res.json());

export const { formatError } = upstream as any;
