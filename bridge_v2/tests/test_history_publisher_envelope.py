"""Cross-language pin: bridge_v2's digest-chain algorithm must produce byte-
identical results to history-checkpoint.ts's nextRecordsSha256, since the
consumer independently re-chains payloadSha256 values as records arrive and
compares the result against the producer's declared barrier recordsSha256.
A drift here would make every chunk fail barrier verification permanently.

Ground truth computed once via:
  node -e 'const {createHash}=require("crypto");
    const f=(p,h)=>createHash("sha256").update(p+h).digest("hex");
    const EMPTY=createHash("sha256").update("").digest("hex");
    const d1=f(EMPTY,"a".repeat(64)); console.log(EMPTY, d1, f(d1,"b".repeat(64)));'
"""

from bridge_v2.history_publisher import EMPTY_RECORDS_SHA256, next_records_sha256

TS_EMPTY_RECORDS_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
TS_DIGEST_AFTER_ONE_RECORD = "52eb1e93d4e47646bf787c48513698fcde9f5952763a7a4bfa7c52fe0e8388e8"
TS_DIGEST_AFTER_TWO_RECORDS = "aa15cd3f0802376650ebc56322cdec1bf6f6990ed2602dd0648bbd8b10646195"


def test_empty_records_seed_matches_typescript():
    assert EMPTY_RECORDS_SHA256 == TS_EMPTY_RECORDS_SHA256


def test_digest_chain_matches_typescript_nextRecordsSha256():
    payload_a = "a" * 64
    payload_b = "b" * 64
    d1 = next_records_sha256(EMPTY_RECORDS_SHA256, payload_a)
    assert d1 == TS_DIGEST_AFTER_ONE_RECORD
    d2 = next_records_sha256(d1, payload_b)
    assert d2 == TS_DIGEST_AFTER_TWO_RECORDS
