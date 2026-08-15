import { AccessGate } from "@/components/access-gate";
import "./access.css";

export const metadata = {
  title: "Access — AI Investment Committee",
  robots: { index: false, follow: false }
};

export default function AccessPage() {
  return <AccessGate />;
}
