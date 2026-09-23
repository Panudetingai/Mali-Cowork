//! Making pictures and clips from a text description.
//!
//! Every provider ends at the same place — bytes plus an extension — so the
//! caller never has to know whose API answered. There is one way in
//! (`commands::media`): the user picks a model that draws, and it is called
//! over that provider's own API with the key already in Settings → Models.
//!
//! This was briefly an MCP connector as well, so an agent could draw mid-task.
//! It is not any more: the connector needed its own copy of every API key,
//! which meant entering the same Gemini key twice to do one thing, and two
//! lists of keys do not stay in step.

pub mod output;
pub mod providers;
