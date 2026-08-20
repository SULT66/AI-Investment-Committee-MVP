import { redirect } from "next/navigation";

/**
 * Monitor was merged into the dashboard: the two answered nearly the same
 * question from the same data, and two pages that nearly agree are worse than
 * one that is right.
 *
 * Kept as a redirect rather than deleted, because /monitor is in the alert
 * emails already sent and in whatever anybody bookmarked. A dead link in a mail
 * that tells somebody their position needs attention is the worst place to have
 * one.
 */
export default function MonitorPage() {
  redirect("/dashboard");
}
