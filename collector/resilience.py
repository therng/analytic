from collections import deque

class RingBuffer:
    def __init__(self, maxlen=50):
        self.buffer = deque(maxlen=maxlen)
        
    def append(self, item):
        self.buffer.append(item)
        
    def get_all(self):
        return list(self.buffer)
        
    def clear(self):
        self.buffer.clear()
