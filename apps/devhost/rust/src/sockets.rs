use std::{net::TcpListener, os::fd::AsRawFd};

/// Release the listening socket, including copies held between fork and exec.
pub(crate) fn shutdown_listener(listener: &TcpListener) {
    // SAFETY: the borrowed listener owns this valid descriptor for the call.
    // Shutdown affects the socket itself; close alone leaves inherited copies
    // listening until the child executes its new program. Repeated shutdown
    // may fail after the socket is already closed for listening, which is safe.
    unsafe {
        libc::shutdown(listener.as_raw_fd(), libc::SHUT_RDWR);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shutdown_releases_the_port_while_another_descriptor_still_owns_the_socket() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let inherited = listener.try_clone().unwrap();
        assert!(TcpListener::bind(address).is_err());
        shutdown_listener(&listener);
        drop(listener);
        let replacement = TcpListener::bind(address).unwrap();
        drop(inherited);
        assert_eq!(replacement.local_addr().unwrap(), address);
    }
}
