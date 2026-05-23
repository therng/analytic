import hmac, hashlib, time

def verify_signature(payload: str, signature: str, timestamp: str, nonce: str, secret: str) -> bool:
    try:
        ts_int = int(timestamp)
        if abs(int(time.time()) - ts_int) > 30:
            return False
    except ValueError:
        return False
        
    msg = f"{timestamp}{nonce}{payload}".encode()
    expected = hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
