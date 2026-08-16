import { ReportList } from "@/components/report-list";

export const metadata = {
  title: "Your sessions — AI Investment Committee",
  robots: { index: false, follow: false }
};

export default function ReportsPage() {
  return <ReportList />;
}
