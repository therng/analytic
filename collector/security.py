import hmac, hashlib

def sign_payload(payload: str, timestamp: str, nonce: str, secret: str) -> str:
    msg = f"{timestamp}{nonce}{payload}".encode()
    return hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()
