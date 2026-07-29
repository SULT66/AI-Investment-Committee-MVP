import Link from "next/link";

export default function HomePage() {
  return (
    <main className="landing">
      <nav className="nav">
        <div className="brand">AIC</div>
        <span>AI Investment Committee</span>
        <Link className="ghostButton" href="/committee">Open committee</Link>
      </nav>
      <section className="hero">
        <div>
          <p className="eyebrow">YOUR PERSONAL INVESTMENT COMMITTEE</p>
          <h1>A decision first.<br />A full debate when you need it.</h1>
          <p className="lede">Analyze a proposed stock purchase against the client’s goals, risk profile and current portfolio.</p>
          <Link className="primaryButton" href="/committee">Start a committee session</Link>
        </div>
        <div className="previewCard">
          <span className="liveDot">LIVE SESSION</span>
          <h2>NVDA proposal</h2>
          <div className="decision">BUY PARTIALLY</div>
          <div className="metric"><span>Confidence</span><strong>74%</strong></div>
          <div className="metric"><span>Suggested amount</span><strong>$2,000</strong></div>
          <p>Long-term potential remains attractive, but portfolio concentration requires a smaller staged entry.</p>
        </div>
      </section>
    </main>
  );
}
