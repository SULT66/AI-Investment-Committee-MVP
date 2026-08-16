import Link from "next/link";
import { BuildWizard } from "@/components/build-wizard";

export const metadata = {
  title: "Build a portfolio plan — AI Investment Committee",
  description:
    "Answer four questions and the committee proposes how a portfolio could be divided, with the reasoning behind every weight. Research, not investment advice."
};

export default function BuildPage() {
  return (
    <>
      <header className="buildHead">
        <p className="buildKicker">
          <Link href="/">AIC</Link> · Build
        </p>
      </header>
      <BuildWizard />
    </>
  );
}
