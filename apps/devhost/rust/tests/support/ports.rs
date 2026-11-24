use std::{
    net::TcpListener,
    sync::{Mutex, OnceLock},
};

pub fn reserve_listener() -> TcpListener {
    // These subprocess servers cannot inherit our reservation. Keep their
    // short release-to-bind window outside the outbound ephemeral range.
    const FIRST: u16 = 10240;
    const LAST: u16 = 32768;
    static NEXT: OnceLock<Mutex<u16>> = OnceLock::new();
    let next = NEXT.get_or_init(|| {
        // Adjacent test-process PIDs must not start overlapping sequences while
        // their subprocess listeners are between reservation and bind.
        let mut seed = [0_u8; 2];
        getrandom::fill(&mut seed).unwrap();
        Mutex::new(FIRST + u16::from_ne_bytes(seed) % (LAST - FIRST))
    });
    let ephemeral = std::fs::read_to_string("/proc/sys/net/ipv4/ip_local_port_range")
        .ok()
        .and_then(|range| {
            let ports: Vec<u16> = range
                .split_whitespace()
                .filter_map(|part| part.parse().ok())
                .collect();
            (ports.len() == 2).then(|| (ports[0], ports[1]))
        })
        .unwrap_or((49152, 65535));
    for _ in FIRST..LAST {
        let port = {
            let mut next = next.lock().unwrap();
            let port = *next;
            *next = if port + 1 == LAST { FIRST } else { port + 1 };
            port
        };
        if (ephemeral.0..=ephemeral.1).contains(&port) {
            continue;
        }
        if let Ok(listener) = TcpListener::bind(("127.0.0.1", port)) {
            return listener;
        }
    }
    panic!("no fixture TCP port available outside the outbound ephemeral range");
}
