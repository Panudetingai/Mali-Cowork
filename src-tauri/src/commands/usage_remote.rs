//! What the providers themselves say about usage, for the Usage page:
//! balances and credit limits (with the ordinary API key), organisation
//! usage and cost reports (OpenAI and Anthropic, with an admin key), and
//! per-token prices from models.dev to estimate replies that report no cost.

use std::collections::HashMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::{Client, RequestBuilder};
use serde::Serialize;
use serde_json::Value;

use crate::ai::provider_info;

const TIMEOUT: Duration = Duration::from_secs(20);
const PRICING_URL: &str = "https://models.dev/api.json";
const PRICING_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);
/// Report pages are followed at most this far; 90 days fits in three.
const MAX_PAGES: usize = 6;

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyUsage {
    /// Start of the day, Unix ms (UTC).
    pub day: i64,
    pub cost: f64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub requests: u64,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderAccount {
    pub provider: String,
    /// "credits" (spent against a limit), "balance" (prepaid money left) or
    /// "organization" (usage and cost reports).
    pub kind: &'static str,
    pub currency: String,
    pub used: Option<f64>,
    pub limit: Option<f64>,
    pub remaining: Option<f64>,
    /// Totals of `daily`, when the provider reports per-day figures.
    pub period_cost: Option<f64>,
    pub period_input_tokens: Option<u64>,
    pub period_output_tokens: Option<u64>,
    pub period_requests: Option<u64>,
    pub daily: Vec<DailyUsage>,
    /// Anything worth a line under the figures.
    pub detail: Option<String>,
}

/// Price per million tokens, USD.
#[derive(Debug, Clone, Default, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPrice {
    pub input: f64,
    pub output: f64,
    pub cache_read: Option<f64>,
    pub cache_write: Option<f64>,
}

fn client() -> Result<Client, String> {
    Client::builder()
        .timeout(TIMEOUT)
        .user_agent("MaliCowork")
        .build()
        .map_err(|e| e.to_string())
}

fn now_secs() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

/// Days since 1970-01-01 for a civil date (Howard Hinnant's algorithm).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { yoe + era * 400 + 1 } else { yoe + era * 400 }, m, d)
}

fn rfc3339_day(unix_secs: i64) -> String {
    let (y, m, d) = civil_from_days(unix_secs.div_euclid(86_400));
    format!("{y:04}-{m:02}-{d:02}T00:00:00Z")
}

/// `2026-09-01T00:00:00Z` → Unix ms of that day's start.
fn day_of_rfc3339(text: &str) -> Option<i64> {
    let date = text.get(..10)?;
    let mut parts = date.split('-').map(|p| p.parse::<i64>().ok());
    let (y, m, d) = (parts.next()??, parts.next()??, parts.next()??);
    Some(days_from_civil(y, m, d) * 86_400_000)
}

/// Providers send amounts as numbers or as decimal strings.
fn num(value: &Value) -> Option<f64> {
    value.as_f64().or_else(|| value.as_str().and_then(|s| s.trim().parse().ok()))
}

fn count(value: &Value) -> u64 {
    num(value).filter(|n| *n > 0.0).map_or(0, |n| n as u64)
}

async fn get_json(request: RequestBuilder, provider: &str) -> Result<Value, String> {
    let response = request.send().await.map_err(|e| format!("Cannot reach {provider}: {e}"))?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        let message = serde_json::from_str::<Value>(&body)
            .ok()
            .and_then(|v| {
                v["error"]["message"]
                    .as_str()
                    .or(v["error"].as_str())
                    .or(v["message"].as_str())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| body.chars().take(200).collect());
        let hint = match status.as_u16() {
            401 | 403 => " — check the key (an admin key is needed for organisation reports).",
            _ => "",
        };
        return Err(format!("{provider} answered {status}: {message}{hint}"));
    }
    serde_json::from_str(&body).map_err(|e| format!("{provider} sent something unexpected: {e}"))
}

/// The saved key, or the provider's env var (only ever sent to its own host).
fn key_or_env(provider: &str, key: Option<String>) -> Result<String, String> {
    if let Some(key) = key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty()) {
        return Ok(key);
    }
    provider_info(provider)
        .ok()
        .and_then(|info| info.env_var)
        .and_then(|var| std::env::var(var).ok())
        .map(|k| k.trim().trim_matches('"').to_string())
        .filter(|k| !k.is_empty())
        .ok_or_else(|| format!("No API key for {provider}."))
}

fn sum_daily(account: &mut ProviderAccount, with_requests: bool) {
    account.daily.sort_by_key(|d| d.day);
    account.period_cost = Some(account.daily.iter().map(|d| d.cost).sum());
    account.period_input_tokens = Some(account.daily.iter().map(|d| d.input_tokens).sum());
    account.period_output_tokens = Some(account.daily.iter().map(|d| d.output_tokens).sum());
    account.period_requests = with_requests.then(|| account.daily.iter().map(|d| d.requests).sum());
}

fn day_entry(daily: &mut HashMap<i64, DailyUsage>, day: i64) -> &mut DailyUsage {
    daily.entry(day).or_insert_with(|| DailyUsage { day, ..Default::default() })
}

async fn openrouter(key: String) -> Result<ProviderAccount, String> {
    let body = get_json(client()?.get("https://openrouter.ai/api/v1/key").bearer_auth(key), "OpenRouter").await?;
    let data = &body["data"];
    let used = num(&data["usage"]);
    let limit = num(&data["limit"]);
    let detail = [("today", "usage_daily"), ("this week", "usage_weekly"), ("this month", "usage_monthly")]
        .iter()
        .filter_map(|(label, key)| num(&data[*key]).map(|v| format!("${v:.2} {label}")))
        .collect::<Vec<_>>();
    Ok(ProviderAccount {
        provider: "openrouter".into(),
        kind: "credits",
        currency: "USD".into(),
        used,
        limit,
        remaining: num(&data["limit_remaining"]),
        detail: (!detail.is_empty()).then(|| detail.join(" · ")),
        ..Default::default()
    })
}

async fn deepseek(key: String) -> Result<ProviderAccount, String> {
    let body = get_json(client()?.get("https://api.deepseek.com/user/balance").bearer_auth(key), "DeepSeek").await?;
    let info = body["balance_infos"]
        .as_array()
        .and_then(|list| list.iter().find(|i| i["currency"] == "USD").or(list.first()))
        .ok_or("DeepSeek reported no balance.")?;
    let granted = num(&info["granted_balance"]);
    Ok(ProviderAccount {
        provider: "deepseek".into(),
        kind: "balance",
        currency: info["currency"].as_str().unwrap_or("USD").into(),
        remaining: num(&info["total_balance"]),
        detail: granted.filter(|g| *g > 0.0).map(|g| format!("includes {g:.2} granted")),
        ..Default::default()
    })
}

async fn moonshot(key: String, base_url: Option<String>) -> Result<ProviderAccount, String> {
    // The China platform bills in CNY, the international one in USD.
    let china = base_url.as_deref().is_some_and(|u| u.contains("moonshot.cn"));
    let host = if china { "https://api.moonshot.cn" } else { "https://api.moonshot.ai" };
    let body = get_json(client()?.get(format!("{host}/v1/users/me/balance")).bearer_auth(key), "Moonshot").await?;
    let data = &body["data"];
    let voucher = num(&data["voucher_balance"]);
    Ok(ProviderAccount {
        provider: "moonshotai".into(),
        kind: "balance",
        currency: if china { "CNY" } else { "USD" }.into(),
        remaining: num(&data["available_balance"]),
        detail: voucher.filter(|v| *v > 0.0).map(|v| format!("includes {v:.2} in vouchers")),
        ..Default::default()
    })
}

/// OpenAI's organisation reports: `/organization/costs` and `/organization/usage/completions`.
async fn openai(admin_key: String, days: i64) -> Result<ProviderAccount, String> {
    let client = client()?;
    let start = now_secs() - days * 86_400;
    let mut daily: HashMap<i64, DailyUsage> = HashMap::new();

    for (path, is_cost) in [("costs", true), ("usage/completions", false)] {
        let mut page: Option<String> = None;
        for _ in 0..MAX_PAGES {
            let mut request = client
                .get(format!("https://api.openai.com/v1/organization/{path}"))
                .bearer_auth(&admin_key)
                .query(&[("start_time", start.to_string()), ("bucket_width", "1d".into()), ("limit", "31".into())]);
            if let Some(page) = &page {
                request = request.query(&[("page", page)]);
            }
            let body = get_json(request, "OpenAI").await?;
            for bucket in body["data"].as_array().into_iter().flatten() {
                let day = bucket["start_time"].as_i64().unwrap_or(0).div_euclid(86_400) * 86_400_000;
                let entry = day_entry(&mut daily, day);
                for result in bucket["results"].as_array().into_iter().flatten() {
                    if is_cost {
                        entry.cost += num(&result["amount"]["value"]).unwrap_or(0.0);
                    } else {
                        entry.input_tokens += count(&result["input_tokens"]);
                        entry.output_tokens += count(&result["output_tokens"]);
                        entry.requests += count(&result["num_model_requests"]);
                    }
                }
            }
            page = body["next_page"].as_str().filter(|_| body["has_more"] == true).map(str::to_string);
            if page.is_none() {
                break;
            }
        }
    }

    let mut account = ProviderAccount {
        provider: "openai".into(),
        kind: "organization",
        currency: "USD".into(),
        daily: daily.into_values().collect(),
        detail: Some(format!("Whole organisation, last {days} days")),
        ..Default::default()
    };
    sum_daily(&mut account, true);
    Ok(account)
}

/// Anthropic's Admin API: `cost_report` and `usage_report/messages`.
async fn anthropic(admin_key: String, days: i64) -> Result<ProviderAccount, String> {
    let client = client()?;
    let starting_at = rfc3339_day(now_secs() - days * 86_400);
    let mut daily: HashMap<i64, DailyUsage> = HashMap::new();

    for (path, is_cost) in [("cost_report", true), ("usage_report/messages", false)] {
        let mut page: Option<String> = None;
        for _ in 0..MAX_PAGES {
            let mut request = client
                .get(format!("https://api.anthropic.com/v1/organizations/{path}"))
                .header("x-api-key", &admin_key)
                .header("anthropic-version", "2023-06-01")
                .query(&[("starting_at", starting_at.as_str()), ("bucket_width", "1d"), ("limit", "31")]);
            if let Some(page) = &page {
                request = request.query(&[("page", page)]);
            }
            let body = get_json(request, "Anthropic").await?;
            for bucket in body["data"].as_array().into_iter().flatten() {
                let Some(day) = bucket["starting_at"].as_str().and_then(day_of_rfc3339) else { continue };
                let entry = day_entry(&mut daily, day);
                for result in bucket["results"].as_array().into_iter().flatten() {
                    if is_cost {
                        // Reported in cents, as a decimal string.
                        entry.cost += num(&result["amount"]).unwrap_or(0.0) / 100.0;
                    } else {
                        let cache = &result["cache_creation"];
                        entry.input_tokens += count(&result["uncached_input_tokens"])
                            + count(&result["cache_read_input_tokens"])
                            + count(&cache["ephemeral_5m_input_tokens"])
                            + count(&cache["ephemeral_1h_input_tokens"]);
                        entry.output_tokens += count(&result["output_tokens"]);
                    }
                }
            }
            page = body["next_page"].as_str().filter(|_| body["has_more"] == true).map(str::to_string);
            if page.is_none() {
                break;
            }
        }
    }

    let mut account = ProviderAccount {
        provider: "anthropic".into(),
        kind: "organization",
        currency: "USD".into(),
        daily: daily.into_values().collect(),
        detail: Some(format!("Whole organisation, last {days} days")),
        ..Default::default()
    };
    // The usage report has no request count.
    sum_daily(&mut account, false);
    Ok(account)
}

/// What `provider` reports about this account. `admin_key` is only used for
/// OpenAI and Anthropic, whose reports need an organisation admin key.
#[tauri::command]
pub async fn usage_provider_account(
    provider: String,
    api_key: Option<String>,
    base_url: Option<String>,
    admin_key: Option<String>,
    days: Option<i64>,
) -> Result<ProviderAccount, String> {
    let days = days.unwrap_or(30).clamp(1, 90);
    let admin = || {
        admin_key
            .clone()
            .map(|k| k.trim().to_string())
            .filter(|k| !k.is_empty())
            .ok_or_else(|| format!("Add an admin key to read {provider}'s usage reports."))
    };
    match provider.as_str() {
        "openrouter" => openrouter(key_or_env(&provider, api_key)?).await,
        "deepseek" => deepseek(key_or_env(&provider, api_key)?).await,
        "moonshotai" => moonshot(key_or_env(&provider, api_key)?, base_url).await,
        "openai" => openai(admin()?, days).await,
        "anthropic" => anthropic(admin()?, days).await,
        _ => Err(format!("{provider} has no usage API.")),
    }
}

fn pricing_cache() -> std::path::PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("mali-cowork")
        .join("model-prices.json")
}

/// `provider/model` → price, from models.dev's catalog.
fn parse_prices(catalog: &Value) -> HashMap<String, ModelPrice> {
    let mut prices = HashMap::new();
    for (provider, entry) in catalog.as_object().into_iter().flatten() {
        for (model, info) in entry["models"].as_object().into_iter().flatten() {
            let cost = &info["cost"];
            let (Some(input), Some(output)) = (num(&cost["input"]), num(&cost["output"])) else { continue };
            prices.insert(
                format!("{provider}/{model}"),
                ModelPrice { input, output, cache_read: num(&cost["cache_read"]), cache_write: num(&cost["cache_write"]) },
            );
        }
    }
    prices
}

/// Prices are cached for a day; a stale cache beats none when offline.
#[tauri::command]
pub async fn usage_model_prices() -> Result<HashMap<String, ModelPrice>, String> {
    let path = pricing_cache();
    let cached = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice::<HashMap<String, ModelPrice>>(&b).ok());
    let fresh = std::fs::metadata(&path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok())
        .is_some_and(|age| age < PRICING_MAX_AGE);
    if let (Some(prices), true) = (&cached, fresh) {
        return Ok(prices.clone());
    }
    let fetched = async {
        let catalog = get_json(client()?.get(PRICING_URL), "models.dev").await?;
        Ok::<_, String>(parse_prices(&catalog))
    }
    .await;
    match (fetched, cached) {
        (Ok(prices), _) if !prices.is_empty() => {
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Ok(bytes) = serde_json::to_vec(&prices) {
                let _ = std::fs::write(&path, bytes);
            }
            Ok(prices)
        }
        (_, Some(prices)) => Ok(prices),
        (Err(e), None) => Err(e),
        (Ok(_), None) => Err("models.dev listed no prices.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn dates_round_trip() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(civil_from_days(days_from_civil(2026, 9, 25)), (2026, 9, 25));
        assert_eq!(rfc3339_day(0), "1970-01-01T00:00:00Z");
        assert_eq!(day_of_rfc3339("1970-01-02T00:00:00Z"), Some(86_400_000));
    }

    #[test]
    fn prices_read_models_dev_shape() {
        let catalog = json!({
            "openai": { "models": {
                "gpt-5": { "cost": { "input": 1.25, "output": 10, "cache_read": 0.125 } },
                "free-thing": {}
            } }
        });
        let prices = parse_prices(&catalog);
        assert_eq!(prices.len(), 1);
        let price = &prices["openai/gpt-5"];
        assert_eq!(price.output, 10.0);
        assert_eq!(price.cache_read, Some(0.125));
    }

    #[test]
    fn amounts_may_be_strings() {
        assert_eq!(num(&json!("12.5")), Some(12.5));
        assert_eq!(count(&json!(-3)), 0);
    }
}
