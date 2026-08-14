import Link from "next/link";
import "../legal/legal.css";

export const metadata = {
  title: "Investment Risk & AI Disclosure — AI Investment Committee",
  description:
    "How AIC uses AI, where it can be wrong, and the risks of acting on AI-generated investment research."
};

export default function DisclosuresPage() {
  return (
    <main className="legal">
      <header className="legalHead">
        <p className="legalKicker"><Link href="/">AIC</Link> · Legal</p>
        <h1>Investment Risk &amp; AI Disclosure</h1>
        <p className="legalDates">Last updated August 14, 2026 · Effective August 14, 2026</p>
      </header>

      <p>
        AI Investment Committee (&ldquo;AIC&rdquo;) is an artificial-intelligence-powered investment
        research and decision-support platform. Investing involves risk. Please read this disclosure
        before using AIC research to support an investment decision.
      </p>

      <h2>1. AIC uses artificial intelligence</h2>
      <p>
        AIC uses AI-generated analytical agents to examine investment-related information from
        different perspectives, including fundamental, quantitative, macroeconomic, portfolio, risk
        and sector analysis, and market intelligence.
      </p>
      <p>
        Committee members are AI-generated analytical personas unless expressly identified otherwise.
        They are not human investment professionals.
      </p>

      <h2>2. AI can be wrong</h2>
      <p>
        Artificial intelligence may generate information that appears convincing but is incorrect.
        AIC output may contain:
      </p>
      <ul>
        <li>factual errors;</li>
        <li>calculation errors;</li>
        <li>outdated information;</li>
        <li>incomplete information;</li>
        <li>incorrect interpretations;</li>
        <li>missed risks;</li>
        <li>incorrect citations;</li>
        <li>contradictory conclusions.</li>
      </ul>
      <p>Important information should be independently verified.</p>

      <h2>3. Market information may be delayed or incorrect</h2>
      <p>
        AIC may use market prices, company fundamentals, regulatory filings, news, economic
        information and other third-party financial data. Third-party data may be delayed,
        incomplete, inaccurate or unavailable. Always verify current information before making an
        investment decision.
      </p>

      <h2>4. Committee conclusions are research assessments</h2>
      <p>
        AIC may classify research as favorable, neutral or unfavorable &mdash; or as bullish, neutral
        or bearish &mdash; and may display confidence, conviction, agent votes, risk ratings and
        scenario results. These measures describe the AI system&rsquo;s analysis. They do not
        represent statistical guarantees.
      </p>
      <p>
        <strong>
          For example: 90% confidence does not mean there is a 90% probability that an investment
          will make money.
        </strong>
      </p>

      <h2>5. No guaranteed return</h2>
      <p>
        AIC cannot guarantee profits, positive returns, preservation of capital, avoidance of losses,
        future market prices or successful market timing. Past performance does not guarantee future
        results.
      </p>

      <h2>6. You can lose money</h2>
      <p>
        All investing involves the possibility of loss. Certain investments may result in the loss of
        the entire amount invested. Risk can include market declines, volatility, concentration,
        illiquidity, interest rates, credit events, economic changes, regulatory changes, political
        and geopolitical events, technological failure, dilution, financing problems, company
        insolvency and bankruptcy.
      </p>

      <h2>7. Your financial circumstances matter</h2>
      <p>
        The suitability of any investment can depend on your financial resources, income, liquidity
        needs, debts, investment horizon, tax circumstances, risk tolerance, existing investments and
        personal financial objectives. AIC may not know all circumstances relevant to you.
      </p>

      <h2>8. Portfolio inputs</h2>
      <p>
        Where you provide portfolio information, AIC may use it to calculate exposure,
        diversification, concentration, scenarios, risk metrics and hypothetical limits. Any such
        calculation depends on the completeness and accuracy of your inputs. Do not interpret a
        calculated value as a guarantee that the position or portfolio is safe.
      </p>

      <h2>9. AIC does not execute trades</h2>
      <p>
        AIC does not hold your securities or cash, and does not execute, route or place trades
        through the standard research service. You remain responsible for all investment actions.
      </p>

      <h2>10. Independent decision</h2>
      <p>
        AIC is a research and analytical tool. Unless expressly offered through a separately
        regulated service, AIC is not acting as your personal investment adviser, broker, financial
        planner, attorney, tax professional or accountant. Investment decisions remain yours. Where
        appropriate, seek advice from a properly licensed professional who understands your
        individual circumstances.
      </p>

      <h2>11. High-risk securities</h2>
      <p>
        Extra caution may be appropriate when researching early-stage companies, micro-cap
        securities, highly volatile stocks, options, leveraged products, cryptocurrencies or digital
        assets, distressed securities and speculative technologies. Potential return generally comes
        with corresponding risk.
      </p>

      <h2>12. Final reminder</h2>
      <p>
        <strong>Research does not eliminate risk.</strong><br />
        <strong>AI confidence does not guarantee an outcome.</strong><br />
        <strong>Never invest money that you cannot afford to lose.</strong><br />
        <strong>Research carefully. Verify important facts. Make your own decision.</strong>
      </p>

      <footer className="legalFoot">
        <Link href="/">Home</Link>
        <Link href="/terms">Terms of Service</Link>
        <Link href="/privacy">Privacy Policy</Link>
      </footer>
    </main>
  );
}
