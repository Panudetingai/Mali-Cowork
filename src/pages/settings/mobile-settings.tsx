/**
 * Settings → Mobile: use Mali from a phone. Made for anyone: turn it on,
 * scan the code with the phone's camera, tap Allow. Everything technical
 * (how phones are let in, the certificate, your own domain) waits under
 * Advanced, already set to the safe choice.
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "@/features/i18n";
import {
  allowRemoteIp,
  dismissPendingRemoteIp,
  refreshRemoteStatus,
  removeRemoteDomain,
  renewRemoteDomain,
  resetRemoteToken,
  revokeRemoteIp,
  setMaliDomain,
  setRemoteAutoAllowIps,
  setRemoteEnabled,
  setRemoteIpAllowlist,
  setupRemoteDomain,
  useRemoteEnabled,
  useRemoteError,
  useRemoteStatus,
  type RemoteStatus,
} from "@/features/remote";
import { cn } from "@/lib/utils";
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  GlobeIcon,
  LaptopIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  TabletIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { encode } from "uqr";
import { Field, Notice, SecretInput, SectionHeader, Segmented, SettingRow, SettingsPage, StatusPill } from "./ui";

/** Addresses change with the network; the page keeps up while it's open. */
const REFRESH_MS = 10_000;

const STRINGS = {
  en: {
    title: "Mobile",
    subtitle: "Use Mali from your phone: see what it's doing, allow or stop it, and chat — no app to install.",
    offTitle: "Use Mali from your phone",
    offBody: "Your phone opens Mali in its browser. It stays private: only phones you allow, only on your own Wi-Fi.",
    turnOn: "Turn on",
    turnOff: "Turn off phone access",
    preparing: "Getting a secure link ready…",
    preparingBody: "This takes about a minute the first time.",
    showAnyway: "Show the code now",
    connected: (n: number) => (n === 1 ? "Phone connected" : `${n} phones connected`),
    waiting: "Waiting for your phone",
    step1: "Open the Camera on your phone and point it at the code.",
    step2: "If asked here, tap Allow.",
    step3: "On the phone: Share → Add to Home Screen, to open it like an app.",
    sameWifi: "Your phone needs to be on the same Wi-Fi as this computer.",
    warnOnce: "Your phone may show a security warning once on this link. That's expected — continue to the site.",
    copyLink: "Copy link",
    copied: "Copied",
    askTitle: "A phone wants to connect",
    askBody: "Only allow it if it's yours.",
    allow: "Allow",
    notMine: "Not mine",
    phones: "Your phones",
    remove: "Remove",
    safeTitle: "Private and secure",
    safeBody: "Only phones you allow, only on your network, always encrypted. Nothing goes through the internet.",
    advanced: "Advanced",
    askFirst: "Ask before a new phone connects",
    askFirstBody: "Recommended. Having the code isn't enough — you approve each phone here.",
    secureLink: "Secure link (no warning on the phone)",
    newCode: "New pairing code",
    newCodeBody: "Disconnects every phone. Use it if someone else saw the code.",
    reset: "Reset",
    links: "Links",
    awake: "Keep this computer on and awake while you use Mali from your phone.",
    fingerprint: "Certificate fingerprint (SHA-256)",
    couldntStart: "Phone access couldn't start",
    secureShort: "Secure",
  },
  th: {
    title: "มือถือ",
    subtitle: "ใช้ Mali จากมือถือ: ดูว่ากำลังทำอะไร อนุญาตหรือหยุดงาน และแชท — ไม่ต้องลงแอป",
    offTitle: "ใช้ Mali จากมือถือ",
    offBody: "มือถือเปิด Mali ผ่านเบราว์เซอร์ได้เลย ปลอดภัย: ใช้ได้เฉพาะมือถือที่คุณอนุญาต และเฉพาะใน Wi-Fi ของคุณ",
    turnOn: "เปิดใช้งาน",
    turnOff: "ปิดการใช้จากมือถือ",
    preparing: "กำลังเตรียมลิงก์ที่ปลอดภัย…",
    preparingBody: "ครั้งแรกใช้เวลาประมาณ 1 นาที",
    showAnyway: "แสดง QR เลย",
    connected: (n: number) => (n === 1 ? "มือถือเชื่อมต่อแล้ว" : `เชื่อมต่อ ${n} เครื่อง`),
    waiting: "รอมือถือเชื่อมต่อ",
    step1: "เปิดกล้องบนมือถือ แล้วส่องที่ QR นี้",
    step2: "ถ้ามีถามที่หน้านี้ ให้กด “อนุญาต”",
    step3: "บนมือถือ: กดแชร์ → “เพิ่มไปยังหน้าจอโฮม” จะได้เปิดเหมือนแอป",
    sameWifi: "มือถือต้องต่อ Wi-Fi เดียวกับคอมเครื่องนี้",
    warnOnce: "มือถืออาจขึ้นคำเตือนความปลอดภัยครั้งแรกกับลิงก์นี้ เป็นเรื่องปกติ — กดเข้าเว็บต่อได้เลย",
    copyLink: "คัดลอกลิงก์",
    copied: "คัดลอกแล้ว",
    askTitle: "มีมือถือขอเชื่อมต่อ",
    askBody: "อนุญาตเฉพาะเมื่อเป็นมือถือของคุณ",
    allow: "อนุญาต",
    notMine: "ไม่ใช่ของฉัน",
    phones: "มือถือของคุณ",
    remove: "เอาออก",
    safeTitle: "ปลอดภัยและเป็นส่วนตัว",
    safeBody: "ใช้ได้เฉพาะมือถือที่คุณอนุญาต เฉพาะในเครือข่ายของคุณ และเข้ารหัสเสมอ ข้อมูลไม่ผ่านอินเทอร์เน็ต",
    advanced: "ขั้นสูง",
    askFirst: "ถามก่อนทุกครั้งที่มีมือถือใหม่",
    askFirstBody: "แนะนำให้เปิดไว้ — มี QR อย่างเดียวเข้าไม่ได้ ต้องให้คุณกดอนุญาตที่นี่",
    secureLink: "ลิงก์ปลอดภัย (มือถือไม่ขึ้นคำเตือน)",
    newCode: "สร้างรหัสจับคู่ใหม่",
    newCodeBody: "มือถือทุกเครื่องจะถูกตัดการเชื่อมต่อ ใช้เมื่อมีคนอื่นเห็น QR",
    reset: "รีเซ็ต",
    links: "ลิงก์",
    awake: "เปิดคอมเครื่องนี้ไว้และไม่ให้เครื่องหลับ ระหว่างใช้ Mali จากมือถือ",
    fingerprint: "ลายนิ้วมือ certificate (SHA-256)",
    couldntStart: "เปิดการใช้จากมือถือไม่สำเร็จ",
    secureShort: "ปลอดภัย",
  },
};
type Strings = (typeof STRINGS)["en"];

export function MobileSettings() {
  const { lang } = useTranslation();
  const s: Strings = lang === "th" ? STRINGS.th : STRINGS.en;
  const enabled = useRemoteEnabled();
  const status = useRemoteStatus();
  const error = useRemoteError();
  const [advanced, setAdvanced] = useState(false);

  const preparing = isPreparing(status);
  useEffect(() => {
    void refreshRemoteStatus().catch(() => undefined);
    if (!enabled) return;
    // While the secure link is on its way, follow it closely.
    const timer = setInterval(() => void refreshRemoteStatus().catch(() => undefined), preparing ? 2000 : REFRESH_MS);
    return () => clearInterval(timer);
  }, [enabled, preparing]);

  const running = enabled && !!status?.running;
  const pending = status?.pendingIps ?? [];
  const allowed = status?.allowedIps ?? [];
  const label = (ip: string) => status?.deviceLabels?.[ip] ?? (lang === "th" ? "อุปกรณ์" : "Device");

  return (
    <SettingsPage>
      <SectionHeader title={s.title} description={s.subtitle} />

      {!enabled && (
        <div className="flex flex-col items-center gap-4 rounded-2xl border bg-card px-6 py-10 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-muted [&_svg]:size-7">
            <SmartphoneIcon />
          </span>
          <div className="flex max-w-sm flex-col gap-1.5">
            <h3 className="text-lg font-semibold tracking-tight">{s.offTitle}</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">{s.offBody}</p>
          </div>
          <Button size="lg" className="mt-1 min-w-40" onClick={() => void setRemoteEnabled(true)}>
            {s.turnOn}
          </Button>
        </div>
      )}

      {enabled && (
        <div className="flex flex-col gap-4 pb-6">
          {error && (
            <Notice tone="danger" title={s.couldntStart}>
              {error}
            </Notice>
          )}

          {pending.map((ip) => (
            <div key={ip} className="flex flex-col gap-4 rounded-2xl border-2 border-foreground bg-card p-5 sm:flex-row sm:items-center">
              <DeviceIcon label={label(ip)} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{s.askTitle}</p>
                <p className="text-sm text-muted-foreground">
                  {label(ip)} · {ip} · {s.askBody}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => void dismissPendingRemoteIp(ip)}>
                  {s.notMine}
                </Button>
                <Button onClick={() => void allowRemoteIp(ip)}>
                  <CheckIcon /> {s.allow}
                </Button>
              </div>
            </div>
          ))}

          {running && status && <ConnectCard status={status} s={s} />}

          {allowed.length > 0 && (
            <div className="rounded-2xl border bg-card p-5">
              <p className="mb-2 text-sm font-semibold">{s.phones}</p>
              <div className="flex flex-col divide-y">
                {allowed.map((ip) => (
                  <div key={ip} className="flex items-center gap-3 py-2.5">
                    <DeviceIcon label={label(ip)} small />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{label(ip)}</p>
                      <p className="text-xs text-muted-foreground">{ip}</p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => void revokeRemoteIp(ip)}>
                      {s.remove}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => setAdvanced((v) => !v)}
            className="flex items-center gap-3 rounded-2xl border bg-card p-5 text-left transition-colors hover:bg-muted/40"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted [&_svg]:size-5">
              <ShieldCheckIcon />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{s.safeTitle}</span>
              <span className="block text-[13px] leading-relaxed text-muted-foreground">{s.safeBody}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1 text-[13px] text-muted-foreground">
              {s.advanced}
              <ChevronDownIcon className={cn("size-4 transition-transform", advanced && "rotate-180")} />
            </span>
          </button>

          {advanced && status && <Advanced status={status} s={s} />}

          <div className="flex justify-center pt-2">
            <Button variant="ghost" className="text-muted-foreground" onClick={() => void setRemoteEnabled(false)}>
              {s.turnOff}
            </Button>
          </div>
        </div>
      )}
    </SettingsPage>
  );
}

/** The secure (no-warning) link is still being set up, and will be soon. */
function isPreparing(status: RemoteStatus | null) {
  if (!status?.running || status.addresses.some((a) => a.kind === "domain")) return false;
  if (!status.maliAvailable || status.maliDomainOff || status.domainError) return false;
  if (status.domain?.provider === "cloudflare") return status.domain.state === "working";
  return status.domainRegistering || !status.domain || status.domain.state === "working";
}

function DeviceIcon({ label, small }: { label: string; small?: boolean }) {
  const Icon = /iPad|tablet/i.test(label) ? TabletIcon : /Mac|PC/.test(label) ? LaptopIcon : SmartphoneIcon;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl bg-muted",
        small ? "size-9 [&_svg]:size-4" : "size-11 [&_svg]:size-5",
      )}
    >
      <Icon />
    </span>
  );
}

/** The code to scan, and three plain steps. Waits for the secure link when one is on its way. */
function ConnectCard({ status, s }: { status: RemoteStatus; s: Strings }) {
  const [showAnyway, setShowAnyway] = useState(false);
  const [copied, setCopied] = useState(false);
  const trusted = status.addresses.find((a) => a.kind === "domain");
  const address = trusted ?? status.addresses.find((a) => a.kind === "lan") ?? status.addresses[0];
  const preparing = isPreparing(status) && !showAnyway;
  const connected = status.clients > 0;

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the code is still there.
    }
  };

  return (
    <div className="rounded-2xl border bg-card p-5 sm:p-6">
      <div className="mb-5 flex justify-end">
        <StatusPill tone={connected ? "success" : "pending"}>{connected ? s.connected(status.clients) : s.waiting}</StatusPill>
      </div>
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
        <div className="flex size-52 shrink-0 items-center justify-center rounded-2xl border bg-white p-2">
          {preparing ? (
            <div className="flex flex-col items-center gap-3 px-4 text-center">
              <span className="size-6 animate-spin rounded-full border-2 border-black/15 border-t-black" />
              <p className="text-sm font-medium text-black">{s.preparing}</p>
              <p className="text-xs text-black/60">{s.preparingBody}</p>
            </div>
          ) : address ? (
            <QrCode text={address.url} />
          ) : null}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <ol className="flex flex-col gap-3">
            {[s.step1, s.step2, s.step3].map((step, i) => (
              <li key={step} className="flex gap-3 text-sm leading-relaxed">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
                  {i + 1}
                </span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
          <p className="text-[13px] leading-relaxed text-muted-foreground">{s.sameWifi}</p>
          {!preparing && address && !trusted && <p className="text-[13px] leading-relaxed text-amber-700 dark:text-amber-400">{s.warnOnce}</p>}
          <div className="flex flex-wrap gap-2">
            {preparing ? (
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setShowAnyway(true)}>
                {s.showAnyway}
              </Button>
            ) : (
              address && (
                <Button size="sm" variant="outline" onClick={() => void copy()}>
                  {copied ? <CheckIcon /> : <CopyIcon />} {copied ? s.copied : s.copyLink}
                </Button>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Everything technical, already set to the safe choice. */
function Advanced({ status, s }: { status: RemoteStatus; s: Strings }) {
  const askFirst = status.ipAllowlistEnabled && !status.autoAllowNewIps;
  const setAskFirst = async (on: boolean) => {
    await setRemoteIpAllowlist(true);
    await setRemoteAutoAllowIps(!on);
  };
  return (
    <div className="flex flex-col gap-4 rounded-2xl border bg-card p-5">
      <div className="flex flex-col divide-y">
        <SettingRow
          htmlFor="remote-ask-first"
          label={s.askFirst}
          description={s.askFirstBody}
          control={<Switch id="remote-ask-first" checked={askFirst} onCheckedChange={(on) => void setAskFirst(on)} />}
        />
        <SettingRow
          label={s.newCode}
          description={s.newCodeBody}
          control={
            <Button size="sm" variant="outline" onClick={() => void resetRemoteToken()}>
              {s.reset}
            </Button>
          }
        />
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold">{s.secureLink}</p>
        <DomainSetup status={status} />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold">{s.links}</p>
        {status.addresses.map((a) => (
          <div key={a.url} className="flex items-center gap-2 text-[13px]">
            <span className="w-24 shrink-0 text-muted-foreground">
              {a.kind === "domain" ? s.secureShort : a.kind === "tailscale" ? "Tailscale" : "Wi-Fi"}
            </span>
            <code className="min-w-0 flex-1 truncate font-mono text-xs">{a.url.replace(/#t=.*/, "")}</code>
          </div>
        ))}
        {status.certFingerprint && !status.addresses.some((a) => a.kind === "domain") && (
          <div className="flex flex-col gap-1 pt-2">
            <span className="text-[13px] text-muted-foreground">{s.fingerprint}</span>
            <code className="rounded-lg bg-muted/50 px-2.5 py-1.5 font-mono text-[11px] break-all">{status.certFingerprint}</code>
          </div>
        )}
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">{s.awake}</p>
    </div>
  );
}

const DOMAIN_STRINGS = {
  en: {
    tokenSteps: [
      "Cloudflare dashboard → My Profile → API Tokens → Create Token.",
      "Pick the “Edit zone DNS” template.",
      "Zone Resources: Include → Specific zone → your domain. Nothing else.",
      "Create, then copy the token here. Mali keeps it in the Keychain.",
    ],
    aboutMali: "This computer gets its own name with a free certificate, so the phone opens Mali without any warning. The name only points at this computer; the phone still talks to it directly.",
    aboutOwn: "Use a name you own on Cloudflare, like mali.example.com. Mali gets it a free certificate and points it at this computer; the phone still talks to it directly.",
    registering: "Getting a name for this computer…",
    registeringBody: "Registering with Mali DNS, then asking Let's Encrypt for the certificate. About a minute.",
    regFailed: "Couldn't get a name",
    tryAgain: "Try again",
    maliName: "Free Mali name",
    maliOff: "Off. Turn it on and the phone won't warn about the certificate.",
    turnOn: "Turn on",
    useOwnInstead: "Use my own domain instead",
    domainName: "Domain name",
    domainHint: "A name just for this, e.g. mali.example.com. Mali creates its DNS record.",
    token: "Cloudflare API token",
    tokenPlaceholder: "Token with Zone → DNS → Edit",
    pointAt: "Point it at",
    wifiAddr: "Wi-Fi address",
    tsAddr: "Tailscale address",
    checking: "Checking…",
    save: "Save",
    setUp: "Set up",
    cancel: "Cancel",
    leaves: "What leaves your network: the name's DNS record (it holds this computer's local address, which nobody outside can reach) and the Let's Encrypt check every couple of months. Chats never do. If the phone can't find the name, your router may block local addresses in DNS (“DNS rebinding protection”): allow the name there.",
    maliLabel: "Free Mali name · automatic",
    ownLabel: "Your domain",
    pointsAt: (ip: string, net: string) => `Points at ${ip} (${net})`,
    validUntil: (d: string) => ` · certificate valid until ${d}, renews itself`,
    gettingCert: "Getting the certificate…",
    gettingCertBody: "Proving the name to Let's Encrypt through a temporary DNS record. About a minute.",
    certFailed: "The certificate didn't come through",
    tokenMissing: "The Cloudflare token is missing",
    tokenMissingBody: "Enter it again so Mali can renew the certificate and follow this computer's address.",
    renew: "Renew now",
    useOwn: "Use my own domain",
    change: "Change",
    turnOff: "Turn off",
    remove: "Remove",
    trusted: "Trusted",
    working: "Getting certificate",
    needsToken: "Token needed",
    failed: "Failed",
  },
  th: {
    tokenSteps: [
      "Cloudflare dashboard → My Profile → API Tokens → Create Token",
      "เลือก template “Edit zone DNS”",
      "Zone Resources: Include → Specific zone → โดเมนของคุณ (ไม่ต้องเลือกอย่างอื่น)",
      "กด Create แล้ว copy token มาวางที่นี่ — Mali เก็บไว้ใน Keychain",
    ],
    aboutMali: "คอมเครื่องนี้ได้ชื่อของตัวเองพร้อม certificate ฟรี มือถือจึงเปิด Mali ได้โดยไม่มีคำเตือน ชื่อนี้ชี้มาที่คอมเครื่องนี้เท่านั้น และมือถือยังคุยกับคอมโดยตรง",
    aboutOwn: "ใช้ชื่อในโดเมนของคุณบน Cloudflare เช่น mali.example.com แล้ว Mali จะขอ certificate ฟรีและชี้ชื่อมาที่คอมเครื่องนี้ มือถือยังคุยกับคอมโดยตรง",
    registering: "กำลังขอชื่อให้คอมเครื่องนี้…",
    registeringBody: "ลงทะเบียนกับ Mali DNS แล้วขอ certificate จาก Let's Encrypt ใช้เวลาประมาณ 1 นาที",
    regFailed: "ขอชื่อไม่สำเร็จ",
    tryAgain: "ลองอีกครั้ง",
    maliName: "ชื่อฟรีจาก Mali",
    maliOff: "ปิดอยู่ — เปิดแล้วมือถือจะไม่ขึ้นคำเตือน certificate",
    turnOn: "เปิด",
    useOwnInstead: "ใช้โดเมนของฉันเองแทน",
    domainName: "ชื่อโดเมน",
    domainHint: "ชื่อที่ใช้เฉพาะงานนี้ เช่น mali.example.com — Mali จะสร้าง DNS record ให้",
    token: "Cloudflare API token",
    tokenPlaceholder: "Token ที่มีสิทธิ์ Zone → DNS → Edit",
    pointAt: "ชี้ไปที่",
    wifiAddr: "IP ของ Wi-Fi",
    tsAddr: "IP ของ Tailscale",
    checking: "กำลังตรวจสอบ…",
    save: "บันทึก",
    setUp: "ตั้งค่า",
    cancel: "ยกเลิก",
    leaves: "สิ่งที่ออกนอกเครือข่าย: DNS record ของชื่อนี้ (เก็บ IP ภายในบ้าน ซึ่งคนนอกเข้าไม่ได้) และการตรวจของ Let's Encrypt ทุก 2–3 เดือน ข้อมูลแชทไม่ออกไปเลย ถ้ามือถือหาชื่อไม่เจอ router อาจบล็อก IP ภายในใน DNS (“DNS rebinding protection”) ให้อนุญาตชื่อนี้ใน router",
    maliLabel: "ชื่อฟรีจาก Mali · อัตโนมัติ",
    ownLabel: "โดเมนของคุณ",
    pointsAt: (ip: string, net: string) => `ชี้ไปที่ ${ip} (${net})`,
    validUntil: (d: string) => ` · certificate ใช้ได้ถึง ${d} และต่ออายุเอง`,
    gettingCert: "กำลังขอ certificate…",
    gettingCertBody: "กำลังยืนยันชื่อกับ Let's Encrypt ผ่าน DNS record ชั่วคราว ใช้เวลาประมาณ 1 นาที",
    certFailed: "ขอ certificate ไม่สำเร็จ",
    tokenMissing: "ไม่พบ Cloudflare token",
    tokenMissingBody: "ใส่ token อีกครั้ง เพื่อให้ Mali ต่ออายุ certificate และอัปเดต IP ของคอมได้",
    renew: "ต่ออายุตอนนี้",
    useOwn: "ใช้โดเมนของฉันเอง",
    change: "เปลี่ยน",
    turnOff: "ปิด",
    remove: "เอาออก",
    trusted: "ปลอดภัย",
    working: "กำลังขอ certificate",
    needsToken: "ต้องใส่ token",
    failed: "ไม่สำเร็จ",
  },
};
type DomainStrings = (typeof DOMAIN_STRINGS)["en"];

function useDomainStrings(): DomainStrings {
  const { lang } = useTranslation();
  return lang === "th" ? DOMAIN_STRINGS.th : DOMAIN_STRINGS.en;
}

/**
 * No certificate warning on the phone: a free name from Mali DNS (automatic),
 * or the user's own domain on Cloudflare. Either way the name points at this
 * computer and gets a Let's Encrypt certificate whose key stays here.
 */
function DomainSetup({ status }: { status: RemoteStatus }) {
  const d = useDomainStrings();
  const domain = status.domain;
  const tailscale = status.addresses.some((a) => a.kind === "tailscale");
  const [ownForm, setOwnForm] = useState(false);
  const [hostname, setHostname] = useState(domain?.provider === "cloudflare" ? domain.hostname : "");
  const [token, setToken] = useState("");
  const [pointTo, setPointTo] = useState<"lan" | "tailscale">(domain?.pointTo ?? "lan");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A name and a certificate take a minute or so: follow them while on their way.
  const pending = domain?.state === "working" || status.domainRegistering;
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void refreshRemoteStatus().catch(() => undefined), 2000);
    return () => clearInterval(timer);
  }, [pending]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const submit = () =>
    run(async () => {
      await setupRemoteDomain(hostname, token, pointTo);
      setToken("");
      setOwnForm(false);
    });

  const own = domain?.provider === "cloudflare";
  const showForm = ownForm || (own && domain.state === "needsToken") || (!domain && !status.maliAvailable);

  return (
    <div className="flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {status.maliAvailable ? d.aboutMali : d.aboutOwn}
        </p>
        {domain && (
          <span className="shrink-0">
            <DomainPill state={domain.state} />
          </span>
        )}
      </div>
      {domain && !ownForm && (
        <DomainCard
          domain={domain}
          busy={busy}
          onRenew={() => void renewRemoteDomain()}
          onOwn={() => setOwnForm(true)}
          onOff={() => void run(() => (own ? removeRemoteDomain() : setMaliDomain(false)))}
        />
      )}

      {!domain && status.maliAvailable && !ownForm && (
        <div className="flex flex-col gap-3 py-3.5">
          {status.domainRegistering ? (
            <Notice tone="info" title={d.registering}>
              {d.registeringBody}
            </Notice>
          ) : status.domainError ? (
            <Notice
              tone="danger"
              title={d.regFailed}
              action={
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => setMaliDomain(true))}>
                  {d.tryAgain}
                </Button>
              }
            >
              {status.domainError}
            </Notice>
          ) : (
            <SettingRow
              icon={<GlobeIcon />}
              label={d.maliName}
              description={d.maliOff}
              control={
                <Button size="sm" disabled={busy} onClick={() => void run(() => setMaliDomain(true))}>
                  {d.turnOn}
                </Button>
              }
            />
          )}
          <button type="button" className="self-start text-[13px] text-muted-foreground underline underline-offset-4" onClick={() => setOwnForm(true)}>
            {d.useOwnInstead}
          </button>
        </div>
      )}

      {showForm && (
        <div className="flex flex-col gap-4 py-3.5">
          <Field label={d.domainName} htmlFor="remote-domain" hint={d.domainHint}>
            <Input
              id="remote-domain"
              value={hostname}
              placeholder="mali.example.com"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setHostname(e.target.value)}
              className="h-10 font-mono text-sm"
            />
          </Field>
          <Field label={d.token} htmlFor="remote-cf-token" error={error}>
            <SecretInput id="remote-cf-token" value={token} placeholder={d.tokenPlaceholder} onChange={(e) => setToken(e.target.value)} />
          </Field>
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-[13px] leading-relaxed text-muted-foreground">
            {d.tokenSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {tailscale && (
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold">{d.pointAt}</span>
              <Segmented
                label={d.pointAt}
                value={pointTo}
                onChange={setPointTo}
                options={[
                  { value: "lan", label: d.wifiAddr },
                  { value: "tailscale", label: d.tsAddr },
                ]}
              />
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" disabled={busy || !hostname.trim() || !token.trim()} onClick={() => void submit()}>
              {busy ? d.checking : own ? d.save : d.setUp}
            </Button>
            {ownForm && (
              <Button size="sm" variant="ghost" onClick={() => setOwnForm(false)}>
                {d.cancel}
              </Button>
            )}
          </div>
        </div>
      )}
      {error && !showForm && (
        <div className="py-2">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
      <p className="pt-1 text-xs leading-relaxed text-muted-foreground">{d.leaves}</p>
    </div>
  );
}

function DomainCard({
  domain,
  busy,
  onRenew,
  onOwn,
  onOff,
}: {
  domain: NonNullable<RemoteStatus["domain"]>;
  busy: boolean;
  onRenew: () => void;
  onOwn: () => void;
  onOff: () => void;
}) {
  const d = useDomainStrings();
  const mali = domain.provider === "mali";
  const expires = domain.expiresAt ? new Date(domain.expiresAt).toLocaleDateString() : null;
  return (
    <div className="flex flex-col gap-3 py-3.5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/70 [&_svg]:size-4">
          <GlobeIcon />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[12px] font-medium text-muted-foreground">{mali ? d.maliLabel : d.ownLabel}</span>
          <span className="truncate font-mono text-sm font-medium">{domain.hostname}</span>
          <span className="text-[13px] text-muted-foreground">
            {d.pointsAt(domain.ip ?? "…", domain.pointTo === "tailscale" ? "Tailscale" : "Wi-Fi")}
            {expires && d.validUntil(expires)}
          </span>
        </div>
      </div>
      {domain.state === "working" && (
        <Notice tone="info" title={d.gettingCert}>
          {d.gettingCertBody}
        </Notice>
      )}
      {domain.state === "error" && domain.error && (
        <Notice tone="danger" title={d.certFailed}>
          {domain.error}
        </Notice>
      )}
      {domain.state === "needsToken" && (
        <Notice tone="warning" title={d.tokenMissing}>
          {d.tokenMissingBody}
        </Notice>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy || domain.state === "working"} onClick={onRenew}>
          {d.renew}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onOwn}>
          {mali ? d.useOwn : d.change}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onOff}>
          {mali ? d.turnOff : d.remove}
        </Button>
      </div>
    </div>
  );
}

function DomainPill({ state }: { state: NonNullable<RemoteStatus["domain"]>["state"] }) {
  const d = useDomainStrings();
  if (state === "ready") return <StatusPill tone="success">{d.trusted}</StatusPill>;
  if (state === "working") return <StatusPill tone="pending">{d.working}</StatusPill>;
  if (state === "needsToken") return <StatusPill tone="warning">{d.needsToken}</StatusPill>;
  return <StatusPill tone="danger">{d.failed}</StatusPill>;
}

/** Drawn from the code's own modules, so no markup is injected. */
function QrCode({ text }: { text: string }) {
  const { size, path } = useMemo(() => {
    const qr = encode(text, { border: 2, ecc: "M" });
    let d = "";
    qr.data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { size: qr.size, path: d };
  }, [text]);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Pairing QR code"
      shapeRendering="crispEdges"
      className="size-44 shrink-0 rounded-xl border bg-white p-1"
    >
      <path d={path} fill="#000" />
    </svg>
  );
}
