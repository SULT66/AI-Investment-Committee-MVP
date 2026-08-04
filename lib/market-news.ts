export type NewsItem = {
  headline: string;
  summary: string;
  source: string;
  datetime: string;
  url: string;
};

/**
 * Recent company news from Finnhub, used to ground the committee debate in
 * what is actually happening with the stock rather than generic templates.
 * Returns an empty array on any failure — news is helpful, not essential.
 */
export async function getCompanyNews(symbolInput: string, days = 14): Promise<NewsItem[]> {
  const token = process.env.FINNHUB_API_KEY;
  if (!token) return [];

  const symbol = symbolInput.trim().toUpperCase();
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${fmt(from)}&to=${fmt(to)}`,
      { headers: { "X-Finnhub-Token": token }, next: { revalidate: 300 } }
    );
    if (!res.ok) return [];

    const raw = (await res.json()) as Array<{
      headline?: string;
      summary?: string;
      source?: string;
      datetime?: number;
      url?: string;
    }>;

    return (Array.isArray(raw) ? raw : [])
      .filter((n) => n.headline)
      .slice(0, 8)
      .map((n) => ({
        headline: String(n.headline).slice(0, 200),
        summary: String(n.summary ?? "").slice(0, 400),
        source: String(n.source ?? ""),
        datetime: n.datetime ? new Date(n.datetime * 1000).toISOString() : "",
        url: String(n.url ?? "")
      }));
  } catch {
    return [];
  }
}
