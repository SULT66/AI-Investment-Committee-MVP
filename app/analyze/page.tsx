import Link from "next/link";
import { AnalyzeWizard } from "@/components/analyze-wizard";

export const metadata = {
  title: "Review an instrument — AI Investment Committee",
  description:
    "Seven independent AI specialists examine a security from their own angle and argue it out. Research and decision support, not investment advice."
};

export default function AnalyzePage() {
  return (
    <>
      <header className="buildHead">
        <p className="buildKicker">
          <Link href="/">AIC</Link> · Analyze
        </p>
      </header>
      <AnalyzeWizard />
    </>
  );
}
