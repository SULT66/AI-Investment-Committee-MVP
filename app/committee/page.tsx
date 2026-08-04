type SearchParams = Record<string, string | string[] | undefined>;

/** Whitelist — only the room's own parameters are forwarded into the frame. */
const FORWARDED = ["ticker", "amount", "portfolioValue", "sector", "risk", "horizon", "avatars"] as const;

export default async function CommitteePage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  // The room reads its proposal from its own query string, so the selection made
  // on the landing page has to be passed through to the frame.
  const forwarded = new URLSearchParams();
  for (const key of FORWARDED) {
    const value = params[key];
    const single = Array.isArray(value) ? value[0] : value;
    if (single) forwarded.set(key, single);
  }

  const query = forwarded.toString();
  const src = query ? `/committee-room-3d.html?${query}` : "/committee-room-3d.html";

  return (
    <main style={{ width: "100vw", height: "100vh", margin: 0, padding: 0, overflow: "hidden", background: "#02060d" }}>
      <iframe
        key={query}
        src={src}
        title="AIC 3D Committee Room"
        style={{ width: "100%", height: "100%", border: 0, display: "block" }}
        allow="autoplay; microphone"
      />
    </main>
  );
}
