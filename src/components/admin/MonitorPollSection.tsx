import { lazy, Suspense } from "react";
import ErrorBoundary from "@/components/ErrorBoundary";

const PollManager = lazy(() => import("@/components/admin/PollManager"));
const LivePoll = lazy(() => import("@/components/viewer/LivePoll"));

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

const MonitorPollSection = () => {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ErrorBoundary fallback={<ErrorFallback label="Poll Manager" />}>
        <Suspense fallback={<Fallback label="Memuat Poll Manager" />}>
          <PollManager />
        </Suspense>
      </ErrorBoundary>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground">Preview Poll (tampilan user)</h3>
        <div className="rounded-xl border border-border bg-card p-2">
          <ErrorBoundary fallback={<ErrorFallback label="Preview Poll" />}>
            <Suspense fallback={<Fallback label="Memuat preview" />}>
              <LivePoll voterId="admin-preview" />
            </Suspense>
          </ErrorBoundary>
          <p className="mt-2 text-center text-xs text-muted-foreground italic">Preview poll aktif saat ini</p>
        </div>
      </div>
    </div>
  );
};

export default MonitorPollSection;
