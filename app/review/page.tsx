import Link from "next/link";
import { ReviewStarter } from "@/components/review-starter";

export const metadata = {
  title: "Review your portfolio — AI Investment Committee",
  description:
    "Seven independent AI specialists examine the mix you hold and report what it is exposed to. Research and decision support, not investment advice."
};

export default function ReviewPage() {
  return (
    <>
      <header className="buildHead">
        <p className="buildKicker">
          <Link href="/">AIC</Link> · Review
        </p>
      </header>
      <ReviewStarter />
    </>
  );
}
