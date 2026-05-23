import time
import hmac
import hashlib
import pytest
from backend.security import verify_signature

def test_verify_signature_valid():
    secret = "test-secret"
    payload = '{"test": "data"}'
    timestamp = str(int(time.time()))
    nonce = "test-nonce"
    msg = f"{timestamp}{nonce}{payload}".encode()
    signature = hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()
    
    assert verify_signature(payload, signature, timestamp, nonce, secret) is True

def test_verify_signature_invalid_signature():
    assert verify_signature('{}', "wrong", "123", "nonce", "secret") is False

def test_verify_signature_expired():
    secret = "test-secret"
    payload = '{"test": "data"}'
    timestamp = str(int(time.time()) - 60) # 60 seconds ago
    nonce = "test-nonce"
    msg = f"{timestamp}{nonce}{payload}".encode()
    signature = hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()
    
    assert verify_signature(payload, signature, timestamp, nonce, secret) is False
