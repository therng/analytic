import json
import unittest
from datetime import datetime, timezone

from history_sync import (
    MIN_HISTORY_START_TS,
    HistoryAck,
    HistorySyncMachine,
    HistoryWindow,
    build_arg_parser,
)


def complete_ack(chunk):
    return HistoryAck(
        chunk_id=chunk.chunk_id,
        streams=frozenset({"deals", "orders", "position-closed"}),
        deals_cursor=chunk.deals_cursor,
        orders_cursor=chunk.orders_cursor,
    )


class HistorySyncMachineTests(unittest.TestCase):
    def test_starts_at_2000_in_bounded_window(self):
        machine = HistorySyncMachine.initial(window_days=30)
        window = machine.plan(1_783_939_200)

        self.assertEqual(window, HistoryWindow(MIN_HISTORY_START_TS, MIN_HISTORY_START_TS + 30 * 86400))

    def test_requires_durable_ack_before_next_chunk(self):
        machine = HistorySyncMachine.initial(window_days=30)
        chunk = machine.stage(machine.plan(1_783_939_200), deals=(), orders=())

        with self.assertRaisesRegex(RuntimeError, "durable ack"):
            machine.plan(1_783_939_200)

        before = machine.checkpoint_json()
        partial = HistoryAck(
            chunk_id=chunk.chunk_id,
            streams=frozenset({"deals", "orders"}),
            deals_cursor=chunk.deals_cursor,
            orders_cursor=chunk.orders_cursor,
        )
        self.assertFalse(machine.confirm(partial))
        self.assertEqual(machine.checkpoint_json(), before)
        self.assertTrue(machine.confirm(complete_ack(chunk)))

    def test_empty_chunk_advances_coverage_and_restart_resumes(self):
        machine = HistorySyncMachine.initial(window_days=30)
        first = machine.stage(machine.plan(1_783_939_200), deals=(), orders=())
        self.assertTrue(machine.confirm(complete_ack(first)))

        restored = HistorySyncMachine.restore(machine.checkpoint_json(), window_days=30)
        self.assertEqual(
            restored.plan(1_783_939_200),
            HistoryWindow(first.window.end, first.window.end + 30 * 86400),
        )

    def test_restart_while_waiting_for_ack_republishes_same_chunk(self):
        machine = HistorySyncMachine.initial(window_days=30)
        first = machine.stage(machine.plan(1_783_939_200), deals=(), orders=())

        restarted = HistorySyncMachine.restore(machine.checkpoint_json(), window_days=30)
        replay = restarted.stage(restarted.plan(1_783_939_200), deals=(), orders=())

        self.assertEqual(replay.chunk_id, first.chunk_id)
        self.assertEqual(replay.window, first.window)

    def test_deal_and_order_cursors_are_independent(self):
        machine = HistorySyncMachine.initial(window_days=30)
        chunk = machine.stage(
            machine.plan(1_783_939_200),
            deals=({"ticket": 12, "time": 100}, {"ticket": 13, "time": 100}),
            orders=({"ticket": 91, "time_done": 90, "time_setup": 80},),
        )
        self.assertEqual(chunk.deals_cursor, (100.0, 13))
        self.assertEqual(chunk.orders_cursor, (90.0, 91))

    def test_ack_with_wrong_chunk_does_not_advance(self):
        machine = HistorySyncMachine.initial(window_days=30)
        chunk = machine.stage(machine.plan(1_783_939_200), deals=(), orders=())
        before = machine.checkpoint_json()
        self.assertFalse(machine.confirm(HistoryAck(
            chunk_id="wrong",
            streams=frozenset({"deals", "orders", "position-closed"}),
            deals_cursor=chunk.deals_cursor,
            orders_cursor=chunk.orders_cursor,
        )))
        self.assertEqual(machine.checkpoint_json(), before)

    def test_cli_has_no_manual_backfill_mode_or_arguments(self):
        parser = build_arg_parser()
        with self.assertRaises(SystemExit):
            parser.parse_args(["--mode", "backfill-history"])
        with self.assertRaises(SystemExit):
            parser.parse_args(["--backfill-window-days", "30"])
        with self.assertRaises(SystemExit):
            parser.parse_args(["--backfill-start-date", "2000-01-01"])


if __name__ == "__main__":
    unittest.main()
