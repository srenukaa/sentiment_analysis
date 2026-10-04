import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/stats — aggregated stats for the analytics dashboard.
 * Returns: totals, last-7-days series, channel breakdown, recent sample.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const days = Math.min(30, Math.max(1, Number(searchParams.get("days") ?? 7)));

    const totalAgg = await db.analysis.aggregate({
      _count: true,
      _sum: { tokens: true },
    });

    // Group-by-label counts
    const byLabel = await db.analysis.groupBy({
      by: ["label"],
      _count: true,
    });

    // Group-by-source
    const bySource = await db.analysis.groupBy({
      by: ["source"],
      _count: true,
    });

    // Channel breakdown
    const byChannel = await db.analysis.groupBy({
      by: ["channel"],
      _count: true,
    });

    // Last N days series from DailyStat
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - (days - 1));
    const since = sinceDate.toISOString().slice(0, 10);
    const daily = await db.dailyStat.findMany({
      where: { date: { gte: since } },
      orderBy: { date: "asc" },
    });

    // Recent 5 for the dashboard preview
    const recent = await db.analysis.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    return NextResponse.json({
      total: totalAgg._count,
      tokens: totalAgg._sum.tokens ?? 0,
      byLabel: byLabel.map((r) => ({ label: r.label, count: r._count })),
      bySource: bySource.map((r) => ({ source: r.source, count: r._count })),
      byChannel: byChannel
        .filter((r) => r.channel !== null)
        .map((r) => ({ channel: r.channel, count: r._count })),
      daily,
      recent,
    });
  } catch (err) {
    console.error("[GET /api/stats]", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
