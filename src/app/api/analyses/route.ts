import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * POST /api/analyses — store one analysis result.
 * Body: { text, label, score, source?, channel?, tokens? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const text = String(body.text ?? "").trim();
    const label = String(body.label ?? "NEUTRAL").toUpperCase();
    const score = Number(body.score ?? 0);
    const source = String(body.source ?? "manual");
    const channel = body.channel ? String(body.channel) : null;
    const tokens = Number(body.tokens ?? text.split(/\s+/).filter(Boolean).length);

    if (!text) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }
    if (!["POSITIVE", "NEGATIVE", "NEUTRAL"].includes(label)) {
      return NextResponse.json({ error: "invalid label" }, { status: 400 });
    }

    const created = await db.analysis.create({
      data: { text, label, score, source, channel, tokens },
    });

    // Update the daily stat counter
    const today = new Date().toISOString().slice(0, 10);
    await db.dailyStat.upsert({
      where: { date: today },
      update: {
        [label.toLowerCase()]: { increment: 1 },
        total: { increment: 1 },
      },
      create: {
        date: today,
        positive: label === "POSITIVE" ? 1 : 0,
        negative: label === "NEGATIVE" ? 1 : 0,
        neutral: label === "NEUTRAL" ? 1 : 0,
        total: 1,
      },
    });

    return NextResponse.json({ id: created.id, createdAt: created.createdAt });
  } catch (err) {
    console.error("[POST /api/analyses]", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

/**
 * GET /api/analyses — list with filters.
 * Query params: ?source=manual&label=POSITIVE&channel=ecommerce&q=hello&limit=50&cursor=<id>
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const source = searchParams.get("source");
    const label = searchParams.get("label");
    const channel = searchParams.get("channel");
    const q = searchParams.get("q");
    const limit = Math.min(200, Number(searchParams.get("limit") ?? 50));
    const cursor = searchParams.get("cursor");

    const where: Record<string, unknown> = {};
    if (source) where.source = source;
    if (label) where.label = label.toUpperCase();
    if (channel) where.channel = channel;
    if (q) where.text = { contains: q };

    const items = await db.analysis.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = items.length > limit;
    const data = hasMore ? items.slice(0, limit) : items;

    return NextResponse.json({
      items: data,
      nextCursor: hasMore ? data[data.length - 1].id : null,
    });
  } catch (err) {
    console.error("[GET /api/analyses]", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

/**
 * DELETE /api/analyses — clear all (used by the "reset" button on the history page).
 */
export async function DELETE() {
  try {
    await db.analysis.deleteMany({});
    await db.dailyStat.deleteMany({});
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/analyses]", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
