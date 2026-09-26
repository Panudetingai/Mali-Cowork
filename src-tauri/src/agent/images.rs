//! Letting a model that can see look at pictures: a file in the folder, a
//! picture on the web (a design's thumbnail, say), or one a tool returned.
//! Every picture is scaled down first, so it costs a sensible number of
//! tokens and the saved conversation stays small.

use std::io::Cursor;
use std::time::Duration;

use base64::Engine;
use serde_json::{json, Value};

use super::paths::Scope;
use super::wire::{ToolImage, ToolSpec};

/// Longest side after scaling: enough to judge a layout and read large text.
const MAX_SIDE: u32 = 1280;
const MAX_DOWNLOAD: usize = 15 * 1024 * 1024;

pub const NAME: &str = "view_image";

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: NAME.into(),
        description: "Look at a picture: a file in the working folder, or an https URL (for example a \
design's thumbnail or preview a connector returned). Use it to check which pictures fit the request and \
to review your visual work before you finish."
            .into(),
        schema: json!({
            "type": "object",
            "properties": {
                "source": { "type": "string", "description": "A file path or an https URL." }
            },
            "required": ["source"]
        }),
    }
}

/// Decode, scale down and re-encode (JPEG, or PNG when there's transparency).
pub fn prepare(bytes: &[u8]) -> Result<(ToolImage, (u32, u32)), String> {
    let picture = image::load_from_memory(bytes).map_err(|e| format!("That isn't a picture this app can read: {e}"))?;
    let original = (picture.width(), picture.height());
    let picture = if picture.width().max(picture.height()) > MAX_SIDE {
        picture.thumbnail(MAX_SIDE, MAX_SIDE)
    } else {
        picture
    };
    let mut out = Vec::new();
    let (mime, format) = if picture.color().has_alpha() {
        ("image/png", image::ImageOutputFormat::Png)
    } else {
        ("image/jpeg", image::ImageOutputFormat::Jpeg(85))
    };
    let picture = if mime == "image/jpeg" { image::DynamicImage::ImageRgb8(picture.to_rgb8()) } else { picture };
    picture.write_to(&mut Cursor::new(&mut out), format).map_err(|e| e.to_string())?;
    Ok((ToolImage { mime: mime.into(), data: base64::engine::general_purpose::STANDARD.encode(out) }, original))
}

/// A picture an MCP tool returned as base64.
pub fn from_base64(data: &str) -> Option<ToolImage> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(data.trim()).ok()?;
    prepare(&bytes).ok().map(|(image, _)| image)
}

async fn download(url: &str) -> Result<Vec<u8>, String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "That isn't a valid URL.".to_string())?;
    if parsed.scheme() != "https" {
        return Err("Only https:// pictures can be opened.".into());
    }
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("mali-cowork")
        .build()
        .map_err(|e| e.to_string())?
        .get(parsed)
        .send()
        .await
        .map_err(|e| format!("Couldn't download it: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("The link answered {}.", response.status()));
    }
    if response.content_length().is_some_and(|n| n as usize > MAX_DOWNLOAD) {
        return Err("That picture is larger than 15 MB.".into());
    }
    let bytes = response.bytes().await.map_err(|e| format!("Couldn't download it: {e}"))?;
    if bytes.len() > MAX_DOWNLOAD {
        return Err("That picture is larger than 15 MB.".into());
    }
    Ok(bytes.to_vec())
}

/// Run `view_image`: the picture, and a line describing it for the model.
pub async fn view(args: &Value, scope: Option<&Scope>) -> Result<(String, ToolImage), String> {
    let source = args["source"].as_str().or_else(|| args["path"].as_str()).or_else(|| args["url"].as_str()).unwrap_or_default().trim();
    if source.is_empty() {
        return Err("Say which picture to look at (a file path or an https URL).".into());
    }
    let (bytes, shown) = if source.starts_with("http://") || source.starts_with("https://") {
        (download(source).await?, source.split('?').next().unwrap_or(source).to_string())
    } else {
        let scope = scope.ok_or("There are no files to look at in Chat mode; pass an https URL.")?;
        let path = scope.resolve(source, false)?;
        let bytes = std::fs::read(&path).map_err(|e| format!("Can't read {}: {e}", path.display()))?;
        (bytes, scope.show(&path))
    };
    let (image, (w, h)) = prepare(&bytes)?;
    Ok((format!("Showing {shown} ({w}×{h}px)."), image))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(w: u32, h: u32) -> Vec<u8> {
        let mut out = Vec::new();
        image::DynamicImage::ImageRgb8(image::RgbImage::new(w, h))
            .write_to(&mut Cursor::new(&mut out), image::ImageOutputFormat::Png)
            .unwrap();
        out
    }

    #[test]
    fn big_pictures_are_scaled_down() {
        let (image, original) = prepare(&png(4000, 2000)).unwrap();
        assert_eq!(original, (4000, 2000));
        assert_eq!(image.mime, "image/jpeg");
        let bytes = base64::engine::general_purpose::STANDARD.decode(&image.data).unwrap();
        let back = image::load_from_memory(&bytes).unwrap();
        assert_eq!(back.width(), MAX_SIDE);
        assert_eq!(back.height(), MAX_SIDE / 2);
    }

    #[test]
    fn not_a_picture_is_an_error() {
        assert!(prepare(b"hello").is_err());
    }

    #[tokio::test]
    async fn views_a_file_in_the_folder_and_nothing_outside() {
        let dir = std::env::temp_dir().join(format!("mali-view-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.png"), png(10, 10)).unwrap();
        let scope = Scope::new(dir.to_str().unwrap(), &[]).unwrap();
        let (text, image) = view(&json!({"source": "a.png"}), Some(&scope)).await.unwrap();
        assert!(text.contains("a.png (10×10px)"));
        assert!(!image.data.is_empty());
        assert!(view(&json!({"source": "/etc/hosts"}), Some(&scope)).await.is_err());
        assert!(view(&json!({"source": "http://example.com/a.png"}), Some(&scope)).await.is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}
