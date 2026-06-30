# MT5 Python Bridge

อ่านข้อมูล account และ open positions แบบ real-time จาก MetaTrader 5 แล้ว push ไปยัง Redis ทุก 2 วินาที  
ใช้งานบน Windows VPS ที่ติดตั้ง MT5 terminals (portable mode)

---

## สถาปัตยกรรมการทำงาน

```
┌─────────────────────────────────────────┐
│           Windows VPS (forexvps)        │
│                                         │
│  MT5 Terminal #1 ─┐                     │
│  MT5 Terminal #2 ─┤─ run_all.py        │
│  MT5 Terminal #N ─┘    │               │
│                         ↓               │
│              mt5_bridge.py (×N)         │
│              (1 process per account)    │
│                         │               │
│              Python redis client        │
│                         │ SSH Tunnel    │
└─────────────────────────┼───────────────┘
                           ↓
             Redis (central server)
                  mt5:account:{login}:live
                  mt5:account:{login}:positions
                           ↓
             Next.js /api/accounts/[id]/live
                           ↓
             Dashboard → OpenPositionsPanel
             Dashboard → P/L, Margin, Free, Level KPIs
```

---

## ไฟล์และหน้าที่

### `discover_terminals.py` — ค้นหา MT5 Terminals

สแกน Windows Startup folder (`C:\Users\...\Startup`) หา `.lnk` shortcuts ที่มี:
- `terminal64.exe` ในชื่อไฟล์ exe
- `/portable` ใน arguments

แสดงว่า terminal นั้นรันแบบ portable (แต่ละ account แยก data folder)

```
python discover_terminals.py
# Found 3 portable MT5 terminals:
#   C:\MT5_1\terminal64.exe
#   C:\MT5_2\terminal64.exe
#   C:\MT5_3\terminal64.exe
```

**Dependencies:** `winshell`, `pywin32` (Windows only)

---

### `mt5_bridge.py` — Bridge หลัก (1 process ต่อ 1 account)

**ขั้นตอนการทำงาน:**

1. **initialize** — เรียก `mt5.initialize(path=terminal_path)` เชื่อมต่อกับ terminal ที่ระบุ
2. **ดึง login** — เรียก `mt5.account_info()` เพื่อรู้ว่า account นี้คือ login ใด
3. **กำหนด Redis keys** โดยใช้ login number:
   - `mt5:account:{login}:live`
   - `mt5:account:{login}:positions`
4. **Poll loop** ทุก 2 วินาที:
   - อ่าน `account_info()` → เขียน Hash ลง `live` key
   - อ่าน `positions_get()` → JSON serialize → เขียน String ลง `positions` key (TTL 10s)
5. **Shutdown** — เรียก `mt5.shutdown()` เมื่อ Ctrl+C

**ข้อมูลที่เขียนลง Redis:**

`mt5:account:{login}:live` (Hash, ไม่มี TTL):
| Field | ที่มาจาก MT5 | ความหมาย |
|-------|-------------|---------|
| `login` | `account_info().login` | MT5 account number |
| `balance` | `account_info().balance` | ยอดเงินในบัญชี |
| `equity` | `account_info().equity` | Equity (balance + floating P/L) |
| `margin` | `account_info().margin` | Margin ที่ใช้อยู่ |
| `freeMargin` | `account_info().margin_free` | Margin ที่ว่างอยู่ |
| `marginLevel` | `account_info().margin_level` | Margin Level % |
| `profit` | `account_info().profit` | Floating P/L รวมทุก position |
| `credit` | `account_info().credit` | Credit facility |
| `currency` | `account_info().currency` | สกุลเงิน (USD, THB…) |

`mt5:account:{login}:positions` (String JSON, TTL 10s):
```json
[
  {
    "ticket": 123456,
    "symbol": "XAUUSD",
    "type": 0,
    "volume": 0.10,
    "openPrice": 3320.50,
    "currentPrice": 3325.00,
    "sl": 3310.00,
    "tp": 3350.00,
    "profit": 45.00,
    "swap": -1.20,
    "comment": "Bot_Grid",
    "openTime": 1719700000
  }
]
```

| Field | ความหมาย |
|-------|---------|
| `ticket` | Position ticket number |
| `type` | `0` = Buy, `1` = Sell |
| `openTime` | Unix timestamp (วินาที) ที่เปิด order |
| `sl` / `tp` | Stop Loss / Take Profit (0 = ไม่ได้ตั้ง) |

> **หมายเหตุ TTL:** ถ้า bridge หยุดทำงาน key `positions` จะหายไปหลัง 10 วินาที  
> Dashboard จะถือว่า stale และ fallback ไปใช้ข้อมูลจาก DB แทน

**Args:**
```bash
python mt5_bridge.py \
  --terminal-path "C:\MT5_1\terminal64.exe" \
  --redis-url redis://:password@127.0.0.1:6379 \
  --interval 2.0
```

---

### `run_all.py` — Supervisor (เปิด bridge ทุก terminal พร้อมกัน)

1. โหลด `.env` จากโฟลเดอร์เดียวกัน (ดึง `REDIS_URL`)
2. เรียก `discover_terminal_paths()` หา terminals ทั้งหมด
3. Spawn `mt5_bridge.py` เป็น subprocess แยกกัน 1 process ต่อ 1 terminal
4. Watchdog loop ทุก 5 วินาที — ถ้า process ใดตาย จะ restart อัตโนมัติ
5. Ctrl+C / SIGTERM → terminate ทุก subprocess แล้วออก

```bash
# .env ในโฟลเดอร์ bridge/
REDIS_URL=redis://:yourpassword@127.0.0.1:6379

python run_all.py
# หรือระบุ URL ตรง:
python run_all.py --redis-url redis://:yourpassword@127.0.0.1:6379
```

---

## Setup

### 1. ติดตั้ง Dependencies

```bash
pip install -r requirements.txt
```

**requirements.txt:**
```
MetaTrader5>=5.0.45     # MT5 Python API (Windows only)
redis>=5.0.0            # Redis client (RESP3 protocol)
winshell>=0.6           # อ่าน .lnk shortcuts
pywin32>=306            # Windows COM bindings (ต้องการโดย winshell)
python-dotenv>=1.0.0    # โหลด .env file
```

### 2. ตั้งค่า Redis Connection

สร้างไฟล์ `bridge/.env`:
```env
REDIS_URL=redis://:yourpassword@127.0.0.1:6379
```

Redis บน central server ต้องเปิด AUTH (`requirepass`) และต้องเข้าถึงได้จาก forexvps

### 3. เชื่อม forexvps → Redis ด้วย SSH Tunnel

```bash
# รันบน forexvps (Windows) ให้อยู่ตลอด
ssh -N -L 6379:localhost:6379 user@central-server

# ทดสอบ
redis-cli -p 6379 -a yourpassword ping
# PONG
```

### 4. ตรวจสอบ Terminals

```bash
python discover_terminals.py
```

ถ้าไม่เจอ terminal ให้ตรวจว่า:
- MT5 รันแบบ `/portable` หรือยัง (ดูใน properties ของ shortcut)
- shortcut `.lnk` อยู่ใน Windows Startup folder หรือยัง

### 5. Spike Test (แนะนำก่อน production)

```bash
python spike/test_dual_connect.py "C:\MT5_1\terminal64.exe" "C:\MT5_2\terminal64.exe"
```

ตรวจว่าทั้ง 2 terminal เชื่อมต่อพร้อมกันได้ และแสดง login number ที่แตกต่างกัน

### 6. รัน

```bash
python run_all.py
```

---

## Windows Service (Production)

ติดตั้ง [nssm](https://nssm.cc/) แล้วรัน:

```bash
nssm install MT5Bridge "C:\Python\python.exe" "C:\bridge\run_all.py"
nssm set MT5Bridge AppEnvironmentExtra REDIS_URL=redis://:password@127.0.0.1:6379
nssm set MT5Bridge AppDirectory C:\bridge
nssm start MT5Bridge

# ดู log
nssm edit MT5Bridge   # กำหนด stdout/stderr log path
```

---

## Dashboard Integration

Next.js อ่านข้อมูลจาก Redis ผ่าน:

- **`GET /api/accounts/[id]/live`** → resolve `accountNo` จาก DB → เรียก `getMt5LiveData(accountNo)` → return `Mt5LiveData`

```ts
interface Mt5LiveData {
  live: Mt5LiveInfo | null;   // null ถ้า Hash ว่าง
  positions: Mt5Position[];   // [] ถ้า positions key หมดอายุ (stale)
  stale: boolean;             // true ถ้าไม่มี positions key
}
```

**การแสดงผล:**
- `stale = false` → ใช้ positions จาก Redis แสดงใน OpenPositionsPanel
- `stale = true` → fallback ไปใช้ข้อมูลจาก PostgreSQL (จาก HTML report import ล่าสุด)
- P/L, Margin, Free Margin, Margin Level → ใช้ `live.*` จาก Redis ก่อน, fallback ไป DB snapshot

---

## Troubleshooting

| อาการ | สาเหตุที่น่าจะเป็น |
|-------|-----------------|
| `mt5.initialize failed` | Terminal ไม่ได้รัน หรือ path ผิด |
| `account_info() returned None` | Terminal รันอยู่แต่ยังไม่ได้ login |
| Redis connection refused | SSH tunnel ไม่ได้เปิด หรือ REDIS_URL ผิด |
| Login is `None` | Terminal เปิดอยู่แต่ไม่มี active account |
| Dashboard แสดง stale data | Bridge หยุดทำงาน หรือ positions TTL (10s) หมด |
| ไม่เจอ terminal | Shortcut ไม่มี `/portable` arg หรือไม่อยู่ใน Startup folder |
