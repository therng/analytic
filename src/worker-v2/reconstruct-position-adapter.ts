import type { PrismaClient } from "@prisma/client";
import { reconstructPositionIfClosed } from "./position-reconstructor";
import type { ReconstructPositionFn } from "./history-checkpoint";

/**
 * Adapts position-reconstructor.ts's real-PrismaClient-based reconstruction
 * into the ReconstructPositionFn history-checkpoint.ts's reconcileChunkPositions
 * expects. Shared by deal-consumer.ts and order-consumer.ts: whichever stream's
 * barrier happens to be the second to arrive for a chunk is the one whose
 * persistHistoryBarrier call triggers reconciliation, so both consumers need
 * this identically.
 *
 * The `tx as unknown as PrismaClient` cast is necessary and safe: at runtime
 * `tx` is always the real Prisma `$transaction` client — history-checkpoint.ts's
 * DbLike is intentionally a minimal structural view kept for testability, not
 * a different object.
 */
export function makeReconstructPosition(accountId: string, accountNo: string): ReconstructPositionFn {
  return async (tx, positionId) => {
    const result = await reconstructPositionIfClosed(
      tx as unknown as PrismaClient,
      accountId,
      accountNo,
      positionId,
    );
    switch (result.status) {
      case "closed":
        return { status: "closed" };
      case "open":
        return { status: "open" };
      case "ambiguous-reopen":
        return { status: "ambiguous-reopen", reason: `lastDealNo=${result.lastDealNo}` };
      case "corrupted":
        return { status: "corrupted", reason: result.reason };
      case "no-deals":
        return { status: "no-deals" };
    }
  };
}
