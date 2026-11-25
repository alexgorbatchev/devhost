use super::{
    CLAUDE, CODEX, Command, LIMIT, Start, Store,
    process::{self, Process},
    random_id,
    session::{Client, Session},
};
use crate::{
    devtools::{
        project_context,
        server::{diagnostic, guard},
        streams,
    },
    services::control::RuntimeHandle,
};
use axum::{
    body::{Body, to_bytes},
    extract::{
        Path, State, WebSocketUpgrade,
        ws::{CloseFrame, Message, WebSocket},
    },
    http::{Method, Request, StatusCode, header},
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{Value, json};
use std::{path::Path as FsPath, sync::Arc, time::Duration};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

pub(in crate::devtools) use super::panel::serve as panel;

pub(super) fn json(value: &impl Serialize) -> Response {
    match serde_json::to_string(value) {
        Ok(text) => (
            [
                (header::CONTENT_TYPE, "application/json"),
                (header::CACHE_CONTROL, "no-store"),
            ],
            format!("{text}\n"),
        )
            .into_response(),
        Err(e) => diagnostic(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}
pub(super) fn require_page(request: &Request<Body>) -> Result<(), &'static str> {
    if !request.headers().contains_key(header::ORIGIN) {
        Err("Chat requests must come from the routed page.")
    } else {
        Ok(())
    }
}
fn query(request: &Request<Body>, name: &str) -> String {
    url::form_urlencoded::parse(request.uri().query().unwrap_or_default().as_bytes())
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.into_owned())
        .unwrap_or_default()
}

async fn discover(store: &Store, harness: &str, root: &FsPath) -> Value {
    let mut result = json!({"id":harness,"label":if harness==CODEX{"Codex"}else{"Claude Code"},"available":false,"models":[]});
    let discovered=async {
        let _tracked=store.begin()?;
        let process=Process::start(store,harness,root,"",false,|_|{})?;
        let cleanup=process.cancel.clone().drop_guard();
        let models=async {
            let initialized=process::initialize(&process).await.map_err(|e|e.to_string())?;
            let rows=if harness==CLAUDE {initialized["models"].as_array().cloned().unwrap_or_default()}else{process::models(&process).await?};
            rows.into_iter().map(|row|{
                let id=row[if harness==CLAUDE{"value"}else{"model"}].as_str().filter(|s|!s.is_empty()).ok_or("native model has no selectable ID")?;
                Ok(json!({"id":id,"label":row["displayName"].as_str().unwrap_or_default(),"description":row["description"].as_str().unwrap_or_default()}))
            }).collect::<Result<Vec<_>,String>>()
        }.await;
        process.close().await;
        cleanup.disarm();
        models
    }.await;
    match discovered {
        Ok(models) => {
            result["available"] = json!(true);
            result["models"] = json!(models);
        }
        Err(e) => result["error"] = json!(e),
    }
    result
}

pub(in crate::devtools) async fn harnesses(
    State(handle): State<RuntimeHandle>,
    request: Request<Body>,
) -> Response {
    if let Err(e) = guard(&handle, &request) {
        return diagnostic(StatusCode::FORBIDDEN, e);
    }
    if request.method() != Method::GET {
        return diagnostic(StatusCode::METHOD_NOT_ALLOWED, "method not allowed");
    }
    let root = match project_context::query_root(&handle, &request) {
        Ok(root) => root,
        Err(e) => return diagnostic(StatusCode::BAD_REQUEST, &e),
    };
    json(
        &json!({"harnesses":[discover(&handle.chat,CODEX,&root).await,discover(&handle.chat,CLAUDE,&root).await]}),
    )
}

pub(in crate::devtools) async fn sessions(
    State(handle): State<RuntimeHandle>,
    request: Request<Body>,
) -> Response {
    if let Err(e) = guard(&handle, &request) {
        return diagnostic(StatusCode::FORBIDDEN, e);
    }
    match *request.method() {
        Method::GET => match project_context::query_root(&handle, &request) {
            Ok(root) => json(&json!({"sessions":handle.chat.list(&root)})),
            Err(e) => diagnostic(StatusCode::BAD_REQUEST, &e),
        },
        Method::POST => {
            if let Err(e) = require_page(&request) {
                return diagnostic(StatusCode::FORBIDDEN, e);
            }
            let bytes = match to_bytes(request.into_body(), 64 * 1024).await {
                Ok(b) => b,
                Err(e) => return diagnostic(StatusCode::BAD_REQUEST, &e.to_string()),
            };
            let start = match serde_json::from_slice::<Start>(&bytes) {
                Ok(s) => s,
                Err(e) => return diagnostic(StatusCode::BAD_REQUEST, &e.to_string()),
            };
            if !matches!(start.harness.as_str(), CLAUDE | CODEX) {
                return diagnostic(StatusCode::BAD_REQUEST, "unknown harness");
            }
            let root = match project_context::root(&handle, &start.page_url, &start.target) {
                Ok(root) => root,
                Err(e) => return diagnostic(StatusCode::BAD_REQUEST, &e),
            };
            if !handle
                .chat
                .can_resume(&start.resume_id, &start.harness, &root)
            {
                return diagnostic(
                    StatusCode::FORBIDDEN,
                    "Native session belongs to a different project.",
                );
            }
            match handle.chat.start(&handle, start, &root).await {
                Ok(session) => json(&session.info()),
                Err(e) => diagnostic(StatusCode::BAD_GATEWAY, &e),
            }
        }
        _ => diagnostic(StatusCode::METHOD_NOT_ALLOWED, "method not allowed"),
    }
}

pub(in crate::devtools) async fn close(
    State(handle): State<RuntimeHandle>,
    Path(id): Path<String>,
    request: Request<Body>,
) -> Response {
    if let Err(e) = guard(&handle, &request) {
        return diagnostic(StatusCode::FORBIDDEN, e);
    }
    if request.method() != Method::POST {
        return diagnostic(StatusCode::METHOD_NOT_ALLOWED, "method not allowed");
    }
    if let Err(e) = require_page(&request) {
        return diagnostic(StatusCode::FORBIDDEN, e);
    }
    let root = match project_context::query_root(&handle, &request) {
        Ok(root) => root,
        Err(e) => return diagnostic(StatusCode::BAD_REQUEST, &e),
    };
    let Some(session) = handle.chat.find(&id, &root) else {
        return diagnostic(StatusCode::NOT_FOUND, "404 page not found");
    };
    session.close(false).await;
    json(&session.info())
}

pub(in crate::devtools) async fn websocket(
    State(handle): State<RuntimeHandle>,
    upgrade: Result<WebSocketUpgrade, axum::extract::ws::rejection::WebSocketUpgradeRejection>,
    request: Request<Body>,
) -> Response {
    if let Err(e) = guard(&handle, &request) {
        return diagnostic(StatusCode::FORBIDDEN, e);
    }
    if request.method() != Method::GET {
        return diagnostic(StatusCode::METHOD_NOT_ALLOWED, "GET required");
    }
    if let Err(e) = require_page(&request) {
        return diagnostic(StatusCode::FORBIDDEN, e);
    }
    if let Err(e) = streams::websocket_guard(&handle, &request) {
        return diagnostic(StatusCode::FORBIDDEN, e);
    }
    let tracked = match handle.chat.begin() {
        Ok(t) => t,
        Err(_) => return diagnostic(StatusCode::SERVICE_UNAVAILABLE, "Devhost is stopping"),
    };
    let id = query(&request, "sessionId");
    if id.is_empty() {
        return diagnostic(StatusCode::BAD_REQUEST, "missing sessionId");
    }
    let root = match project_context::query_root(&handle, &request) {
        Ok(root) => root,
        Err(e) => return diagnostic(StatusCode::BAD_REQUEST, &e),
    };
    let Some(session) = handle.chat.find(&id, &root) else {
        return diagnostic(StatusCode::NOT_FOUND, "404 page not found");
    };
    let upgrade = match upgrade {
        Ok(u) => u,
        Err(e) => return e.into_response(),
    };
    let page = query(&request, "pageURL");
    let target = query(&request, "chatTarget");
    upgrade
        .max_message_size(LIMIT)
        .on_upgrade(move |socket| async move {
            let _tracked = tracked;
            connection(handle, session, page, target, socket).await;
        })
        .into_response()
}

fn command_result(
    id: &str,
    command: &Command,
    delivery: &str,
    error: Option<String>,
) -> Option<Value> {
    let mut response = json!({"type":"error","sessionId":id});
    if command.kind == "send" && !command.command_id.is_empty() {
        response["type"] = json!("command_result");
        response["commandId"] = json!(command.command_id);
    }
    if !delivery.is_empty() {
        response["delivery"] = json!(delivery);
    }
    if let Some(error) = error {
        response["error"] = json!(error);
    } else if response["type"] != "command_result" {
        return None;
    }
    Some(response)
}
fn emit(sender: &mpsc::Sender<Value>, cancel: &CancellationToken, message: Value) {
    if sender.try_send(message).is_err() {
        cancel.cancel();
    }
}

async fn connection(
    handle: RuntimeHandle,
    session: Arc<Session>,
    page: String,
    target: String,
    socket: WebSocket,
) {
    let _activity = handle.activity.connection();
    let id = session.info().id;
    let client_id = match random_id(false) {
        Ok(id) => id,
        Err(_) => return,
    };
    let (outgoing, mut messages) = mpsc::channel(32);
    let cancel = CancellationToken::new();
    let snapshot = {
        let mut state = session.state.lock().expect("chat state");
        if state.info.status == "closed" {
            None
        } else {
            match state.snapshot() {
                Ok(snapshot) => {
                    state.clients.insert(
                        client_id.clone(),
                        Client {
                            sender: outgoing.clone(),
                            cancel: cancel.clone(),
                        },
                    );
                    Some(snapshot)
                }
                Err(_) => None,
            }
        }
    };
    let (mut writer, mut reader) = socket.split();
    let (sends, mut commands) = mpsc::channel::<Command>(16);
    let sending = session.clone();
    let acknowledgements = outgoing.clone();
    let send_cancel = cancel.clone();
    let send_id = id.clone();
    let worker = handle.chat.tasks.spawn(async move {
        while let Some(command) = commands.recv().await {
            let command_id = command.command_id.clone();
            let outcome = sending.send(command).await;
            let command = Command {
                kind: "send".into(),
                command_id,
                ..Default::default()
            };
            let (delivery, error) = match outcome {
                Ok(d) => (d, None),
                Err(e) => (String::new(), Some(e)),
            };
            if let Some(message) = command_result(&send_id, &command, &delivery, error) {
                emit(&acknowledgements, &send_cancel, message);
            }
        }
    });
    if let Some(snapshot) = snapshot {
        if !matches!(
            tokio::time::timeout(
                Duration::from_secs(10),
                writer.send(Message::Text(snapshot.to_string().into()))
            )
            .await,
            Ok(Ok(()))
        ) {
            cancel.cancel();
        }
        loop {
            tokio::select! {
                _=handle.chat.cancel.cancelled()=>{let _=tokio::time::timeout(Duration::from_secs(10),writer.send(Message::Close(Some(CloseFrame{code:1001,reason:"Devhost stopping".into()})))).await;break;},
                _=session.closed.cancelled()=>{let _=tokio::time::timeout(Duration::from_secs(10),writer.send(Message::Close(Some(CloseFrame{code:1000,reason:"Chat session closed".into()})))).await;break;},
                _=cancel.cancelled()=>break,
                message=messages.recv()=>{let Some(message)=message else{break};if !matches!(tokio::time::timeout(Duration::from_secs(10),writer.send(Message::Text(message.to_string().into()))).await,Ok(Ok(()))){break;}},
                incoming=reader.next()=>{
                    let text=match incoming{Some(Ok(Message::Text(text)))=>text,Some(Ok(Message::Close(_)))|None|Some(Err(_))=>break,_=>continue};
                    let parsed=serde_json::from_str::<Command>(&text);
                    let (mut command,mut error)=match parsed{Ok(c)=>(c,None),Err(e)=>{let value:Value=serde_json::from_str(&text).unwrap_or(Value::Null);(Command{kind:value["type"].as_str().unwrap_or_default().into(),command_id:value["commandId"].as_str().unwrap_or_default().into(),..Default::default()},Some(e.to_string()))}};
                    if error.is_none(){error=prepare(&handle,&session,&page,&target,&mut command,&text).err();}
                    if error.is_none()&&command.kind=="send" {
                        match sends.try_send(command){Ok(())=>continue,Err(e)=>{command=e.into_inner();error=Some("chat send queue is full; retry after a message is accepted".into());}}
                    }else if error.is_none(){error=session.execute(Command{kind:command.kind.clone(),request_id:command.request_id.clone(),result:command.result.clone(),..Default::default()}).await.err();}
                    if let Some(message)=command_result(&id,&command,"",error){emit(&outgoing,&cancel,message);}
                }
            }
        }
    } else {
        let _ = tokio::time::timeout(
            Duration::from_secs(10),
            writer.send(Message::Close(Some(CloseFrame {
                code: 1000,
                reason: "Chat session closed".into(),
            }))),
        )
        .await;
    }
    session
        .state
        .lock()
        .expect("chat state")
        .clients
        .remove(&client_id);
    drop(sends);
    let _ = worker.await;
}

fn prepare(
    handle: &RuntimeHandle,
    session: &Session,
    page: &str,
    target: &str,
    command: &mut Command,
    text: &str,
) -> Result<(), String> {
    if command.kind == "send" && command.command_id.is_empty() {
        return Err("send command requires commandId".into());
    }
    let root = project_context::root(handle, page, target)?;
    if session.info().project_root_path != root.to_string_lossy() {
        return Err(
            "The selected project changed. Start a new chat session in its selected worktree."
                .into(),
        );
    }
    if command.kind == "respond"
        && !serde_json::from_str::<Value>(text).is_ok_and(|v| v.get("result").is_some())
    {
        return Err("native response requires result".into());
    }
    if command.kind == "send" {
        if command.text.is_empty() && command.images.is_empty() {
            return Err("message is empty".into());
        }
        if let Some(manifest) = handle.live.manifest()
            && !manifest.devtools.chat.prompt.is_empty()
        {
            command
                .text
                .push_str("\n\nDevhost workflow instructions:\n");
            command.text.push_str(&manifest.devtools.chat.prompt);
        }
        if serde_json::to_vec(command)
            .map_err(|e| e.to_string())?
            .len()
            > LIMIT
        {
            return Err("message including workflow instructions exceeds 8 MiB".into());
        }
    }
    Ok(())
}
