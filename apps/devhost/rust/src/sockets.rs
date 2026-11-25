use std::{net::TcpListener, os::fd::AsRawFd};

/// Stop listening on Linux, including copies held between fork and exec.
/// macOS rejects shutdown on listening sockets; all descriptors must close there.
pub(crate) fn shutdown_listener(listener: &TcpListener) {
    // SAFETY: the borrowed listener owns this valid descriptor for the call.
    // Shutdown affects the socket itself; close alone leaves inherited copies
    // listening until the child executes its new program on Linux. Other
    // platforms can reject this call, so callers must still close the listener.
    unsafe {
        libc::shutdown(listener.as_raw_fd(), libc::SHUT_RDWR);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn listener_shutdown_and_descriptor_closure_release_the_port() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let inherited = listener.try_clone().unwrap();
        assert!(TcpListener::bind(address).is_err());
        shutdown_listener(&listener);
        drop(listener);
        #[cfg(target_os = "macos")]
        {
            assert!(TcpListener::bind(address).is_err());
            drop(inherited);
        }
        let replacement = TcpListener::bind(address).unwrap();
        #[cfg(not(target_os = "macos"))]
        drop(inherited);
        assert_eq!(replacement.local_addr().unwrap(), address);
    }
}
