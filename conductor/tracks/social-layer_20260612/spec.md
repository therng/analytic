# Social Layer — Shouts & Reactions

## Summary

เพิ่มฟีเจอร์ social เข้าไปใน dashboard เพื่อให้ผู้ใช้สามารถ "shout" ข้อความสั้น (12h ephemeral) และ react ด้วย emoji บน account cards และ shouts

## Acceptance Criteria

- [x] ผู้ใช้ sign-in ด้วย Google / Apple ได้
- [x] ผู้ใช้เลือก username ครั้งแรกหลัง sign-in
- [x] ShoutTicker แสดงที่ด้านบนของ dashboard เสมอ (แม้ไม่มี shout)
- [x] ShoutModal เปิดได้เมื่อกด ShoutTicker — แสดง feed และ compose box
- [x] POST shout ได้ (max 120 chars, expires 12h, แทนที่ shout เก่าของตัวเอง)
- [x] Real-time push ผ่าน SSE เมื่อมี shout ใหม่
- [x] EmojiReactionBar บน account card (targetType=ACCOUNT)
- [x] EmojiReactionBar บน shout ใน modal (targetType=SHOUT)
- [x] Optimistic update + revert เมื่อ reaction fail
