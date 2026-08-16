import { ResetForm } from "@/components/reset-form";
import "../account/account.css";

export const metadata = {
  title: "Reset your password — AI Investment Committee",
  robots: { index: false, follow: false }
};

export default function ResetPage() {
  return <ResetForm />;
}
