import Link from "next/link";
import "../legal/legal.css";

export const metadata = {
  title: "Privacy Policy — AI Investment Committee",
  description: "What data AIC collects, why, who processes it, and how long it is kept."
};

/**
 * DRAFT for review by qualified counsel.
 *
 * Written against the system as built: the visitor cookie, the session and report
 * stores, the usage ledger, and the three processors data actually reaches.
 */
export default function PrivacyPage() {
  return (
    <main className="legal">
      <header className="legalHead">
        <p className="legalKicker"><Link href="/">AIC</Link> · Legal</p>
        <h1>Privacy Policy</h1>
        <p className="legalDates">
          Draft · Last updated <span className="fill">[DATE]</span> · Effective <span className="fill">[DATE]</span>
        </p>
      </header>

      <div className="legalDraft">
        <h2>Draft — not yet reviewed by counsel</h2>
        <p>
          This describes what the platform actually collects and where it goes, as a starting point
          for legal review. It is not legal advice. GDPR, UK GDPR, CCPA/CPRA and other regimes each
          impose specific wording and rights that counsel should confirm.
        </p>
        <p>
          Before publishing: complete every <span className="fill">[marked]</span> field, confirm
          whether a cookie consent banner is required for your audience, and verify the international
          transfer basis for each processor below.
        </p>
      </div>

      <h2>1. Who is responsible</h2>
      <p>
        <span className="fill">[LEGAL ENTITY NAME]</span>, <span className="fill">[REGISTERED ADDRESS]</span>,
        is the controller of personal data processed through AIC. Contact:{" "}
        <span className="fill">[CONTACT EMAIL]</span>.{" "}
        <span className="fill">[If you have EU or UK users, counsel should confirm whether a
        representative under GDPR Art. 27 is required.]</span>
      </p>

      <h2>2. What we collect</h2>
      <p>
        AIC currently has no user accounts. We do not ask for your name, email address or payment
        details, and we do not connect to your brokerage.
      </p>
      <table>
        <thead>
          <tr><th>Data</th><th>Why</th><th>Basis</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>A random visitor identifier stored in a cookie (<code>aic_vid</code>)</td>
            <td>To count the free reviews you have used, so the allowance is enforced server-side</td>
            <td>Necessary to provide the service you requested</td>
          </tr>
          <tr>
            <td>Session inputs: the security you review, and any portfolio value, sector exposure, horizon and risk tolerance you enter</td>
            <td>To run the committee review and compute the limits implied by your own constraints</td>
            <td>Necessary to provide the service you requested</td>
          </tr>
          <tr>
            <td>Session results: agent statements, votes, evidence, decision and the resulting report</td>
            <td>So you can return to a review you generated</td>
            <td>Necessary to provide the service you requested</td>
          </tr>
          <tr>
            <td>Follow-up questions you type into Ask Committee</td>
            <td>To answer them in the context of that review</td>
            <td>Necessary to provide the service you requested</td>
          </tr>
          <tr>
            <td>Standard server logs (IP address, request time, error diagnostics)</td>
            <td>Security, abuse prevention and fault diagnosis</td>
            <td>Our legitimate interest in operating a secure service</td>
          </tr>
        </tbody>
      </table>
      <p>
        The cookie is set to <code>HttpOnly</code>, so it cannot be read by scripts in your browser,
        and it contains a random identifier only &mdash; no personal details.
      </p>

      <h2>3. Please do not enter more than we need</h2>
      <p>
        The figures you supply are used only to compute your own policy limits. Please do not enter
        account numbers, identity documents, health information or anything else the service does
        not ask for.
      </p>

      <h2>4. Who processes your data</h2>
      <table>
        <thead>
          <tr><th>Processor</th><th>What reaches them</th><th>Where</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>OpenAI</td>
            <td>The security under review, the market data and news gathered for it, your entered constraints, and any follow-up question you ask</td>
            <td><span className="fill">[Confirm processing region and the applicable data-processing terms]</span></td>
          </tr>
          <tr>
            <td>Finnhub</td>
            <td>The ticker symbol being looked up. No information about you is sent.</td>
            <td><span className="fill">[Confirm]</span></td>
          </tr>
          <tr>
            <td>Microsoft Azure (hosting)</td>
            <td>Everything stored by the platform, plus standard server logs</td>
            <td><span className="fill">[Confirm the hosting region]</span></td>
          </tr>
        </tbody>
      </table>
      <p>
        We do not sell your data, and we do not share it for advertising.{" "}
        <span className="fill">[If you later add analytics or payment providers, they must be added
        to this table.]</span>
      </p>
      <p>
        <span className="fill">[Counsel to confirm the transfer mechanism — for example Standard
        Contractual Clauses — where data leaves the EEA or UK.]</span>
      </p>

      <h2>5. How long we keep it</h2>
      <ul>
        <li><strong>Live session state</strong> &mdash; deleted automatically about six hours after the session.</li>
        <li><strong>Committee reports</strong> &mdash; kept so you can return to them. <span className="fill">[Set and state a retention period.]</span></li>
        <li><strong>Usage ledger</strong> &mdash; kept while the free allowance applies to your visitor identifier, so the limit cannot be reset by reloading.</li>
        <li><strong>Server logs</strong> &mdash; <span className="fill">[state the period, commonly 30–90 days]</span>.</li>
      </ul>

      <h2>6. Your rights</h2>
      <p>
        Depending on where you live, you may have the right to access, correct, delete, restrict or
        object to the processing of your personal data, and to receive a copy in a portable format.
        To exercise these rights, contact <span className="fill">[CONTACT EMAIL]</span>.
      </p>
      <p>
        Because AIC has no accounts, we identify your data by the visitor identifier in your cookie.
        Clearing your cookies makes that link unrecoverable &mdash; we would then have no way to
        find your previous sessions, and no way to restore your used allowance.
      </p>
      <p>
        <span className="fill">[EU/UK users additionally have the right to complain to their
        supervisory authority. California residents have rights under CCPA/CPRA. Counsel to confirm
        the disclosures required for your audience.]</span>
      </p>

      <h2>7. Security</h2>
      <p>
        Traffic is encrypted in transit. API credentials are held in server-side configuration and
        are never sent to your browser. Access to stored data is limited to the operation of the
        service. No system is perfectly secure, and we cannot guarantee absolute security.
      </p>

      <h2>8. Children</h2>
      <p>
        AIC is not intended for anyone under 18, and we do not knowingly collect data from children.
      </p>

      <h2>9. Changes</h2>
      <p>
        We may update this policy. Material changes will be reflected in the &ldquo;last
        updated&rdquo; date above.
      </p>

      <footer className="legalFoot">
        <Link href="/">Home</Link>
        <Link href="/terms">Terms of Service</Link>
      </footer>
    </main>
  );
}
