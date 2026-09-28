//! Thai business formats: money in words ("หนึ่งพันบาทถ้วน"), Buddhist-era
//! dates ("26 กันยายน 2569"), and amounts with separators ("1,250.50").

const DIGITS: [&str; 10] = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
const PLACES: [&str; 6] = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];
const MONTHS: [&str; 12] = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

/// Up to six digits in words. `after_higher`: a millions group came before, so
/// a lone final one reads "เอ็ด" (หนึ่งล้านเอ็ด) as cheques and banks write it.
fn group(n: u64, after_higher: bool) -> String {
    let digits: Vec<u64> = n.to_string().chars().map(|c| c.to_digit(10).unwrap() as u64).collect();
    let len = digits.len();
    let mut out = String::new();
    for (i, &d) in digits.iter().enumerate() {
        let place = len - 1 - i;
        if d == 0 {
            continue;
        }
        match place {
            0 if d == 1 && (n > 1 || after_higher) => out.push_str("เอ็ด"),
            1 if d == 1 => {}
            1 if d == 2 => out.push_str("ยี่"),
            _ => out.push_str(DIGITS[d as usize]),
        }
        out.push_str(PLACES[place]);
    }
    out
}

/// An integer in words, millions and all.
fn words(n: u64) -> String {
    if n == 0 {
        return DIGITS[0].into();
    }
    let mut groups = Vec::new();
    let mut rest = n;
    while rest > 0 {
        groups.push(rest % 1_000_000);
        rest /= 1_000_000;
    }
    let mut out = String::new();
    for (i, g) in groups.iter().enumerate().rev() {
        if *g > 0 {
            out.push_str(&group(*g, i + 1 < groups.len()));
        }
        if i > 0 {
            out.push_str("ล้าน");
        }
    }
    out
}

/// "1250.5" → "หนึ่งพันสองร้อยห้าสิบบาทห้าสิบสตางค์"; whole amounts end in "ถ้วน".
pub fn baht_text(amount: f64) -> String {
    let negative = amount < 0.0;
    let satang_total = (amount.abs() * 100.0).round() as u64;
    let (baht, satang) = (satang_total / 100, satang_total % 100);
    let mut out = String::new();
    if negative {
        out.push_str("ลบ");
    }
    if baht > 0 || satang == 0 {
        out.push_str(&words(baht));
        out.push_str("บาท");
    }
    if satang == 0 {
        out.push_str("ถ้วน");
    } else {
        out.push_str(&group(satang, false));
        out.push_str("สตางค์");
    }
    out
}

/// "1250.5" → "1,250.50".
pub fn money(amount: f64) -> String {
    let cents = (amount.abs() * 100.0).round() as u64;
    let whole = (cents / 100).to_string();
    let mut grouped = String::new();
    for (i, c) in whole.chars().enumerate() {
        if i > 0 && (whole.len() - i) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(c);
    }
    format!("{}{grouped}.{:02}", if amount < 0.0 { "-" } else { "" }, cents % 100)
}

/// A quantity without trailing zeros: "2", "1.5".
pub fn number(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{}", value as i64)
    } else {
        let s = format!("{value:.4}");
        s.trim_end_matches('0').trim_end_matches('.').to_string()
    }
}

/// Parse "1,250.50", "฿1250", "1250 บาท".
pub fn parse_amount(text: &str) -> Option<f64> {
    let cleaned: String = text.chars().filter(|c| c.is_ascii_digit() || *c == '.' || *c == '-').collect();
    cleaned.parse().ok()
}

/// `(year, month 1–12, day)` in the Gregorian calendar → "26 กันยายน 2569".
pub fn thai_date(year: i32, month: u32, day: u32) -> String {
    format!("{day} {} {}", MONTHS[(month.clamp(1, 12) - 1) as usize], year + 543)
}

/// Today on this computer's clock (local time where the OS tells us).
pub fn today() -> (i32, u32, u32) {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    #[cfg(unix)]
    let secs = {
        let t = secs as libc::time_t;
        let mut tm: libc::tm = unsafe { std::mem::zeroed() };
        if unsafe { !libc::localtime_r(&t, &mut tm).is_null() } {
            secs + tm.tm_gmtoff as i64
        } else {
            secs
        }
    };
    civil(secs.div_euclid(86_400))
}

/// Days since 1970-01-01 → (year, month, day) (Howard Hinnant's algorithm).
fn civil(days: i64) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = (yoe + era * 400 + i64::from(m <= 2)) as i32;
    (y, m, d)
}

pub fn today_thai() -> String {
    let (y, m, d) = today();
    thai_date(y, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn baht_in_words() {
        let cases = [
            (0.0, "ศูนย์บาทถ้วน"),
            (1.0, "หนึ่งบาทถ้วน"),
            (11.0, "สิบเอ็ดบาทถ้วน"),
            (21.0, "ยี่สิบเอ็ดบาทถ้วน"),
            (101.0, "หนึ่งร้อยเอ็ดบาทถ้วน"),
            (120.0, "หนึ่งร้อยยี่สิบบาทถ้วน"),
            (1000.0, "หนึ่งพันบาทถ้วน"),
            (1250.5, "หนึ่งพันสองร้อยห้าสิบบาทห้าสิบสตางค์"),
            (10_700.0, "หนึ่งหมื่นเจ็ดร้อยบาทถ้วน"),
            (1_000_000.0, "หนึ่งล้านบาทถ้วน"),
            (1_000_001.0, "หนึ่งล้านเอ็ดบาทถ้วน"),
            (21_000_000.0, "ยี่สิบเอ็ดล้านบาทถ้วน"),
            (0.25, "ยี่สิบห้าสตางค์"),
            (123_456_789.01, "หนึ่งร้อยยี่สิบสามล้านสี่แสนห้าหมื่นหกพันเจ็ดร้อยแปดสิบเก้าบาทหนึ่งสตางค์"),
        ];
        for (amount, expected) in cases {
            assert_eq!(baht_text(amount), expected, "{amount}");
        }
    }

    #[test]
    fn amounts_and_dates() {
        assert_eq!(money(1250.5), "1,250.50");
        assert_eq!(money(1_000_000.0), "1,000,000.00");
        assert_eq!(money(12.0), "12.00");
        assert_eq!(number(2.0), "2");
        assert_eq!(number(1.5), "1.5");
        assert_eq!(parse_amount("฿1,250.50"), Some(1250.5));
        assert_eq!(thai_date(2026, 9, 26), "26 กันยายน 2569");
        assert_eq!(civil(0), (1970, 1, 1));
        assert_eq!(civil(20_722), (2026, 9, 26));
    }
}
