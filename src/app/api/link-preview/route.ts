import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { BlockedUrlError, fetchLinkPreview, parseFetchableUrl } from "@/lib/link-preview";

const CACHE_DAYS = 7;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!url || url.length > 2048) return NextResponse.json({ error: "invalid url" }, { status: 400 });
  try {
    parseFetchableUrl(url);
  } catch {
    return NextResponse.json({ url, ok: false, blocked: true });
  }

  const url_hash = createHash("sha256").update(url).digest("hex");
  const admin = createAdminClient();
  const { data: cached } = await admin.from("link_previews").select("*").eq("url_hash", url_hash).maybeSingle();
  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_DAYS * 86400_000) {
    return NextResponse.json(cached);
  }

  let preview;
  try {
    preview = await fetchLinkPreview(url);
  } catch (e) {
    const blocked = e instanceof BlockedUrlError || (e as { cause?: { code?: string } })?.cause?.code === "EBLOCKED";
    preview = { url, title: null, description: null, image_url: null, site_name: null, ok: false };
    if (blocked) return NextResponse.json({ ...preview, blocked: true });
  }
  const row = { url_hash, ...preview, fetched_at: new Date().toISOString() };
  await admin.from("link_previews").upsert(row);
  return NextResponse.json(row);
}
