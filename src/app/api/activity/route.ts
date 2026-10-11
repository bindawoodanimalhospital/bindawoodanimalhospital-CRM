import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Receives navigator.sendBeacon() reports (e.g. "closed the CRM tab"), which the browser sends
 * even while the page is unloading. Same rules as the in-page logger: signed-in active staff only,
 * known kinds only, in-app paths only — all enforced by public.log_activity.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { kind?: string; path?: string; title?: string; context?: Record<string, unknown> };
    const supabase = await createClient();
    await supabase.rpc("log_activity", {
      p_kind: String(body.kind ?? ""), p_path: String(body.path ?? ""), p_title: body.title ? String(body.title) : undefined,
      p_context: body.context && typeof body.context === "object" ? body.context : undefined,
    });
  } catch { /* never fail the unload */ }
  return new NextResponse(null, { status: 204 });
}
