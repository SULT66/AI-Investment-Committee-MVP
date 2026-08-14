import Link from "next/link";
import "../legal/legal.css";

export const metadata = {
  title: "Terms of Service — AI Investment Committee",
  description: "Terms governing access to and use of the AIC research and decision-support platform."
};

export default function TermsPage() {
  return (
    <main className="legal">
      <header className="legalHead">
        <p className="legalKicker"><Link href="/">AIC</Link> · Legal</p>
        <h1>Terms of Service</h1>
        <p className="legalDates">Last updated August 14, 2026 · Effective August 14, 2026</p>
      </header>

      <div className="legalDraft">
        <h2>Before publishing</h2>
        <p>
          Complete every <span className="fill">[marked]</span> field, and have securities counsel
          confirm the three open questions: investment-adviser registration, governing law and the
          liability cap.
        </p>
        <p>
          <strong>Section 12 lists plans that cannot yet be purchased.</strong> Published prices are
          a representation to consumers. Remove or mark that section until checkout exists.
        </p>
      </div>

      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of AI Investment
        Committee (&ldquo;AIC&rdquo;). By using AIC, you agree to these Terms.
      </p>

      <h2>1. Operator</h2>
      <p>
        AIC is operated by <span className="fill">[LEGAL ENTITY NAME]</span>,{" "}
        <span className="fill">[REGISTERED ADDRESS]</span>, <span className="fill">[JURISDICTION]</span>.
        Contact: <span className="fill">[LEGAL/PRIVACY EMAIL]</span>.
      </p>

      <h2>2. About AIC</h2>
      <p>
        AIC is an artificial-intelligence-powered investment research and decision-support platform.
        It uses multiple AI analytical agents that may evaluate investments from different
        perspectives, including equity and fundamental analysis, quantitative analysis,
        macroeconomic analysis, portfolio analysis, risk analysis, industry and sector analysis,
        market intelligence and scenario analysis. AIC may combine these analyses into a committee
        research report.
      </p>

      <h2>3. Research and decision support</h2>
      <p>
        AIC is intended to provide research information and analytical tools. Unless AIC expressly
        states otherwise in connection with a separately regulated service, AIC does not establish an
        investment-advisory relationship with you and is not acting as your investment adviser,
        broker-dealer, financial planner, portfolio manager, custodian, attorney, accountant or tax
        adviser.
      </p>
      <p>
        AIC does not hold, custody or control your assets, and does not place, route or execute
        securities transactions.
      </p>

      <h2>4. Investment decisions are yours</h2>
      <p>
        You remain responsible for your investment decisions. AIC research should be considered
        together with your own independent research, your financial circumstances, your investment
        objectives, your ability to tolerate loss, and professional advice where appropriate. No AIC
        analysis guarantees that any investment will increase in value or achieve a particular
        return.
      </p>

      <h2>5. Committee assessments</h2>
      <p>
        AIC may display research conclusions such as favorable, neutral, unfavorable, bullish,
        bearish, supported, not supported or insufficient evidence, and may display a confidence or
        conviction score. These outputs reflect an AI-generated research assessment and do not
        represent a guarantee regarding the probability of investment success. For example, a 90%
        confidence score does not mean that an investment has a 90% probability of producing a
        profit.
      </p>

      <h2>6. Portfolio and scenario calculations</h2>
      <p>
        AIC may permit you to enter information such as portfolio value, sector exposure, investment
        horizon, risk tolerance, existing positions and investment constraints. Where AIC calculates
        exposures, concentration levels, scenario outcomes or other numerical values, those
        calculations depend on the information you provide and may be incomplete or incorrect where
        your inputs or the underlying data are incomplete or incorrect.
      </p>

      <h2>7. AI committee members</h2>
      <p>
        Committee members displayed by AIC are AI-generated analytical personas unless clearly
        identified otherwise. Professional role names &mdash; Chairman, Equity Analyst, Quantitative
        Analyst, Macro Strategist, Risk Officer, Portfolio Analyst, Sector Specialist &mdash;
        describe analytical functions performed within AIC. They do not mean that a licensed human
        professional personally reviewed or approved the analysis.
      </p>

      <h2>8. AI limitations</h2>
      <p>
        Artificial intelligence can produce errors. AIC output may contain incorrect facts or
        calculations, rely on outdated information, misinterpret documents, miss relevant
        information, misunderstand market developments, incorrectly summarize sources or produce
        conflicting conclusions. You should independently verify information that is material to an
        investment decision.
      </p>

      <h2>9. Market and third-party data</h2>
      <p>
        AIC may use information obtained from third-party providers and public sources, including
        securities prices, company fundamentals, regulatory filings, economic information, news,
        analyst information and market statistics. Such information may be delayed, incomplete,
        inaccurate, unavailable or subsequently corrected. AIC does not control third-party
        information and cannot guarantee its completeness, accuracy or timeliness.
      </p>

      <h2>10. Investment risk</h2>
      <p>
        Investing involves substantial risk, and you may lose part or all of the money invested.
        Risks may include market risk, volatility, concentration, liquidity, interest-rate, credit,
        economic, regulatory, political and geopolitical, currency, technology and execution risk, as
        well as dilution, financing risk, insolvency and bankruptcy. Past performance does not
        guarantee future results.
      </p>

      <h2>11. Eligibility</h2>
      <p>
        You must be at least 18 years old and legally capable of entering into these Terms. You may
        not use AIC where doing so would violate applicable law. AIC may restrict access to
        particular locations or jurisdictions.
      </p>

      <h2>12. Plans</h2>
      <div className="legalDraft">
        <h2>Not yet available for purchase</h2>
        <p>
          Paid plans are not currently offered. The tiers below describe intended pricing only and do
          not constitute an offer. Remove this notice when checkout is live and the figures are final.
        </p>
      </div>
      <table>
        <thead><tr><th>Plan</th><th>Price</th><th>Includes</th></tr></thead>
        <tbody>
          <tr><td>Free</td><td>$0</td><td>Up to 3 complimentary committee analyses, subject to product rules</td></tr>
          <tr><td>Essential</td><td>$12.99 every two weeks</td><td>Allowance and functionality shown at checkout</td></tr>
          <tr><td>Investor</td><td>$32.99 / month</td><td>Allowance and functionality shown at checkout</td></tr>
          <tr><td>Investor Pro</td><td>$64.99 / month</td><td>Expanded research functionality</td></tr>
          <tr><td>Business</td><td>from ~$499 / month</td><td>Organizational access, multiple users, shared research</td></tr>
          <tr><td>Fund / Professional</td><td>from ~$1,999 / month</td><td>Professional and institutional research workflows</td></tr>
          <tr><td>Fund Pro</td><td>from ~$4,999 / month</td><td>Expanded institutional research, integrations, API</td></tr>
          <tr><td>Enterprise</td><td>custom, generally from ~$10,000 / month</td><td>Custom integrations, API, SSO, security controls, custom agents, private deployment</td></tr>
        </tbody>
      </table>
      <p>
        The price, usage limit and functionality shown at checkout, or stated in a signed order form,
        control if they differ from this general description.
      </p>

      <h2>13. Free analyses</h2>
      <p>
        A free analysis is generally considered used when AIC successfully produces the applicable
        completed committee result. A session that fails solely because of an AIC technical
        malfunction should not ordinarily consume a free analysis. AIC may use technical measures to
        prevent circumvention of free-use restrictions.
      </p>

      <h2>14. Automatic renewal</h2>
      <p>
        Recurring subscriptions automatically renew at the applicable billing interval unless
        cancelled before renewal. You authorize the applicable payment provider to charge the payment
        method associated with your subscription for recurring fees and applicable taxes.
      </p>

      <h2>15. Cancellation</h2>
      <p>
        You may cancel a subscription using the account functionality provided by AIC or another
        cancellation method made available to you. Cancellation prevents subsequent renewals and,
        unless otherwise required by law, ordinarily takes effect at the end of the already-paid
        billing period.
      </p>

      <h2>16. Refunds</h2>
      <p>
        Except where required by applicable law or expressly stated otherwise at purchase, fees for a
        billing period that has already begun are non-refundable. AIC may provide refunds or account
        credits where appropriate following significant technical failure. Mandatory consumer rights
        are not limited by this section.
      </p>

      <h2>17. Pricing changes</h2>
      <p>
        AIC may change prices or plan functionality. Price changes affecting an existing recurring
        subscription will be communicated as required by applicable law and will ordinarily apply to
        a future renewal rather than retroactively to a completed billing period.
      </p>

      <h2>18. Taxes</h2>
      <p>
        Prices may not include taxes unless expressly stated otherwise. You are responsible for
        applicable taxes associated with your purchase where legally permitted.
      </p>

      <h2>19. Acceptable use</h2>
      <p>You may not:</p>
      <ul>
        <li>circumvent subscription or usage limits;</li>
        <li>attempt unauthorized access to another user&rsquo;s information;</li>
        <li>interfere with platform security or introduce malicious code;</li>
        <li>overload AIC through unauthorized automated use, or scrape the platform at scale without permission;</li>
        <li>redistribute restricted third-party market data;</li>
        <li>represent fictional AIC agents as licensed human professionals;</li>
        <li>use AIC to facilitate securities fraud or market manipulation;</li>
        <li>violate sanctions laws or use AIC for unlawful activity;</li>
        <li>reverse engineer protected platform technology except where applicable law expressly permits it.</li>
      </ul>

      <h2>20. User content</h2>
      <p>
        You retain ownership rights that you hold in information or documents you submit to AIC. You
        grant AIC and its necessary service providers permission to process that information solely
        as reasonably necessary to provide the requested service, maintain and secure the platform,
        and comply with applicable law. You represent that you have the rights necessary to submit
        the information.
      </p>

      <h2>21. Generated reports</h2>
      <p>
        Subject to applicable law and third-party rights, you may use reports generated for you for
        your own lawful purposes. Third-party market data, news content, regulatory information,
        trademarks and copyrighted materials remain subject to applicable rights and provider
        restrictions. Commercial redistribution may require additional permission.
      </p>

      <h2>22. Intellectual property</h2>
      <p>
        AIC and its licensors retain ownership of the platform, including its software,
        architecture, AI orchestration, interface, branding, designs, proprietary prompts and
        workflows, agent framework and underlying technology. Use of AIC does not transfer ownership
        of the platform to you.
      </p>

      <h2>23. Availability</h2>
      <p>
        AIC is provided on an &ldquo;as available&rdquo; basis. We may modify models, AI providers,
        agents, data sources, interfaces, features, usage limits and infrastructure, and may
        temporarily suspend features for maintenance, security, legal compliance or technical
        reasons. We do not guarantee uninterrupted availability.
      </p>

      <h2>24. No guarantee of performance</h2>
      <p>
        AIC does not guarantee investment profits, future returns, preservation of capital, avoidance
        of losses, market timing, accuracy of predictions or achievement of investment objectives. No
        confidence score, vote or committee conclusion should be interpreted as a guarantee.
      </p>

      <h2>25. Disclaimer of warranties</h2>
      <p>
        To the maximum extent permitted by law, AIC is provided &ldquo;as is&rdquo; and &ldquo;as
        available.&rdquo; We disclaim warranties that cannot reasonably be given regarding
        uninterrupted operation, accuracy, completeness, reliability and fitness for a particular
        investment purpose. This section does not limit warranties or rights that cannot legally be
        excluded.
      </p>

      <h2>26. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by applicable law,{" "}
        <span className="fill">[LEGAL ENTITY NAME]</span> and its affiliates will not be liable for
        investment decisions made by a user or for investment losses resulting from reliance on AIC
        output, nor for indirect, incidental, special, consequential or punitive damages, or for lost
        profits resulting from use of AIC.
      </p>
      <p>
        For paid consumer accounts, and except where applicable law requires otherwise, our aggregate
        liability arising from the service will not exceed the greater of (a) the amount you paid to
        AIC during the 12 months preceding the event giving rise to the claim, or (b) US $100.
        Different liability arrangements may apply under a Business, Fund or Enterprise agreement.
        Nothing in these Terms excludes liability that applicable law prohibits us from excluding.
      </p>

      <h2>27. Business and institutional users</h2>
      <p>
        Business, Fund and Enterprise accounts may be governed by additional written agreements.
        Where an order form, Master Services Agreement, Data Processing Agreement or other signed
        agreement conflicts with these Terms, the signed agreement controls for the matters covered
        by it.
      </p>

      <h2>28. Suspension and termination</h2>
      <p>
        AIC may suspend or terminate access where reasonably necessary because of violation of these
        Terms, non-payment, fraud, security threats, abuse or legal requirements. You may stop using
        AIC at any time.
      </p>

      <h2>29. Changes to these Terms</h2>
      <p>
        We may update these Terms. The current version will display the applicable effective date.
        Where required by law, we will provide notice of material changes.
      </p>

      <h2>30. Governing law</h2>
      <p>
        These Terms are governed by the laws of <span className="fill">[JURISDICTION]</span>, without
        regard to its conflict-of-law principles, except where mandatory consumer-protection law
        requires otherwise. Venue and dispute-resolution provisions will be applied subject to
        applicable law.
      </p>

      <h2>31. Contact</h2>
      <p>
        <span className="fill">[LEGAL ENTITY NAME]</span><br />
        <span className="fill">[REGISTERED ADDRESS]</span><br />
        <span className="fill">[LEGAL/PRIVACY EMAIL]</span>
      </p>

      <footer className="legalFoot">
        <Link href="/">Home</Link>
        <Link href="/privacy">Privacy Policy</Link>
        <Link href="/disclosures">Risk &amp; AI Disclosure</Link>
      </footer>
    </main>
  );
}
