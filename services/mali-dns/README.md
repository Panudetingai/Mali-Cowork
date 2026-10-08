# Mali DNS

ให้ Mali ทุกเครื่องมีชื่อของตัวเองใต้โดเมนของคุณ เช่น `k3x9q2mf7a.m.example.com`
เพื่อให้รีโมตบนมือถือได้ certificate จริงจาก Let's Encrypt และไม่ขึ้นคำเตือน

ตัวนี้เป็น Cloudflare Worker ที่ถือ Cloudflare API token ไว้ที่เดียว
แต่ละเครื่องที่ลงทะเบียนจะได้ id กับรหัสลับ ซึ่งใช้ได้แค่:

- ชี้ชื่อของตัวเองไปที่ IP ในบ้านหรือ Tailscale (`10.x`, `172.16–31.x`, `192.168.x`, `100.64–127.x`) เท่านั้น ห้าม IP สาธารณะ
- ใส่และลบ TXT `_acme-challenge.<ชื่อของตัวเอง>` ตอนขอ certificate
- ลบชื่อของตัวเอง

private key ของ certificate สร้างบนเครื่องผู้ใช้และไม่เคยส่งมาที่นี่ ข้อมูลแชทไม่ผ่านที่นี่เลย

## ค่าใช้จ่าย

ใช้แพ็กเกจฟรีของ Cloudflare ได้ทั้งหมด: Workers 100,000 request/วัน, KV เขียน 1,000 ครั้ง/วัน
แต่ละเครื่องเรียกไม่กี่ครั้งต่อวัน และเขียน KV เฉพาะตอนลงทะเบียน, IP เปลี่ยน หรือสัปดาห์ละครั้ง

## Deploy (ทำครั้งเดียว)

ทำในโฟลเดอร์ `services/mali-dns`

1. **เลือกชื่อ**: แนะนำ subdomain ที่ใช้เฉพาะงานนี้ เช่น `m.example.com`
   แก้ `BASE_DOMAIN` ใน `wrangler.toml`
2. **Zone ID**: Cloudflare dashboard → โดเมนของคุณ → Overview → (แถบขวา) API → Zone ID
   ใส่ที่ `CF_ZONE_ID` ใน `wrangler.toml`
3. **ที่เก็บข้อมูลเครื่อง (KV)**:
   ```sh
   npx wrangler login
   npx wrangler kv namespace create DEVICES
   ```
   เอา `id` ที่ได้ใส่ใน `[[kv_namespaces]]` ของ `wrangler.toml`
4. **API token**: Cloudflare → My Profile → API Tokens → Create Token → template **Edit zone DNS**
   → Zone Resources: Include → Specific zone → โดเมนของคุณ → Create แล้วใส่เป็น secret
   (ไม่อยู่ในไฟล์ไหนเลย):
   ```sh
   npx wrangler secret put CF_API_TOKEN
   ```
5. **Deploy**:
   ```sh
   npx wrangler deploy
   ```
   Production API: `https://mali.dns.pndluke.com` (see `[[routes]]` in `wrangler.toml`).
   ลองเปิด `/v1/health` ดู ต้องได้ `{"ok":true,...}`

## ให้แอป Mali ใช้

ใส่ URL ของ Worker ตอน build แอป โดยสร้าง `src-tauri/.cargo/config.toml`:

```toml
[env]
MALI_DNS_SERVICE = "https://mali.dns.pndluke.com"
```

แล้ว build แอปตามปกติ ระหว่างพัฒนาจะตั้งเป็นตัวแปร environment ตอนรัน `bun tauri dev` ก็ได้
ถ้าไม่ได้ตั้งค่า แอปจะไม่แสดงตัวเลือกนี้ (ผู้ใช้ยังใช้โดเมนของตัวเองได้)

เมื่อเปิดรีโมตใน Settings → Mobile แอปจะลงทะเบียนชื่อ ขอ certificate และต่ออายุให้เองทั้งหมด
ผู้ใช้ปิดได้ที่ "No certificate warning" → Turn off

## ข้อควรรู้

- **Rate limit ของ Let's Encrypt**: ออก certificate ใหม่ได้ 50 ใบต่อสัปดาห์ต่อโดเมนหลัก (การต่ออายุไม่นับ)
  ถ้ามีผู้ใช้ใหม่เกินสัปดาห์ละ 50 คน ให้ขอเพิ่ม `m.example.com` เข้า [Public Suffix List](https://publicsuffix.org/submit/)
- **ถ้า Worker ล่ม**: เครื่องที่ใช้อยู่ยังใช้ได้จน certificate หมดอายุ (ประมาณ 90 วัน) แต่เครื่องใหม่จะลงทะเบียนไม่ได้
- **ล้างอัตโนมัติ**: เครื่องที่ไม่ติดต่อมาเกิน 120 วันจะถูกลบพร้อม DNS record (cron ทุกวัน)
- **กันการใช้ผิด**: ลงทะเบียนได้ 5 ครั้งต่อวันต่อ IP, รับเฉพาะ IP ในบ้าน, มี TXT ค้างได้สูงสุด 4 รายการต่อเครื่อง,
  เก็บรหัสลับแบบ hash (SHA-256) และไม่มี CORS (เว็บไซต์อื่นเรียกไม่ได้)
- ชื่อ subdomain จะอยู่ใน Certificate Transparency log สาธารณะ แต่เป็นชื่อสุ่ม ไม่บอกว่าเป็นของใคร

## ทดสอบ

```sh
bun test
```
