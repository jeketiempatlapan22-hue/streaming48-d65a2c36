import { lazy, Suspense } from "react";
import ErrorBoundary from "@/components/ErrorBoundary";

const QuizManager = lazy(() => import("@/components/admin/QuizManager"));
const LiveQuizSlot = lazy(() => import("@/components/viewer/LiveQuizSlot"));

const Fallback = ({ label }: { label: string }) => (
  <div className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
    {label}…
  </div>
);

const ErrorFallback = ({ label }: { label: string }) => (
  <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-xs text-destructive">
    Bagian "{label}" gagal dimuat. Coba refresh halaman.
  </div>
);

const MonitorQuizSection = () => {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-lg font-bold text-foreground">🏆 Live Quiz</h3>
          <p className="text-xs text-muted-foreground">Atur pertanyaan, lihat preview viewer, dan pantau jawaban masuk secara langsung.</p>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,1fr)]">
        <div className="min-w-0">
          <ErrorBoundary fallback={<ErrorFallback label="Quiz Manager" />}>
            <Suspense fallback={<Fallback label="Memuat Quiz Manager" />}>
              <QuizManager />
            </Suspense>
          </ErrorBoundary>
        </div>
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Preview Quiz (tampilan user)</h4>
          <div className="rounded-xl border border-border bg-background/40 p-2 min-h-[200px]">
            <ErrorBoundary fallback={<ErrorFallback label="Preview Quiz" />}>
              <Suspense fallback={<Fallback label="Memuat preview" />}>
                <LiveQuizSlot />
              </Suspense>
            </ErrorBoundary>
            <p className="mt-2 text-center text-[10px] text-muted-foreground italic">Sinkron realtime dengan quiz aktif. Pemenang akan otomatis tampil di sini.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MonitorQuizSection;
