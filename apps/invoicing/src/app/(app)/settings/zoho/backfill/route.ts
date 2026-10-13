import { NextResponse, type NextRequest } from 'next/server';
import { API_URL } from '@/lib/api';
import { readSessionToken } from '@/lib/session';

/** Client-callable proxy for the backfill action — same reason as
 * activity/route.ts: the session token is server-only. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const brandId = request.nextUrl.searchParams.get('brandId');
  if (!brandId) return NextResponse.json({ message: 'missing brandId' }, { status: 400 });

  const token = await readSessionToken();
  if (!token) return NextResponse.json({ message: 'not signed in' }, { status: 401 });

  const upstream = await fetch(`${API_URL}/brands/${brandId}/integrations/zoho/backfill`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await upstream.text();
  return new NextResponse(body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
