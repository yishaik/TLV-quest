import type { Metadata } from "next";
import { QuestionReview } from "@/components/QuestionReview";

export const metadata: Metadata = {
  title: "בדיקת שאלות | TLV Quest",
  robots: { index: false, follow: false }
};

export default function QuestionReviewPage() {
  return <QuestionReview />;
}
