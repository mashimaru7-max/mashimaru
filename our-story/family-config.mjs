import { safeBase } from './nas-client.mjs?v=20261114-media1';

export const FAMILY_USERNAME='오니둥이';

export async function loadFamilyApi() {
  try {
    const response = await fetch(new URL('./family-config.json', import.meta.url), {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return '';
    const { apiBase } = await response.json();
    return typeof apiBase === 'string' && apiBase.trim() ? safeBase(apiBase) : '';
  } catch {
    return '';
  }
}
