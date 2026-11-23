use std::{
    collections::BTreeSet,
    sync::{Arc, Mutex, mpsc},
    time::{Duration, Instant},
};

#[derive(Default)]
struct Activity {
    last: Option<Instant>,
    connections: usize,
    chat_turns: usize,
}

/// Activity shared by the stack loop and its browser/control clients.
#[derive(Clone, Default)]
pub struct ActivityTracker(Arc<Mutex<Activity>>);

impl ActivityTracker {
    pub fn record_activity(&self) {
        self.0.lock().expect("activity state").last = Some(Instant::now());
    }

    /// Hold this guard for the lifetime of a connected devtools client.
    pub fn connection(&self) -> ActivityGuard {
        self.acquire(false)
    }

    /// Hold this guard while a chat turn is running, including disconnected turns.
    pub fn chat_turn(&self) -> ActivityGuard {
        self.acquire(true)
    }

    fn acquire(&self, chat: bool) -> ActivityGuard {
        let mut state = self.0.lock().expect("activity state");
        if chat {
            state.chat_turns += 1;
        } else {
            state.connections += 1;
        }
        state.last = Some(Instant::now());
        ActivityGuard {
            tracker: self.clone(),
            chat,
        }
    }

    pub(crate) fn is_idle(&self, timeout: Duration) -> bool {
        let state = self.0.lock().expect("activity state");
        state.connections == 0
            && state.chat_turns == 0
            && state.last.is_some_and(|last| last.elapsed() >= timeout)
    }
}

pub struct ActivityGuard {
    tracker: ActivityTracker,
    chat: bool,
}

impl Drop for ActivityGuard {
    fn drop(&mut self) {
        let mut state = self.tracker.0.lock().expect("activity state");
        if self.chat {
            state.chat_turns -= 1;
        } else {
            state.connections -= 1;
        }
        state.last = Some(Instant::now());
    }
}

pub(crate) struct RestartRequest {
    pub names: Vec<String>,
    pub result: mpsc::Sender<Result<(), String>>,
}

/// The receiving half belongs to exactly one stack loop, which serializes changes.
pub struct RuntimeControl {
    pub(crate) requests: mpsc::Receiver<RestartRequest>,
    pub(crate) activity: ActivityTracker,
    pub(crate) dirty: Arc<Mutex<BTreeSet<String>>>,
}

#[derive(Clone)]
pub struct RuntimeHandle {
    requests: mpsc::Sender<RestartRequest>,
    pub activity: ActivityTracker,
    dirty: Arc<Mutex<BTreeSet<String>>>,
}

impl RuntimeControl {
    pub fn channel() -> (RuntimeHandle, Self) {
        let (requests, receiver) = mpsc::channel();
        let activity = ActivityTracker::default();
        let dirty = Arc::new(Mutex::new(BTreeSet::new()));
        (
            RuntimeHandle {
                requests,
                activity: activity.clone(),
                dirty: dirty.clone(),
            },
            Self {
                requests: receiver,
                activity,
                dirty,
            },
        )
    }
}

impl RuntimeHandle {
    /// Submit a restart without blocking the caller's async executor.
    pub fn restart_services(
        &self,
        names: Vec<String>,
    ) -> Result<mpsc::Receiver<Result<(), String>>, String> {
        let (result, receiver) = mpsc::channel();
        self.requests
            .send(RestartRequest { names, result })
            .map_err(|_| "devhost is shutting down".to_owned())?;
        Ok(receiver)
    }

    pub fn dirty_services(&self) -> BTreeSet<String> {
        self.dirty.lock().expect("dirty services").clone()
    }
}
