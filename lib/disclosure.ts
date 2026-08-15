/**
 * Version of the risk disclosure a visitor is asked to accept.
 *
 * Bump this when the wording changes materially: acceptance is recorded against
 * the version, so a change means every visitor is asked again.
 *
 * It lives here rather than in the route because Next.js only permits a fixed set
 * of exports from a route file.
 */
export const DISCLOSURE_VERSION = "2026-08-14";
