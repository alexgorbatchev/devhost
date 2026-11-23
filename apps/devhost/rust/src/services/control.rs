use std::{
    collections::BTreeSet,
    path::PathBuf,
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

pub(crate) enum WorktreeOperation {
    Refresh,
    Switch {
        repository_id: String,
        path: PathBuf,
    },
    StopOwner {
        repository_id: String,
        path: PathBuf,
        owner_id: String,
    },
}

pub(crate) enum RuntimeRequest {
    CheckConfig {
        path: PathBuf,
        content: String,
        result: mpsc::Sender<Result<(), String>>,
    },
    Start {
        names: Vec<String>,
        result: mpsc::Sender<Result<(), String>>,
    },
    RestartStack {
        result: mpsc::Sender<Result<(), String>>,
    },
    Restart {
        names: Vec<String>,
        result: mpsc::Sender<Result<(), String>>,
    },
    Worktrees {
        operation: WorktreeOperation,
        result: mpsc::Sender<Result<Vec<crate::devtools::WorktreeRepository>, String>>,
    },
}

/// The receiving half belongs to exactly one stack loop, which serializes changes.
pub struct RuntimeControl {
    pub(crate) live: super::stack::live::LiveState,
    sender: mpsc::Sender<RuntimeRequest>,
    pub(crate) requests: mpsc::Receiver<RuntimeRequest>,
    pub(crate) activity: ActivityTracker,
    pub(crate) dirty: Arc<Mutex<BTreeSet<String>>>,
    agents: Arc<crate::devtools::agents::Agents>,
}

#[derive(Clone)]
pub struct RuntimeHandle {
    pub(crate) live: super::stack::live::LiveState,
    requests: mpsc::Sender<RuntimeRequest>,
    pub activity: ActivityTracker,
    dirty: Arc<Mutex<BTreeSet<String>>>,
    pub(crate) agents: Arc<crate::devtools::agents::Agents>,
}

impl RuntimeControl {
    pub fn channel() -> (RuntimeHandle, Self) {
        let (requests, receiver) = mpsc::channel();
        let activity = ActivityTracker::default();
        let dirty = Arc::new(Mutex::new(BTreeSet::new()));
        let live = super::stack::live::LiveState::default();
        let agents = Arc::new(crate::devtools::agents::Agents::default());
        (
            RuntimeHandle {
                live: live.clone(),
                requests: requests.clone(),
                activity: activity.clone(),
                dirty: dirty.clone(),
                agents: agents.clone(),
            },
            Self {
                live,
                sender: requests,
                requests: receiver,
                activity,
                dirty,
                agents,
            },
        )
    }

    pub(crate) fn handle(&self) -> RuntimeHandle {
        RuntimeHandle {
            live: self.live.clone(),
            requests: self.sender.clone(),
            activity: self.activity.clone(),
            dirty: self.dirty.clone(),
            agents: self.agents.clone(),
        }
    }
}

impl Drop for RuntimeControl {
    fn drop(&mut self) {
        self.live.events.stopping.send_replace(true);
    }
}

impl RuntimeHandle {
    pub(crate) fn check_config(
        &self,
        path: PathBuf,
        content: String,
    ) -> Result<mpsc::Receiver<Result<(), String>>, String> {
        let (result, receiver) = mpsc::channel();
        self.requests
            .send(RuntimeRequest::CheckConfig {
                path,
                content,
                result,
            })
            .map_err(|_| "devhost is shutting down".to_owned())?;
        Ok(receiver)
    }
    pub fn start_services(
        &self,
        names: Vec<String>,
    ) -> Result<mpsc::Receiver<Result<(), String>>, String> {
        let (result, receiver) = mpsc::channel();
        self.requests
            .send(RuntimeRequest::Start { names, result })
            .map_err(|_| "devhost is shutting down".to_owned())?;
        Ok(receiver)
    }

    pub fn restart_stack(&self) -> Result<mpsc::Receiver<Result<(), String>>, String> {
        let (result, receiver) = mpsc::channel();
        self.requests
            .send(RuntimeRequest::RestartStack { result })
            .map_err(|_| "devhost is shutting down".to_owned())?;
        Ok(receiver)
    }

    /// Submit a restart without blocking the caller's async executor.
    pub fn restart_services(
        &self,
        names: Vec<String>,
    ) -> Result<mpsc::Receiver<Result<(), String>>, String> {
        let (result, receiver) = mpsc::channel();
        self.requests
            .send(RuntimeRequest::Restart { names, result })
            .map_err(|_| "devhost is shutting down".to_owned())?;
        Ok(receiver)
    }

    pub(crate) fn worktrees(
        &self,
        operation: WorktreeOperation,
    ) -> Result<mpsc::Receiver<Result<Vec<crate::devtools::WorktreeRepository>, String>>, String>
    {
        let (result, receiver) = mpsc::channel();
        self.requests
            .send(RuntimeRequest::Worktrees { operation, result })
            .map_err(|_| "devhost is shutting down".to_owned())?;
        Ok(receiver)
    }

    pub fn dirty_services(&self) -> BTreeSet<String> {
        self.dirty.lock().expect("dirty services").clone()
    }
}
