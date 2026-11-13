//! Runtime configuration, under the names the .NET host read so that `.env`, the container image and Key
//! Vault need no change: `ConnectionStrings__Calendar`, `Auth__Google__ClientId`, `Auth__Google__ClientSecret`,
//! `Auth__AllowedEmails__N`, `Auth__DevSeedKey`, `ASPNETCORE_ENVIRONMENT` and `ASPNETCORE_URLS`.
//! Names are matched ignoring case, as .NET configuration keys are.
//!
//! `Auth__Google__AuthorizationEndpoint`, `Auth__Google__TokenEndpoint`, `Auth__Google__UserInfoEndpoint` and
//! `Auth__Google__Issuer` point sign-in at a stub OpenID Connect provider (ADR-0064). They are honoured only in
//! Development and only for loopback URLs: any other use stops the API at startup.

use std::collections::BTreeMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::path::PathBuf;

use crate::text::{is_blank, ordinal_ignore_case_eq, utf16_len};

/// The shortest `Auth__DevSeedKey` the API starts with.
pub const MINIMUM_SEED_KEY_LENGTH: usize = 32;

/// Where the API listens when `ASPNETCORE_URLS` is not set.
pub const DEFAULT_URLS: &str = "http://localhost:5041";

/// A configuration the API refuses to start with.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ConfigError {
  /// `Auth__DevSeedKey` is set in Development but too short to be a secret.
  #[error("Auth:DevSeedKey must be at least 32 characters.")]
  SeedKeyTooShort,
  /// An entry of `ASPNETCORE_URLS` is not `http://host:port`.
  #[error("ASPNETCORE_URLS entry '{0}' is not supported: expected http://host:port")]
  UnsupportedUrl(String),
  /// A Google endpoint or issuer override is set outside Development (ADR-0064).
  #[error("{0} points sign-in away from Google and is honoured only when ASPNETCORE_ENVIRONMENT is Development.")]
  GoogleOverrideOutsideDevelopment(&'static str),
  /// A Google endpoint or issuer override is not an `http(s)` URL on a loopback host (ADR-0064).
  #[error("{0} must be an http(s) URL on localhost, 127.0.0.1 or [::1].")]
  GoogleOverrideNotLoopback(&'static str),
}

/// Development-only replacements for Google's endpoints and issuer, which point sign-in at a stub provider on
/// this machine (ADR-0064). Each set value replaces only its own field.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GoogleOverrides {
  /// `Auth__Google__AuthorizationEndpoint`.
  pub authorization_endpoint: Option<String>,
  /// `Auth__Google__TokenEndpoint`.
  pub token_endpoint: Option<String>,
  /// `Auth__Google__UserInfoEndpoint`.
  pub user_info_endpoint: Option<String>,
  /// `Auth__Google__Issuer`: the only issuer accepted in the ID token when set.
  pub issuer: Option<String>,
}

impl GoogleOverrides {
  /// The set overrides with their setting names, in a fixed order.
  pub fn entries(&self) -> impl Iterator<Item = (&'static str, &str)> {
    [
      ("Auth__Google__AuthorizationEndpoint", &self.authorization_endpoint),
      ("Auth__Google__TokenEndpoint", &self.token_endpoint),
      ("Auth__Google__UserInfoEndpoint", &self.user_info_endpoint),
      ("Auth__Google__Issuer", &self.issuer),
    ]
    .into_iter()
    .filter_map(|(name, value)| value.as_deref().map(|value| (name, value)))
  }

  /// Whether any override is set.
  pub fn any(&self) -> bool {
    self.entries().next().is_some()
  }
}

/// Whether `value` is an `http` or `https` URL whose host is exactly `localhost`, `127.0.0.1` or `::1`.
fn is_loopback_url(value: &str) -> bool {
  let Ok(url) = reqwest::Url::parse(value.trim()) else {
    return false;
  };
  if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() || url.password().is_some() {
    return false;
  }
  // The parser lower-cases domains and normalises IP addresses, so `127.1` is `127.0.0.1` here.
  matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
}

/// The Google OAuth client the API signs people in with.
#[derive(Clone, PartialEq, Eq)]
pub struct GoogleCredentials {
  /// `Auth__Google__ClientId`.
  pub client_id: String,
  /// `Auth__Google__ClientSecret`.
  pub client_secret: String,
}

impl std::fmt::Debug for GoogleCredentials {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.debug_struct("GoogleCredentials")
      .field("client_id", &self.client_id)
      .field("client_secret", &"<redacted>")
      .finish()
  }
}

/// Everything the API reads from its environment.
#[derive(Clone, PartialEq, Eq)]
pub struct Settings {
  /// `ASPNETCORE_ENVIRONMENT`; `Production` when unset.
  pub environment: String,
  /// `ConnectionStrings__Calendar` in Npgsql keyword form, or `None`: a host without one still starts and
  /// serves health, and fails the requests that need the database.
  pub connection_string: Option<String>,
  /// The Google client, when both its id and secret are set.
  pub google: Option<GoogleCredentials>,
  /// `Auth__AllowedEmails__N`, in index order, as written.
  pub allowed_emails: Vec<String>,
  /// `Auth__DevSeedKey`, when it is set. It only authenticates in Development.
  pub dev_seed_key: Option<String>,
  /// `ASPNETCORE_URLS`.
  pub urls: String,
  /// The folder of the web app's static files: `ASPNETCORE_WEBROOT`, else `wwwroot` in the working directory.
  pub web_root: PathBuf,
  /// `ASPNETCORE_HTTPS_PORT`: the port plain-HTTP requests are redirected to outside Development. Without it
  /// there is no redirect, as in ASP.NET Core when it cannot tell the HTTPS port.
  pub https_port: Option<u16>,
  /// The Development-only Google endpoint and issuer overrides (ADR-0064).
  pub google_overrides: GoogleOverrides,
}

impl std::fmt::Debug for Settings {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.debug_struct("Settings")
      .field("environment", &self.environment)
      .field("connection_string", &self.connection_string.as_ref().map(|_| "<redacted>"))
      .field("google", &self.google)
      .field("allowed_emails", &self.allowed_emails)
      .field("dev_seed_key", &self.dev_seed_key.as_ref().map(|_| "<redacted>"))
      .field("urls", &self.urls)
      .field("web_root", &self.web_root)
      .field("https_port", &self.https_port)
      .field("google_overrides", &self.google_overrides)
      .finish()
  }
}

impl Default for Settings {
  fn default() -> Self {
    Self::from_vars(std::iter::empty::<(String, String)>())
  }
}

impl Settings {
  /// Reads the process environment.
  pub fn from_env() -> Self {
    Self::from_vars(std::env::vars())
  }

  /// Reads settings from `NAME`/value pairs named like environment variables (`Auth__Google__ClientId`).
  pub fn from_vars<K: AsRef<str>, V: Into<String>>(vars: impl IntoIterator<Item = (K, V)>) -> Self {
    let vars: BTreeMap<String, String> = vars
      .into_iter()
      .map(|(name, value)| (name.as_ref().to_ascii_uppercase(), value.into()))
      .collect();
    let get = |name: &str| vars.get(&name.to_ascii_uppercase()).cloned();
    let non_blank = |name: &str| get(name).filter(|value| !is_blank(Some(value)));

    let mut allowed: Vec<(u32, String)> = vars
      .iter()
      .filter_map(|(name, value)| {
        let index = name.strip_prefix("AUTH__ALLOWEDEMAILS__")?.parse().ok()?;
        Some((index, value.clone()))
      })
      .collect();
    allowed.sort_by_key(|(index, _)| *index);

    let google = match (non_blank("Auth__Google__ClientId"), non_blank("Auth__Google__ClientSecret")) {
      (Some(client_id), Some(client_secret)) => Some(GoogleCredentials { client_id, client_secret }),
      _ => None,
    };

    Self {
      environment: non_blank("ASPNETCORE_ENVIRONMENT")
        .or_else(|| non_blank("DOTNET_ENVIRONMENT"))
        .unwrap_or_else(|| "Production".to_owned()),
      connection_string: non_blank("ConnectionStrings__Calendar"),
      google,
      allowed_emails: allowed.into_iter().map(|(_, email)| email).collect(),
      dev_seed_key: non_blank("Auth__DevSeedKey"),
      urls: non_blank("ASPNETCORE_URLS").unwrap_or_else(|| DEFAULT_URLS.to_owned()),
      web_root: non_blank("ASPNETCORE_WEBROOT").map_or_else(|| PathBuf::from("wwwroot"), PathBuf::from),
      https_port: non_blank("ASPNETCORE_HTTPS_PORT").and_then(|port| port.trim().parse().ok()),
      google_overrides: GoogleOverrides {
        authorization_endpoint: non_blank("Auth__Google__AuthorizationEndpoint"),
        token_endpoint: non_blank("Auth__Google__TokenEndpoint"),
        user_info_endpoint: non_blank("Auth__Google__UserInfoEndpoint"),
        issuer: non_blank("Auth__Google__Issuer"),
      },
    }
  }

  /// Whether the environment is `Development`.
  pub fn is_development(&self) -> bool {
    self.environment.eq_ignore_ascii_case("Development")
  }

  /// Whether the Development seed scheme authenticates requests: only in Development, with a key set.
  pub fn seed_enabled(&self) -> bool {
    self.is_development() && self.dev_seed_key.is_some()
  }

  /// Refuses a configuration the API must not start with.
  pub fn validate(&self) -> Result<(), ConfigError> {
    if self.seed_enabled()
      && self
        .dev_seed_key
        .as_deref()
        .is_some_and(|key| utf16_len(key) < MINIMUM_SEED_KEY_LENGTH)
    {
      return Err(ConfigError::SeedKeyTooShort);
    }
    for (name, value) in self.google_overrides.entries() {
      if !self.is_development() {
        return Err(ConfigError::GoogleOverrideOutsideDevelopment(name));
      }
      if !is_loopback_url(value) {
        return Err(ConfigError::GoogleOverrideNotLoopback(name));
      }
    }
    self.listen_addresses().map(|_| ())
  }

  /// The first allow-listed email, trimmed, or `None` when the allow-list is empty. The Development seed
  /// scheme acts as this person, and they may claim the legacy placeholder user (ADR-0041).
  pub fn first_allowed_email(&self) -> Option<&str> {
    self.allowed_emails.iter().map(|entry| entry.trim()).find(|entry| !entry.is_empty())
  }

  /// Whether a Google account may sign in: its email must be verified and on the allow-list, ignoring case.
  pub fn is_allowed(&self, email: Option<&str>, verified: bool) -> bool {
    is_allowed(email, verified, &self.allowed_emails)
  }

  /// The socket addresses of `ASPNETCORE_URLS` (`;`-separated `http://host:port`). `+`, `*` and `0.0.0.0`
  /// listen on every interface, `localhost` on both loopback addresses.
  pub fn listen_addresses(&self) -> Result<Vec<SocketAddr>, ConfigError> {
    let mut addresses = Vec::new();
    for url in self.urls.split(';').map(str::trim).filter(|url| !url.is_empty()) {
      let unsupported = || ConfigError::UnsupportedUrl(url.to_owned());
      let rest = url
        .get(..7)
        .filter(|scheme| scheme.eq_ignore_ascii_case("http://"))
        .map(|_| &url[7..]);
      let authority = rest.ok_or_else(unsupported)?.trim_end_matches('/');
      let (host, port) = match authority.rsplit_once(':') {
        Some((host, port)) if !port.contains(']') => (host, port.parse::<u16>().map_err(|_| unsupported())?),
        _ => (authority, 80),
      };
      match host {
        "+" | "*" | "0.0.0.0" => addresses.push(SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), port)),
        "[::]" => addresses.push(SocketAddr::new(IpAddr::V6(Ipv6Addr::UNSPECIFIED), port)),
        host if host.eq_ignore_ascii_case("localhost") => {
          addresses.push(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port));
          addresses.push(SocketAddr::new(IpAddr::V6(Ipv6Addr::LOCALHOST), port));
        }
        host => {
          let ip: IpAddr = host
            .trim_start_matches('[')
            .trim_end_matches(']')
            .parse()
            .map_err(|_| unsupported())?;
          addresses.push(SocketAddr::new(ip, port));
        }
      }
    }
    if addresses.is_empty() {
      return Err(ConfigError::UnsupportedUrl(self.urls.clone()));
    }
    Ok(addresses)
  }
}

/// Whether `email` may sign in: verified, not blank, and equal to an `allowed` entry ignoring case
/// (`ApiAuthentication.IsAllowed`).
pub fn is_allowed(email: Option<&str>, verified: bool, allowed: &[String]) -> bool {
  match email {
    Some(email) if verified && !is_blank(Some(email)) => allowed.iter().any(|entry| ordinal_ignore_case_eq(entry, email)),
    _ => false,
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn names_are_the_dotnet_ones_and_match_ignoring_case() {
    let settings = Settings::from_vars([
      ("ASPNETCORE_ENVIRONMENT", "development"),
      ("ConnectionStrings__Calendar", "Host=db"),
      ("AUTH__GOOGLE__CLIENTID", "id"),
      ("Auth__Google__ClientSecret", "secret"),
      ("Auth__AllowedEmails__10", "ten@example.com"),
      ("Auth__AllowedEmails__2", " Two@Example.com "),
      ("Auth__AllowedEmails__0", " "),
      ("Auth__DevSeedKey", "12345678901234567890123456789012"),
      ("ASPNETCORE_URLS", "http://+:8080"),
    ]);
    assert!(settings.is_development());
    assert_eq!(settings.connection_string.as_deref(), Some("Host=db"));
    assert_eq!(settings.google.as_ref().map(|google| google.client_id.as_str()), Some("id"));
    assert_eq!(settings.allowed_emails, [" ", " Two@Example.com ", "ten@example.com"]);
    assert_eq!(settings.first_allowed_email(), Some("Two@Example.com"));
    assert!(settings.seed_enabled());
    assert_eq!(settings.validate(), Ok(()));
    assert_eq!(settings.listen_addresses().unwrap(), ["0.0.0.0:8080".parse().unwrap()]);
  }

  #[test]
  fn defaults_are_production_without_database_google_or_seed() {
    let settings = Settings::default();
    assert_eq!(settings.environment, "Production");
    assert!(!settings.is_development());
    assert_eq!(settings.connection_string, None);
    assert_eq!(settings.google, None);
    assert_eq!(settings.first_allowed_email(), None);
    assert!(!settings.seed_enabled());
    assert_eq!(settings.web_root, PathBuf::from("wwwroot"));
    assert_eq!(
      settings.listen_addresses().unwrap(),
      ["127.0.0.1:5041".parse().unwrap(), "[::1]:5041".parse().unwrap()]
    );
  }

  #[test]
  fn google_needs_both_values_and_blank_counts_as_unset() {
    let settings = Settings::from_vars([
      ("Auth__Google__ClientId", "id"),
      ("Auth__Google__ClientSecret", "  "),
      ("ConnectionStrings__Calendar", ""),
    ]);
    assert_eq!(settings.google, None);
    assert_eq!(settings.connection_string, None);
  }

  #[test]
  fn a_short_seed_key_is_refused_only_where_it_would_be_used() {
    let short = |environment: &str| Settings::from_vars([("ASPNETCORE_ENVIRONMENT", environment), ("Auth__DevSeedKey", "short")]);
    assert_eq!(short("Development").validate(), Err(ConfigError::SeedKeyTooShort));
    assert_eq!(short("Production").validate(), Ok(()));
    assert!(!short("Production").seed_enabled());
  }

  #[test]
  fn only_verified_allowed_emails_pass() {
    let allowed = ["user@example.com".to_owned()];
    assert!(is_allowed(Some("USER@example.com"), true, &allowed));
    assert!(!is_allowed(Some("other@example.com"), true, &allowed));
    assert!(!is_allowed(Some("user@example.com"), false, &allowed));
    assert!(!is_allowed(None, true, &allowed));
  }

  #[test]
  fn urls_must_be_plain_http() {
    let with = |urls: &str| Settings::from_vars([("ASPNETCORE_URLS", urls)]).listen_addresses();
    assert_eq!(with("http://127.0.0.1:55041").unwrap(), ["127.0.0.1:55041".parse().unwrap()]);
    assert_eq!(
      with("http://*:80;http://[::]:81/").unwrap(),
      ["0.0.0.0:80".parse().unwrap(), "[::]:81".parse().unwrap()]
    );
    assert!(matches!(with("https://localhost:5001"), Err(ConfigError::UnsupportedUrl(_))));
    assert!(matches!(with("http://example.com:80"), Err(ConfigError::UnsupportedUrl(_))));
  }

  const OVERRIDES: [&str; 4] = [
    "Auth__Google__AuthorizationEndpoint",
    "Auth__Google__TokenEndpoint",
    "Auth__Google__UserInfoEndpoint",
    "Auth__Google__Issuer",
  ];

  fn with_override(environment: &str, name: &str, value: &str) -> Settings {
    Settings::from_vars([("ASPNETCORE_ENVIRONMENT", environment), (name, value)])
  }

  #[test]
  fn without_google_overrides_google_is_used_everywhere() {
    for environment in ["Production", "Staging", "Development"] {
      let settings = Settings::from_vars([("ASPNETCORE_ENVIRONMENT", environment), ("Auth__Google__Issuer", " ")]);
      assert_eq!(settings.google_overrides, GoogleOverrides::default());
      assert!(!settings.google_overrides.any());
      assert_eq!(settings.validate(), Ok(()));
    }
  }

  #[test]
  fn google_overrides_are_read_ignoring_case() {
    let settings = Settings::from_vars([
      ("ASPNETCORE_ENVIRONMENT", "Development"),
      ("AUTH__GOOGLE__AUTHORIZATIONENDPOINT", "http://127.0.0.1:55280/google/authorize"),
      ("auth__google__tokenendpoint", "http://localhost:55280/google/token"),
      ("Auth__Google__UserInfoEndpoint", "http://[::1]:55280/google/userinfo"),
      ("Auth__Google__Issuer", "http://127.0.0.1:55280/google"),
    ]);
    assert_eq!(
      settings.google_overrides,
      GoogleOverrides {
        authorization_endpoint: Some("http://127.0.0.1:55280/google/authorize".to_owned()),
        token_endpoint: Some("http://localhost:55280/google/token".to_owned()),
        user_info_endpoint: Some("http://[::1]:55280/google/userinfo".to_owned()),
        issuer: Some("http://127.0.0.1:55280/google".to_owned()),
      }
    );
    assert_eq!(settings.validate(), Ok(()));
  }

  #[test]
  fn a_google_override_outside_development_is_refused() {
    for name in OVERRIDES {
      for environment in ["Production", "Staging", "Test", "Developmen"] {
        assert_eq!(
          with_override(environment, name, "http://127.0.0.1:55280/google").validate(),
          Err(ConfigError::GoogleOverrideOutsideDevelopment(name)),
          "{name} in {environment}"
        );
      }
      // No environment at all is Production.
      assert_eq!(
        Settings::from_vars([(name, "http://127.0.0.1:55280/google")]).validate(),
        Err(ConfigError::GoogleOverrideOutsideDevelopment(name))
      );
    }
  }

  #[test]
  fn a_google_override_on_a_non_loopback_host_is_refused_even_in_development() {
    for name in OVERRIDES {
      for value in [
        "https://accounts.google.com",
        "https://oauth2.googleapis.com/token",
        "http://stub.example.com:8080/google",
        "http://10.0.0.5:8080/google",
        "http://127.0.0.2:8080/google",
        "http://0.0.0.0:8080/google",
        "http://localhost.example.com/google",
        "http://user@localhost:8080/google",
        "ftp://127.0.0.1/google",
        "127.0.0.1:8080/google",
        "/google",
        "not a url",
      ] {
        assert_eq!(
          with_override("Development", name, value).validate(),
          Err(ConfigError::GoogleOverrideNotLoopback(name)),
          "{name} = {value}"
        );
      }
      for value in [
        "http://localhost:8080/google",
        "HTTP://LOCALHOST/google",
        "https://127.0.0.1/google",
        "http://[::1]:8080",
      ] {
        assert_eq!(with_override("development", name, value).validate(), Ok(()), "{name} = {value}");
      }
    }
  }

  #[test]
  fn the_refusals_name_the_setting() {
    assert_eq!(
      ConfigError::GoogleOverrideOutsideDevelopment("Auth__Google__Issuer").to_string(),
      "Auth__Google__Issuer points sign-in away from Google and is honoured only when ASPNETCORE_ENVIRONMENT is Development."
    );
    assert_eq!(
      ConfigError::GoogleOverrideNotLoopback("Auth__Google__TokenEndpoint").to_string(),
      "Auth__Google__TokenEndpoint must be an http(s) URL on localhost, 127.0.0.1 or [::1]."
    );
  }
}
