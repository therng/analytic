from __future__ import annotations

import pytest

from bridge.exit_codes import (
    Classification,
    ForcedTermination,
    PolicyKind,
    WorkerExitCode,
    classify_exit_code,
    classify_forced_termination,
    classify_raw_exit_code,
    restart_policy_for,
)


def test_every_worker_exit_code_maps_to_a_classification_of_same_shape():
    for code in WorkerExitCode:
        classification = classify_exit_code(code)
        assert classification.value == code.name.lower()


def test_forced_termination_variants_both_collapse_to_forced_termination():
    assert (
        classify_forced_termination(ForcedTermination.FORCED_TERMINATE)
        == Classification.FORCED_TERMINATION
    )
    assert (
        classify_forced_termination(ForcedTermination.FORCED_JOB_KILL)
        == Classification.FORCED_TERMINATION
    )


def test_raw_exit_code_matching_known_value_classifies_normally():
    assert classify_raw_exit_code(13) == Classification.LEASE_LOST


def test_raw_exit_code_outside_known_set_is_unexpected_fatal():
    assert classify_raw_exit_code(1) == Classification.UNEXPECTED_FATAL
    assert classify_raw_exit_code(255) == Classification.UNEXPECTED_FATAL


@pytest.mark.parametrize(
    ("classification", "expected_kind"),
    [
        (Classification.CLEAN_SHUTDOWN, PolicyKind.NO_RESTART_REMOVE),
        (Classification.CONFIG_INVALID, PolicyKind.QUARANTINE_IMMEDIATE),
        (Classification.JOURNAL_FAILURE, PolicyKind.QUARANTINE_IMMEDIATE),
        (Classification.JOURNAL_LOCKED, PolicyKind.BACKOFF_RESTART),
        (Classification.DUPLICATE_OWNERSHIP, PolicyKind.FIXED_DELAY_RESTART),
        (Classification.IDENTITY_VIOLATION, PolicyKind.BACKOFF_RESTART),
        (Classification.LEASE_LOST, PolicyKind.BACKOFF_RESTART),
        (Classification.MT5_IPC_FAILURE, PolicyKind.BACKOFF_RESTART),
        (Classification.TERMINAL_NOT_READY, PolicyKind.BACKOFF_RESTART),
        (Classification.UNEXPECTED_FATAL, PolicyKind.BACKOFF_RESTART),
        (Classification.FORCED_TERMINATION, PolicyKind.BACKOFF_RESTART),
    ],
)
def test_restart_policy_table_matches_design(classification, expected_kind):
    assert restart_policy_for(classification).kind == expected_kind


def test_permanent_failures_alert_on_first_occurrence():
    assert restart_policy_for(Classification.CONFIG_INVALID).alert_on_first_occurrence
    assert restart_policy_for(Classification.JOURNAL_FAILURE).alert_on_first_occurrence


def test_expected_steady_states_do_not_alert_on_first_occurrence():
    assert not restart_policy_for(
        Classification.DUPLICATE_OWNERSHIP
    ).alert_on_first_occurrence
    assert not restart_policy_for(Classification.LEASE_LOST).alert_on_first_occurrence
    assert not restart_policy_for(
        Classification.IDENTITY_VIOLATION
    ).alert_on_first_occurrence
    assert not restart_policy_for(Classification.JOURNAL_LOCKED).alert_on_first_occurrence


def test_unexpected_and_forced_termination_alert_on_first_occurrence():
    assert restart_policy_for(Classification.UNEXPECTED_FATAL).alert_on_first_occurrence
    assert restart_policy_for(
        Classification.FORCED_TERMINATION
    ).alert_on_first_occurrence


def test_every_classification_has_a_policy():
    for classification in Classification:
        restart_policy_for(classification)
