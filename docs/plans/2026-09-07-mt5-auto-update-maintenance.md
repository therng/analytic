# Follow-up (19:45): MT9 updater hang รอบสองหลัง reboot — purge stale staging

**การวินิจฉัย (post-reboot 18:57):** MT3/MT7/MT5 cold-start สะอาดเป็น 6182, MT1 เต้นรำแล้ว fallback หายเอง (19:00:40, binary 6182), watcher no-op ถูกต้องทั้งสองรอบ (19:00, 19:06) — เหลือ **MT9**: terminal cold-start 18:58:39 → เห็น staging state ค้าง (component เก่าใน `98E94DB0\liveupdate\`: MetaEditor 9/7, mt5onnx64.6180, engine 9/5 — payload หลักถูกใช้ไปแล้ว) → spawn updater PID 884 แล้ว exit ตัวเอง → updater ค้าง 45+ นาที (pattern เดียวกับเมื่อวาน) → MT9/7954220 ตาย

**แก้ทันที:**
1. `taskkill /F /PID 884` (updater ค้าง >15 นาที ตามเกณฑ์ runbook — ไม่ใช่ terminal ไม่ถือ session)
2. **Purge staging ทุก hash**: ลบเฉพาะ content *ข้างใน* `%APPDATA%\MetaQuotes\Terminal\*\liveupdate\` (รวม shadow dirs เช่น CBFD16DD) — **ห้ามแตะ** `origin.txt`/`portable.txt`/`config\` ที่ root ของ hash dir (เป็น mapping ระหว่าง hash↔install)
3. `mt5ops term start MT9` (Mos.lnk) → MT9 ต้อง cold-start สะอาดเป็น 6182 ไม่มี dance
4. Verify: MT9 log "build 6182 started" + authorized + `MQL5\Logs` ไม่ว่าง (EA แนบ) + `mt5ops status` 5/5 TTL สด (~6 นาทีรอ bridge backoff)

**ฝังกันซ้ำใน mt5update.ps1:**
- **Stale-staging purge**: ใน Watch (และหลัง Apply สำเร็จ) — purge เฉพาะเมื่อ fleet up-to-date ทุกตัว **และ** ไม่มี `mt5clw64.*` ตัวไป build > ตัวติดตั้งต่ำสุด (ไม่มี rollout ค้างอยู่ — กันลบ payload ที่กำลังโหลดใหม่)
- **Stale-updater self-heal**: ใน Watch — updater `/update` อายุ >15 นาที → kill by PID + `term start` terminal เป้าหมายจาก /path ผ่าน .lnk ของ fleet
- Parse check + commit + mirrors + CHANGELOG 8.82 + อัปเดต memory (variant: staging-state ค้างไม่ใช่แค่ payload)

**Original plan ด้านล่างคือบันทึกของรอบแรก (สำเร็จแล้ว: fleet 5/5 → 6182, watcher task ขึ้น, commit 9f70f3a push แล้ว)**

---

# MT5 auto-update maintenance — จบลูป liveupdate ที่เล่นซ้ำทุก logon

## Context

**คำถามเริ่มต้น:** "why liveupdate still there" — สแนปชอตโปรเซสของผู้ใช้เห็น terminal64.exe 4 ตัวรันจาก `%APPDATA%\MetaQuotes\Terminal\<hash>\liveupdate\`

**คำตอบ (ยืนยันจาก log + disk แล้ว):** MetaQuotes ปล่อย build 6182 (9/6 ~23:43) ทุก terminal โหลด payload ไป staging แต่**ขั้น unpack+swap ตัว terminal64.exe ล้มเหลวทุกตัวมาตั้งแต่คืนวาน** — install dirs ยังเป็น 6090/6140 (MT3 ติดลูปเดียวกันมาตั้งแต่ 6061 เดือน ก.ค. ยังเป็น 5833 เดือน เม.ย.) ส่วน MetaEditor/metatester ที่ไม่ได้รันอยู่ apply เป็น 6182 แล้ว เมื่อ swap ล้ม terminal จะ relaunch **build เก่า** พร้อม `/skipupdate:<md5>` (fallback กันลูปอนันต์) แต่ flag อยู่ได้เฉพาะตอน process รัน → **ทุก logon/reboot เล่นเพลงนี้ซ้ำ** (terminal หยุด 2–6 นาที/ตัว) และบางครั้ง `/update` copier ค้างโดยไม่ยิง fallback = account นั้นล่มเงียบ

**สถานะ ณ 2026-09-07 ~17:50 (reboot 17:41 → logon 17:41:32 → wave 17:42–17:48):**
- 4/5 accounts live (MT7 7948784, MT3 7953093, MT1 7998410, MT5 7950622 — กลับมาหลัง fallback)
- **MT9/7954220 ล่มตั้งแต่ 17:42** — updater PID 10832 ค้าง (CPU 0.8s/13 นาที = รอเฉย ๆ), fallback ไม่ยิง
- PID 2156 = staging duplicate เงาของ MT7 (ไม่ถือ session — session จริงบน PID 4168 กำลังเทรด)
- ผู้ใช้อนุมัติแล้ว: kill ทั้ง 10832 และ 2156
- Defender real-time ปิดอยู่ ไม่มี detection → root cause ของ updater apply ไม่สำเร็จ **หาไม่ได้จากนอกตัวมัน** (ไม่มี error line ใด ๆ)

**สิ่งที่ผู้ใช้สั่ง (spec):** เมื่อพบ MetaQuotes ปล่อย build ใหม่ (liveupdate staged) → kill terminal64 ทุกตัว → apply build ล่าสุดให้**ทุก terminal ที่อยู่ใน Startup folder** → เมื่อทุกตัวเป็น build ล่าสุดแล้ว → **restart เครื่อง**

**ข้อเท็จจริงที่ทำให้แผนนี้เป็นไปได้ (ตรวจแล้ว):**
- `mt5clw64.6182` = ZIP ที่มี entry เดียว `terminal64.exe` 116.1 MB (header MZ) — extract แล้ว replace ได้ตรง ๆ
- ไฟล์ payload ทุก copy ตัวเดียวกัน (60,867,509 bytes) — ใช้ copy ของ terminal ใดก็ได้ ยืนยันด้วย Authenticode signature
- Fleet จาก Startup .lnk: Airisa=MT3(5833), Eak=MT7(6140), Jade=MT5(6140), Man=MT1(6090), Mos=MT9(6140) — ทั้งหมด `/portable`
- Hash↔install จาก origin.txt: MT3=328A1AA6 (มี payload 6061 เก่า), MT5=E23367DD, MT1=A1BF25CE, MT7=B6208585, MT9=98E94DB0 (มี 6182 ครบ)
- MT8/MT12/MT20 = install เก่าไม่อยู่ใน Startup → **out of scope ไม่แตะ**
- `pythonw.exe` มี; hidden-powershell wrapper เป็น pattern ที่เคยใช้กับ analytic-bridge task

## Implementation

### 1. สคริปต์ใหม่ `C:\analytic\.claude\skills\vps-ops\scripts\mt5update.ps1` (repo = source of truth)

PowerShell (ต้องใช้ `Get-AuthenticodeSignature`, `VersionInfo`, `ZipFile` แบบ native) — โครงสร้าง:

- **`-Mode Detect`** (default, read-only): fleet = Startup .lnk ที่ TargetPath leaf = `terminal64.exe` → อ่าน FileVersion ปัจจุบันแต่ละตัว → สแกน `%APPDATA%\MetaQuotes\Terminal\*\liveupdate\mt5clw64.<N>` ทั้งหมด → target = max N → รายงาน: ตัวไป behind, ตัวได้ payload ครบ, rogue processes, สรุป "PENDING <N>" / "UP-TO-DATE"
- **`-Mode Apply -Confirm`**: ลำดับ (gate ก่อน kill เสมอ):
  1. ตรวจ completeness: มี payload ของ target build (verified) และทุกตัวที่ behind พร้อม — ไม่ครบ = exit "retry later"
  2. สแนป `python mt5ops.py status` ลง log (บันทึก pos= ต่อ account ก่อน kill — best-effort)
  3. Kill **ทุก** terminal64.exe แบบ enumerate-PID (WM_CLOSE รอ 20s ก่อน → `/F` เหลือช้า — rogue updater/staging dup โดนรวมอัตโนมัติ; **ห้าม `taskkill /IM`**)
  4. ต่อ terminal: extract entry `terminal64.exe` จาก payload ZIP ไป temp → gate 2 ชั้น: `Get-AuthenticodeSignature` = Valid + signer MetaQuotes **และ** FileVersion = target → ผ่านแล้วจึง: backup `<install>\terminal64.exe` → `terminal64.exe.bak-<oldbuild>` → ทับด้วยตัวใหม่ → verify FileVersion
  5. **ตัวใดไม่ผ่าน gate = rollback ทั้ง fleet** (คืน backup ทุกตัว) + term start ทุกตัวผ่าน .lnk + เขียน fail marker + exit 1 **ไม่ reboot**
  6. สำเร็จ + `-Reboot` → log + `shutdown /r /t 30` / ไม่มี `-Reboot` → term start ทุกตัวผ่าน .lnk + รายงาน "reboot recommended"
- **`-Mode Watch -Confirm -Reboot`**: single-shot ต่อการถูกเรียก (task repeat เป็นตัววน) = Detect → ถ้า PENDING และ complete ให้ Apply; ถ้ามี fail marker (`C:\analytic\logs\mt5update\FAILED`) อยู่ → ปฏิเสธ auto-run จน operator เคลียร์ (กัน retry loop รายชั่วโมงที่ทำ terminal ตกทุกชั่วโมง)
- Log: `C:\analytic\logs\mt5update\mt5update.log` (ตรวจ git-ignore ก่อนใช้; runtime state ห้ามเนื้อ repo)

### 2. รัน manual ครั้งแรกวันนี้ (ไม่ใส่ -Reboot)

`Detect` ก่อน (พิสูจน์ output) → `Apply -Confirm`:
- kill ทุก terminal64 รวม PID 10832 (MT9 updater ค้าง) + 2156 (MT7 phantom) — ครอบคลุมสิ่งที่ผู้ใช้อนุมัติแล้ว
- apply 6182 ให้ครบ 5/5 (MT3 กระโดด 5833→6182 ด้วย payload ที่ verified — jump upgrade เป็นพฤติกรรมปกติของ liveupdate, มี backup คืนได้)
- term start ทุกตัว → MT9 กลับมา → bridge reattach (~5-6 นาที)
- การ reboot วันนี้: ทำเป็นขั้นสุดท้ายแยกต่างหาก — ถาม operator ยืนยัน "save work แล้ว" ก่อนพิมพ์ shutdown (session นี้และ RDP จะตาย)

### 3. ลงทะเบียน scheduled task `analytic-mt5-update-watch`

- Trigger: ONLOGON + repeat ทุก 1 ชั่วโมง (author ผ่าน task XML + `schtasks /Create /XML` — deterministic กว่า flag)
- Principal: `analyticvps\supachai`, HIGHEST, console session (เหมือน analytic-bridge — ต้องเป็นเจ้าของ terminal จึง kill/start ผ่าน .lnk ได้)
- Action: `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\analytic\.claude\skills\vps-ops\scripts\mt5update.ps1 -Mode Watch -Confirm -Reboot` (pattern เดียวกับ bridge task; **ห้าม wscript launcher**)
- พฤติกรรม: MetaQuotes ปล่อย build ใหม่ → terminal โหลด payload (ภายใน ~90s หลัง start หรือ retry รายชั่วโมง) → watcher เห็นชุดครบ → kill all → apply → verify → reboot เครื่องเอง → ทุกอย่างกลับมาเองหลัง reboot (terminals ผ่าน Startup .lnk, bridge/redis-keepalive ผ่าน ONLOGON, NSSM services auto)
- เงื่อนไขที่ยอมรับ (เอาไว้ใน log + doc): ตอน kill ถ้ามี position เปิดอยู่ จะอยู่ server-side ไร้ EA ดูแล ~3–5 นาทีจนกว่า terminal กลับมา; watcher เก็บสแนป pos= ลง log ก่อน kill ทุกครั้ง

### 4. Docs + memory + commit

- `.claude/skills/vps-ops/references/mt5ops.md`: section ใหม่ "mt5update — liveupdate maintenance" + row ใน SKILL.md routing/triggers
- Sync mirrors ตาม INSTALL.md (`C:\Users\supachai\.agents\skills\vps-ops\` + hermes copy) — repo เป็นต้นทางเดียว
- อัปเดต auto-memory `mt5-liveupdate-kills-terminals-at-logon.md`: กลไกเต็ม (staging layout, `/skipupdate` อยู่แค่ตอนรัน, ลูปทุก logon ตราบใด pending, updater-hang variant, payload = single-entry ZIP)
- `node .claude/skills/docs-sync/scripts/docs-impact.mjs` → CHANGELOG entry + version bump (x.x) ใน commit เดียว — **push ต่อเมื่อผู้ใช้ยืนยัน version**

## ขอบเขต/กติกาความปลอดภัย

- **ห้ามแตะ** MT8/MT12/MT20 (ไม่อยู่ใน Startup), DuckDNS.lnk, bridge task, บริการ NSSM ใด ๆ
- Signature+version gate ก่อนแตะทุกไฟล์; backup ทุกตัว; rollback อัตโนมัติเมื่อมีตัวใด fail
- Fail marker กัน watcher วน retry รายชั่วโมง; kill แบบ enumerate-PID เท่านั้น
- งานนี้เป็นบน pod เดียว ไม่มีการแกะ/เพิ่มน้ำหนัก mt5ops.py เดิม (สคริปต์ใหม่แยก)

## Verification

1. `mt5update.ps1 -Mode Detect` ก่อน/หลัง: ก่อน = PENDING 6182 (5 behind รวม MT3), หลัง = UP-TO-DATE
2. หลัง Apply: `(Get-Item C:\MT*\terminal64.exe).VersionInfo.FileVersion` = 6182 ครบ 5 ตัว (เช็คเฉพาะ 5 ตัวใน fleet)
3. `python .claude\skills\vps-ops\scripts\mt5ops.py status` → exit 0, terminals 5/5 running, TTL สดครบ รวม 7954220 (MT9), ไม่เหลือโปรเซส terminal64 นอก install dirs
4. Log terminal แต่ละตัว: "MetaTrader 5 x64 build 6182 started" + EA `Quantum Queen MT5` loaded + authorized
5. `schtasks /Query /TN analytic-mt5-update-watch` = Ready; ทดสอบ `schtasks /Run` แล้ว log แสดง "nothing to do / UP-TO-DATE" (ไม่ kill ไม่ reboot)
6. รัน `mt5ops.py status` ซ้ำ ~6 นาทีหลัง apply (รอ bridge warmup) ก่อนประกาศสำเร็จ
