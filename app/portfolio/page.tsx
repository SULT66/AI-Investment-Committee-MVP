import { Portfolio } from "@/components/portfolio";

export const metadata = {
  title: "Your portfolio — AI Investment Committee",
  robots: { index: false, follow: false }
};

export default function PortfolioPage() {
  return <Portfolio />;
}
