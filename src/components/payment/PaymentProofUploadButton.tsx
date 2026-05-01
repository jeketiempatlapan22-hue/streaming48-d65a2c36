import { useRef, type ReactNode } from "react";
import { Upload } from "lucide-react";

interface PaymentProofUploadButtonProps {
  /** Called with the picked file. Reset of input value is handled internally. */
  onFile: (file: File) => void;
  /** True while the parent is uploading the file (disables the button visually). */
  uploading?: boolean;
  /**
   * Optional gate fn — return a string (error toast/message) to BLOCK opening
   * the picker, or null/undefined to allow. Use this instead of `disabled` so
   * mobile browsers reliably open the native picker.
   */
  guard?: () => string | null | undefined;
  /** Optional toast handler invoked when guard returns a message. */
  onGuardFail?: (message: string) => void;
  /** Visual disabled state for the button (does NOT touch the file input). */
  disabled?: boolean;
  /** Label / icon override. */
  children?: ReactNode;
  className?: string;
  /** When true, render an outlined dashed style (used inside QRIS modals). */
  variant?: "primary" | "dashed";
  testId?: string;
}

/**
 * Reusable payment-proof upload trigger.
 *
 * Mobile-safe pattern:
 *  - Real <input type="file"> is rendered OFF-SCREEN (not display:none) so that
 *    Android WebView / iOS PWA still treat it as interactive.
 *  - The input is NEVER disabled — disabling a file input is unreliable on
 *    mobile and can leave the picker permanently un-openable until full reload.
 *  - The visible <button> handles the click in a synchronous user-gesture
 *    handler (required for iOS to open the native picker).
 *  - input.value is cleared after each pick so the user can re-select the same
 *    file if they want to retry.
 */
export function PaymentProofUploadButton({
  onFile,
  uploading = false,
  guard,
  onGuardFail,
  disabled = false,
  children,
  className,
  variant = "primary",
  testId,
}: PaymentProofUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    if (uploading || disabled) return;
    if (guard) {
      const msg = guard();
      if (msg) {
        onGuardFail?.(msg);
        return;
      }
    }
    // Synchronous .click() inside the user-gesture handler — critical for iOS.
    inputRef.current?.click();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Always reset so picking the same file twice still fires onChange.
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;
    onFile(file);
  };

  const baseClass =
    variant === "dashed"
      ? "flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary/40 bg-primary/10 px-5 py-4 text-base font-semibold text-primary transition hover:border-primary hover:bg-primary/20 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
      : "flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-bold text-primary-foreground transition hover:bg-primary/90 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed";

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={uploading || disabled}
        aria-label="Upload bukti pembayaran"
        data-testid={testId || "upload-proof-btn"}
        className={className || baseClass}
      >
        {children ?? (
          <>
            <Upload className="h-5 w-5" />
            {uploading ? "Mengupload..." : "📷 Upload Bukti Pembayaran"}
          </>
        )}
      </button>
      {/* Off-screen file input — must remain in the DOM and visible to the
          accessibility tree for mobile browsers to honour programmatic click(). */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleChange}
        tabIndex={-1}
        aria-hidden="true"
        style={{
          position: "absolute",
          width: "1px",
          height: "1px",
          padding: 0,
          margin: "-1px",
          overflow: "hidden",
          clip: "rect(0,0,0,0)",
          whiteSpace: "nowrap",
          border: 0,
          opacity: 0,
          pointerEvents: "none",
          left: "-9999px",
          top: 0,
        }}
      />
    </>
  );
}
