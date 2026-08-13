import Link from "next/link";

/**
 * 404.
 *
 * Old committee-room links are still in people's history and search indexes, so
 * this has to be a way forward rather than a dead end.
 */
export default function NotFound() {
  return (
    <main className="errorPage">
      <p className="errorCode">404</p>
      <h1>That page does not exist</h1>
      <p className="errorLede">
        The link may be out of date. The 3D committee room was retired; sessions now run on the
        Live Investment Desk.
      </p>
      <div className="errorActions">
        <Link className="errorPrimary" href="/">Start a research session</Link>
      </div>
      <p className="errorHint">
        Looking for a past session? Committee reports stay available at their own address —
        <code>/report/&lt;session id&gt;</code>.
      </p>
    </main>
  );
}
