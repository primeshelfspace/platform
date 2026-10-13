import { NextResponse, type NextRequest } from 'next/server';
import { API_URL } from '@/lib/api';
import { readSessionToken } from '@/lib/session';

/**
 * The activity feed polls this from the browser every few seconds so a pull
 * in progress is visible without a manual reload. The session token lives in
 * an httpOnly cookie the browser cannot read, so the browser cannot call the
 * API directly — this proxies the one read it needs, attaching the token
 * server-side, the same pattern as the OAuth connect redirect.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const brandId = request.nextUrl.searchParams.get('brandId');
  if (!brandId) {
    return NextResponse.json({ message: 'missing brandId' }, { status: 400 });
  }

  const token = await readSessionToken();
  if (!token) return NextResponse.json({ message: 'not signed in' }, { status: 401 });

  // page/pageSize pass straight through; the API validates them.
  const paging = new URLSearchParams();
  for (const key of ['page', 'pageSize']) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) paging.set(key, value);
  }
  const query = paging.toString() ? `?${paging.toString()}` : '';
  const upstream = await fetch(`${API_URL}/brands/${brandId}/integrations/zoho/activity${query}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const body = await upstream.text();
  return new NextResponse(body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
