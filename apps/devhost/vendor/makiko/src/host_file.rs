//! Support for OpenSSH-compatible `known_hosts` file.

use base64::Engine as _;
use bytes::{Bytes, BytesMut};
use hmac::Mac as _;
use rand::RngCore as _;
use std::str;
use crate::pubkey::Pubkey;
use crate::util::base64_encode;

/// Representation of an OpenSSH-compatible `known_hosts` file.
///
/// This file stores information about host keys. It is a list of entries, where each entry has a
/// hostname and a public key. The hostname can be represented in plaintext (`example.com`), as a
/// plaintext pattern (`*.examp?e.com`), as a list of such patterns (`example.com,github.com`) or
/// in a hashed format that hides the hostname (`|1|kRjF0OC...`).
///
/// You can iterate over all entries using [`entries()`][Self::entries()], or you can use
/// [`match_hostname_key()`][Self::match_hostname_key()]/[`match_host_port_key()`][Self::match_host_port_key()]
/// to lookup the entries that either accept or revoke a given combination of host and key.
///
/// You can also append new entries to the file using [`append_entry()`][Self::append_entry()]. In
/// this way, it is possible to update the `known_hosts` file with new keys, without touching the
/// previous entries (all previous lines will be preserved verbatim, including comments and invalid
/// lines).
#[derive(Debug, Clone)]
#[cfg_attr(test, derive(PartialEq))]
pub struct File {
    lines: Vec<Line>,
}

#[derive(Debug, Clone)]
#[cfg_attr(test, derive(PartialEq))]
struct Line {
    bytes: Bytes,
    content: LineContent,
}

#[derive(Debug, Clone)]
#[cfg_attr(test, derive(PartialEq))]
enum LineContent {
    Comment,
    Entry(Box<Entry>),
    Error,
}

/// An entry in [`File`].
///
/// The entry constains a hostname pattern and a public key assigned to that hostname.
#[derive(Debug, Clone)]
#[cfg_attr(test, derive(PartialEq))]
pub struct Entry {
    line_i: usize,
    marker: Option<Marker>,
    pattern: Pattern,
    key: Pubkey,
    key_comment: Option<String>,
}

/// Builder that can be used to add [entries][Entry] to a [`File`].
///
/// You can obtain an instance of the builder using [`File::entry_builder()`].
#[derive(Debug, Clone)]
pub struct EntryBuilder {
    is_revoked: bool,
    hashed_hostnames: Vec<String>,
    plaintext_hostnames: Vec<String>,
    keys: Vec<Pubkey>,
}

#[derive(Debug, Copy, Clone)]
#[cfg_attr(test, derive(PartialEq))]
enum Marker {
    CertAuthority,
    Revoked,
}

#[derive(Debug, Clone)]
#[cfg_attr(test, derive(PartialEq))]
enum Pattern {
    Hashed(HashedPattern),
    List(Vec<PlaintextPattern>),
}

#[derive(Debug, Clone)]
#[cfg_attr(test, derive(PartialEq))]
struct HashedPattern {
    salt: Vec<u8>,
    hash: Vec<u8>,
}

#[derive(Debug, Clone)]
struct PlaintextPattern {
    is_negated: bool,
    regex: regex::Regex,
    pattern: String,
}

/// A match returned by [`File::match_hostname_key()`].
#[derive(Debug, Clone)]
pub enum KeyMatch<'e> {
    /// The key was accepted for this hostname.
    ///
    /// The `Vec` lists the entries that match the hostname and the key, it is always non-empty.
    // TODO: rename this to `Found`
    Accepted(Vec<&'e Entry>),

    /// The key was revoked.
    ///
    /// The `Entry` is the first revoked entry in the file that matches the hostname and the key.
    Revoked(&'e Entry),

    /// We found other keys for this hostname.
    ///
    /// The `Vec` list all non-revoked entries that match the hostname, it is always non-empty.
    OtherKeys(Vec<&'e Entry>),

    /// No entry that matches this hostname was found.
    NotFound,
}

impl File {
    /// Parses a file in OpenSSH `known_hosts` format.
    ///
    /// This function never fails: invalid lines are silently ignored.
    pub fn decode(data: Bytes) -> Self {
        decode_file(data)
    }

    /// Creates a new empty [`File`].
    pub fn new() -> Self {
        Self { lines: Vec::new() }
    }

    /// Iterates through all entries in the file.
    ///
    /// Comments and invalid lines are not returned by this method.
    pub fn entries(&self) -> impl Iterator<Item = &Entry> {
        self.lines.iter().filter_map(|line| match &line.content {
            LineContent::Entry(entry) => Some(entry as &Entry),
            LineContent::Comment | LineContent::Error => None,
        })
    }

    /// Finds the match for the given hostname and key in this file.
    ///
    /// See [`host_port_to_hostname()`] for the format of the `hostname`; you can use
    /// [`match_host_port_key()`][Self::match_host_port_key()] to match a `(host, port)` pair.
    ///
    /// If you want more advanced processing, you can use [`entries()`][Self::entries()] to list
    /// all entries and the [`Entry::matches_hostname()`] and [`Entry::pubkey()`] methods to match
    /// them to a hostname and key.
    pub fn match_hostname_key(&self, hostname: &str, pubkey: &Pubkey) -> KeyMatch<'_> {
        let mut accepted = Vec::new();
        let mut other_keys = Vec::new();

        for entry in self.entries() {
            if !entry.matches_hostname(hostname) {
                continue
            }

            if entry.pubkey() != pubkey {
                other_keys.push(entry);
                continue
            }

            if entry.is_revoked() {
                return KeyMatch::Revoked(entry)
            } else {
                accepted.push(entry);
            }
        }

        if !accepted.is_empty() {
            KeyMatch::Accepted(accepted)
        } else if !other_keys.is_empty() {
            KeyMatch::OtherKeys(other_keys)
        } else {
            KeyMatch::NotFound
        }
    }

    /// Finds the match for the given host and port in this file.
    ///
    /// Same as [`match_hostname_key()`][Self::match_hostname_key()], but formats the host and port
    /// using [`host_port_to_hostname()`].
    pub fn match_host_port_key(&self, host: &str, port: u16, pubkey: &Pubkey) -> KeyMatch<'_> {
        self.match_hostname_key(&host_port_to_hostname(host, port), pubkey)
    }

    /// Creates an [`EntryBuilder`], which can be used to add an entry (or a set of entries) to the
    /// file (see [`append_entry()`][Self::append_entry()]).
    pub fn entry_builder() -> EntryBuilder {
        EntryBuilder::new()
    }

    /// Appends all entries from the [`EntryBuilder`] to this file.
    pub fn append_entry(&mut self, builder: &EntryBuilder) {
        for entry in builder.build(self.lines.len()) {
            self.lines.push(Line {
                bytes: encode_entry(&entry).into(),
                content: LineContent::Entry(Box::new(entry)),
            });
        }
    }

    /// Encodes this file into an OpenSSH-compatible `known_hosts` file.
    ///
    /// If the file was created using [`decode()`][Self::decode()], the original lines will be
    /// preserved verbatim, including comments and invalid lines. Entries added using
    /// [`append_entry()`][Self::append_entry()] will be appended as new lines at the end of the
    /// file.
    pub fn encode(&self) -> BytesMut {
        let mut bytes = BytesMut::new();
        for line in self.lines.iter() {
            bytes.extend_from_slice(&line.bytes);
            bytes.extend_from_slice("\n".as_bytes());
        }
        bytes
    }
}

impl Default for File {
    fn default() -> Self {
        Self::new()
    }
}

/// Converts a host and port to an OpenSSH-compatible hostname.
///
/// If the port is not 22, it returns `[host]:port`, otherwise the `host` is returned as-is.
/// `host` can be either a domain name or an IP address.
pub fn host_port_to_hostname(host: &str, port: u16) -> String {
    if port == 22 {
        host.into()
    } else {
        format!("[{}]:{}", host, port)
    }
}

impl Entry {
    /// The line number of this entry in the [`File`].
    ///
    /// Lines are counted from 1.
    pub fn line(&self) -> usize {
        self.line_i + 1
    }

    /// Has this entry been revoked using the `@revoked` marker?
    ///
    /// This signifies that the public key from this entry has been revoked for the host, so
    /// if the server provides this key, the connection should be rejected.
    pub fn is_revoked(&self) -> bool {
        matches!(self.marker, Some(Marker::Revoked))
    }

    /// The public key of this entry.
    pub fn pubkey(&self) -> &Pubkey {
        &self.key
    }

    /// The optional comment of the [public key][Self::pubkey()].
    pub fn key_comment(&self) -> Option<&str> {
        self.key_comment.as_deref()
    }

    /// Tests whether the hostname matches this entry.
    pub fn matches_hostname(&self, hostname: &str) -> bool {
        pattern_matches(&self.pattern, hostname)
    }
}

impl EntryBuilder {
    fn new() -> Self {
        EntryBuilder {
            is_revoked: false,
            hashed_hostnames: Vec::new(),
            plaintext_hostnames: Vec::new(),
            keys: Vec::new(),
        }
    }

    /// Marks the entries as revoked (using `@revoked`).
    ///
    /// This means that the given hostnames must not use the given keys.
    pub fn revoke(&mut self) -> &mut Self {
        self.is_revoked = true; self
    }

    /// Adds a given hostname in plaintext.
    ///
    /// See [`host_port_to_hostname()`] for the format of the `hostname`; you can use
    /// [`plaintext_host_port()`][Self::plaintext_host_port()] to add a `(host, port)` pair.
    ///
    /// The hostname will be added in plaintext, so anybody who has access to `known_hosts` can see
    /// which hostnames you connected to. See [`hostname()`][Self::hostname()] if you want to hide
    /// the hostname.
    pub fn plaintext_hostname(&mut self, hostname: &str) -> &mut Self {
        self.plaintext_hostnames.push(hostname.into()); self
    }

    /// Adds a given host and port in plaintext.
    ///
    /// The host and port will be added in plaintext, so anybody who has access to `known_hosts`
    /// can see which hostnames you connected to. See [`hostname()`][Self::hostname()] if you want
    /// to hide the hostname.
    pub fn plaintext_host_port(&mut self, host: &str, port: u16) -> &mut Self {
        self.plaintext_hostnames.push(host_port_to_hostname(host, port)); self
    }

    /// Adds a given hostname in a hashed form.
    ///
    /// See [`host_port_to_hostname()`] for the format of the `hostname`; you can use
    /// [`plaintext_host_port()`][Self::plaintext_host_port()] to add a `(host, port)` pair.
    ///
    /// The hostname will be stored in the file as a HMAC-SHA1 hash with a random salt. This hides
    /// the hostname if the file is disclosed.
    pub fn hostname(&mut self, hostname: &str) -> &mut Self {
        self.hashed_hostnames.push(hostname.into()); self
    }

    /// Adds a given host and port in a hashed form.
    ///
    /// The host and port will be stored in the file as a HMAC-SHA1 hash with a random salt. This
    /// hides the host and port if the file is disclosed.
    pub fn host_port(&mut self, host: &str, port: u16) -> &mut Self {
        self.hashed_hostnames.push(host_port_to_hostname(host, port)); self
    }

    /// Adds a public key.
    ///
    /// We will generate an entry for every combination of a hostname (added by
    /// [`plaintext_hostname()`][Self::plaintext_hostname()], [`hostname()`][Self::hostname()] and
    /// other methods) and a public key added by this method.
    pub fn key(&mut self, pubkey: Pubkey) -> &mut Self {
        self.keys.push(pubkey); self
    }

    fn build(&self, mut line_i: usize) -> Vec<Entry> {
        let marker = if self.is_revoked { Some(Marker::Revoked) } else { None };

        let mut entries = Vec::new();
        for key in self.keys.iter() {
            for hostname in self.hashed_hostnames.iter() {
                entries.push(Entry {
                    line_i,
                    marker,
                    pattern: Pattern::Hashed(build_hashed_pattern(hostname)),
                    key: key.clone(),
                    key_comment: None,
                });
                line_i += 1;
            }

            if !self.plaintext_hostnames.is_empty() {
                entries.push(Entry {
                    line_i,
                    marker,
                    pattern: Pattern::List(self.plaintext_hostnames.iter()
                        .map(build_plaintext_pattern)
                        .collect()),
                    key: key.clone(),
                    key_comment: None,
                });
                line_i += 1;
            }
        }
        entries
    }
}

fn pattern_matches(pattern: &Pattern, hostname: &str) -> bool {
    match pattern {
        Pattern::Hashed(pattern) => {
            let Ok(mut hmac) = hmac::Hmac::<sha1::Sha1>::new_from_slice(&pattern.salt) else {
                return false;
            };
            hmac.update(hostname.as_bytes());
            hmac.verify_slice(&pattern.hash).is_ok()
        },
        Pattern::List(patterns) => {
            let mut matches = false;
            for pattern in patterns.iter() {
                if pattern.regex.is_match(hostname) {
                    if pattern.is_negated {
                        return false
                    } else {
                        matches = true
                    }
                }
            }
            matches
        },
    }
}

fn decode_file(data: Bytes) -> File {
    let mut lines = data.split(|&b| b == b'\n')
        .enumerate()
        .map(|(line_i, bytes)| {
            let bytes = data.slice_ref(bytes);
            let content = match decode_line(&bytes, line_i) {
                Ok(content) => content,
                Err(_msg) => LineContent::Error,
            };
            Line { bytes, content }
        })
        .collect::<Vec<_>>();
    if let Some(last_line) = lines.last() {
        if last_line.bytes.is_empty() {
            lines.pop();
        }
    }
    File { lines }
}

fn decode_line(mut bytes: &[u8], line_i: usize) -> Result<LineContent, &'static str> {
    // empty lines are treated as comments
    let Some(first_field) = read_field(&mut bytes) else {
        return Ok(LineContent::Comment)
    };

    // first comes the optional marker preceded with '@'
    let (pattern_field, marker) = if first_field[0] == b'@' {
        let marker = decode_marker(first_field)?;
        let pattern_field = read_field(&mut bytes).ok_or("expected host pattern after a @-marker")?;
        (pattern_field, Some(marker))
    } else {
        (first_field, None)
    };

    // the hostname pattern
    let pattern = decode_pattern(pattern_field)?;

    // the key type...
    let key_type = read_field(&mut bytes).ok_or("expected key type after host pattern")?;
    let key_type = str::from_utf8(key_type).ok().ok_or("key type is not valid utf-8")?;

    // ...followed by base64-encoded public key
    let key_base64 = read_field(&mut bytes).ok_or("expected key data in base64 after key type")?;
    let key_blob = base64_decode(key_base64).map_err(|_| "key data is invalid base64")?;
    let key = Pubkey::decode(Bytes::copy_from_slice(&key_blob))
        .ok().ok_or("could not decode the public key")?;
    if key.type_str() != key_type {
        return Err("key type is different from the specified type");
    }

    // optional comment
    consume_whitespace(&mut bytes);
    let key_comment = match str::from_utf8(bytes) {
        Ok(comment) if !comment.is_empty() => Some(comment.to_string()),
        _ => None,
    };

    let entry = Entry { line_i, marker, pattern, key, key_comment };
    Ok(LineContent::Entry(Box::new(entry)))
}

fn encode_entry(entry: &Entry) -> String {
    let mut output = String::new();
    if let Some(marker) = entry.marker {
        encode_marker(marker, &mut output);
        output.push(' ');
    }

    encode_pattern(&entry.pattern, &mut output);
    output.push(' ');
    output.push_str(&entry.key.type_str());
    output.push(' ');
    output.push_str(&base64_encode(&entry.key.encode()));

    if let Some(comment) = &entry.key_comment {
        output.push(' ');
        output.push_str(comment);
    }

    output
}

fn decode_marker(bytes: &[u8]) -> Result<Marker, &'static str> {
    match bytes {
        b"@cert-authority" => Ok(Marker::CertAuthority),
        b"@revoked" => Ok(Marker::Revoked),
        _ => Err("unknown @-marker"),
    }
}

fn encode_marker(marker: Marker, output: &mut String) {
    match marker {
        Marker::CertAuthority => output.push_str("@cert-authority"),
        Marker::Revoked => output.push_str("@revoked"),
    }
}

fn decode_pattern(bytes: &[u8]) -> Result<Pattern, &'static str> {
    if let Some(bytes) = bytes.strip_prefix(b"|1|") {
        decode_hashed_pattern(bytes).map(Pattern::Hashed)
    } else {
        decode_list_pattern(bytes).map(Pattern::List)
    }
}

fn encode_pattern(pattern: &Pattern, output: &mut String) {
    match pattern {
        Pattern::Hashed(pattern) => encode_hashed_pattern(pattern, output),
        Pattern::List(pattern) => encode_list_pattern(pattern, output),
    }
}

fn decode_hashed_pattern(bytes: &[u8]) -> Result<HashedPattern, &'static str> {
    let mut parts = bytes.splitn(2, |&b| b == b'|');
    let salt_base64 = parts.next().ok_or("invalid format of hashed pattern")?;
    let hash_base64 = parts.next().ok_or("expected a pipe '|' in the hashed pattern")?;

    let salt = base64_decode(salt_base64).ok().ok_or("invalid base64 in the salt")?;
    let hash = base64_decode(hash_base64).ok().ok_or("invalid base64 in the hash")?;
    Ok(HashedPattern { salt, hash })
}

fn encode_hashed_pattern(pattern: &HashedPattern, output: &mut String) {
    output.push_str("|1|");
    output.push_str(&base64_encode(&pattern.salt));
    output.push('|');
    output.push_str(&base64_encode(&pattern.hash));
}

fn build_hashed_pattern(hostname: &str) -> HashedPattern {
    let mut salt = vec![0; 20];
    rand::rngs::OsRng.fill_bytes(&mut salt);
    let mut hmac = hmac::Hmac::<sha1::Sha1>::new_from_slice(&salt).unwrap();
    hmac.update(hostname.as_bytes());
    let hash = hmac.finalize().into_bytes().as_slice().into();
    HashedPattern { salt, hash }
}

fn decode_list_pattern(bytes: &[u8]) -> Result<Vec<PlaintextPattern>, &'static str> {
    bytes.split(|&b| b == b',')
        .filter(|bs| !bs.is_empty())
        .map(decode_plaintext_pattern)
        .collect()
}

fn encode_list_pattern(patterns: &[PlaintextPattern], output: &mut String) {
    for (i, pattern) in patterns.iter().enumerate() {
        if i != 0 {
            output.push(',');
        }
        encode_plaintext_pattern(pattern, output);
    }
}

fn decode_plaintext_pattern(bytes: &[u8]) -> Result<PlaintextPattern, &'static str> {
    let mut pattern = str::from_utf8(bytes).map_err(|_| "host pattern is not valid utf-8")?;

    let mut is_negated = false;
    if let Some(p) = pattern.strip_prefix('!') {
        pattern = p;
        is_negated = true;
    }

    let mut regex = String::new();
    regex.push('^');
    for c in pattern.chars() {
        match c {
            '*' => regex.push_str(".*"),
            '?' => regex.push('.'),
            c if regex_syntax::is_meta_character(c) => {
                regex.push('\\');
                regex.push(c);
            },
            c => regex.push(c),
        }
    }
    regex.push('$');

    let regex = regex::Regex::new(&regex).unwrap();
    let pattern = pattern.into();
    Ok(PlaintextPattern { is_negated, regex, pattern })
}

fn encode_plaintext_pattern(pattern: &PlaintextPattern, output: &mut String) {
    if pattern.is_negated {
        output.push('!');
    }
    output.push_str(&pattern.pattern);
}

#[allow(clippy::ptr_arg)]
fn build_plaintext_pattern(hostname: &String) -> PlaintextPattern {
    let regex = format!("^{}$", regex_syntax::escape(hostname));
    let regex = regex::Regex::new(&regex).unwrap();
    let pattern = hostname.clone();
    PlaintextPattern { is_negated: false, regex, pattern }
}

fn read_field<'b>(bytes: &mut &'b [u8]) -> Option<&'b [u8]> {
    consume_whitespace(bytes);

    // '#' starts a comment, which should be ignored
    if matches!(bytes.first(), None | Some(b'#')) {
        return None
    }

    let mut field_len = 1;
    while field_len < bytes.len() {
        if bytes[field_len].is_ascii_whitespace() {
            break;
        }
        field_len += 1;
    }

    let field = &bytes[..field_len];
    *bytes = &bytes[field_len..];
    Some(field)
}

fn consume_whitespace(bytes: &mut &[u8]) {
    let mut white_len = 0;
    while white_len < bytes.len() && bytes[white_len].is_ascii_whitespace() {
        white_len += 1;
    }
    *bytes = &bytes[white_len..];
}

fn base64_decode(mut data_base64: &[u8]) -> Result<Vec<u8>, base64::DecodeError> {
    while data_base64.last() == Some(&b'=') {
        data_base64 = &data_base64[..data_base64.len() - 1];
    }
    base64::engine::general_purpose::STANDARD_NO_PAD.decode(data_base64)
}

