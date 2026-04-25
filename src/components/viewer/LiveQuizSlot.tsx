import { lazy, Suspense } from "react";
import { useLiveQuiz } from "@/hooks/useLiveQuiz";

const LiveQuizBanner = lazy(() => import("@/components/viewer/LiveQuizBanner"));

interface LiveQuizSlotProps {
  currentUserId?: string | null;
}

const LiveQuizSlot = ({ currentUserId }: LiveQuizSlotProps) => {
  const { activeQuiz, winners } = useLiveQuiz();
  if (!activeQuiz) return null;
  return (
    <div className="px-3 pt-2">
      <Suspense fallback={null}>
        <LiveQuizBanner quiz={activeQuiz} winners={winners} currentUserId={currentUserId} />
      </Suspense>
    </div>
  );
};

export default LiveQuizSlot;
