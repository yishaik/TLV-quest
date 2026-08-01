import type { Metadata } from "next";
import { FieldVerification } from "@/components/FieldVerification";

export const metadata: Metadata = {
  title: "אימות שטח",
  robots: { index: false, follow: false }
};

export default function FieldVerificationPage() {
  return <FieldVerification />;
}
