"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import TradingViewWidget from "@/components/trading-monitor/TradingViewWidget";

const EXIT_ANIMATION_MS = 220;

export function TradingViewAnalysisModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = useCallback(() => {
    if (isClosing || closeTimerRef.current) {
      return;
    }

    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onClose();
      setIsClosing(false);
    }, EXIT_ANIMATION_MS);
  }, [isClosing, onClose]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    dialogRef.current?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleClose, open]);

  if (!open && !isClosing) {
    return null;
  }

  return createPortal(
    <>
      <div
        className={`tv-modal-backdrop zoom-backdrop${isClosing ? " is-closing" : ""}`}
        role="presentation"
        onClick={handleClose}
      >
        <div
          ref={dialogRef}
          className={`tv-modal zoom-modal${isClosing ? " zoom-out" : " zoom-in"}`}
          role="dialog"
          aria-modal="true"
          aria-label="TradingView technical analysis"
          tabIndex={-1}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="tv-modal__chrome" aria-hidden="true" />
          <button
            type="button"
            className="tv-modal__close"
            onClick={handleClose}
            aria-label="Close technical analysis"
          >
            <span className="tv-modal__close-mark" aria-hidden="true" />
          </button>
          <div className="tv-modal__body">
            <TradingViewWidget />
          </div>
        </div>
      </div>

      <style jsx>{`
        .zoom-backdrop {
          animation: backdropFadeIn 280ms ease forwards;
        }

        .zoom-backdrop.is-closing {
          opacity: 0;
        }

        .zoom-modal {
          transform-origin: center;
          will-change: transform, opacity;
        }

        .zoom-in {
          animation: tvZoomIn 320ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        .zoom-out {
          animation: tvZoomOut 280ms cubic-bezier(0.4, 0, 1, 1) forwards;
        }

        @keyframes backdropFadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes tvZoomIn {
          from {
            opacity: 0;
            transform: scale(0.75) translateY(40px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }

        @keyframes tvZoomOut {
          from {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
          to {
            opacity: 0;
            transform: scale(0.75) translateY(40px);
          }
        }
      `}</style>
    </>,
    document.body,
  );
}
