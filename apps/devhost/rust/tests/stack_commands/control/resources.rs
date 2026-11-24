use super::*;
use async_tungstenite::tungstenite::{Message, client::IntoClientRequest};
use futures_util::StreamExt;

fn configure(manifest: &Path, base: &str, enabled: bool, memory: bool, disk: bool) {
    fs::write(manifest, format!("{base}\n[devtools.resources]\nenabled={enabled}\n[devtools.resources.cpu]\nenabled=false\npollInterval='250ms'\n[devtools.resources.memory]\nenabled={memory}\npollInterval='250ms'\n[devtools.resources.disk]\nenabled={disk}\npollInterval='250ms'\n")).unwrap();
}

#[test]
fn resource_toggles_update_live_fields_close_disabled_streams_and_allow_reenablement() {
    let runtime = Runtime::start();
    let (project, _process) = runtime.start_stack("resource-toggle-contract", false);
    let origin = origin(&runtime, "resource-toggle-contract");
    lifecycle::ready(&origin);
    let manifest = project.join("devhost.toml");
    let base = fs::read_to_string(&manifest).unwrap();
    configure(&manifest, &base, true, true, true);
    wait_until(|| body(&mut get(&origin, "config.json"))["resourcesEnabled"] == true);
    let mut request = format!(
        "{}/__devhost__/ws/resources",
        origin.replacen("http:", "ws:", 1)
    )
    .into_client_request()
    .unwrap();
    request
        .headers_mut()
        .insert("Origin", origin.parse().unwrap());
    let io = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    io.block_on(async {
        let (mut socket, _) = async_tungstenite::tokio::connect_async(request.clone()).await.unwrap();
        for disk_only in [false, true] {
            if disk_only { configure(&manifest, &base, true, false, true); }
            tokio::time::timeout(Duration::from_secs(5), async {
                loop {
                    let Message::Text(text) = socket.next().await.unwrap().unwrap() else { panic!("resource stream ended during toggle") };
                    let value: Value = serde_json::from_str(&text).unwrap();
                    if !value["disk"].is_object() || value["memory"].is_object() == disk_only || value.get("cpu").is_some() { continue; }
                    assert!(value["disk"]["totalBytes"].as_u64().unwrap() > 0);
                    break;
                }
            }).await.expect("resource fields follow live enablement");
        }
        configure(&manifest, &base, false, false, true);
        wait_until(|| body(&mut get(&origin, "config.json"))["resourcesEnabled"] == false);
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if let Message::Close(Some(frame)) = socket.next().await.unwrap().unwrap() {
                    assert_eq!(u16::from(frame.code), 1000);
                    assert_eq!(frame.reason, "resource readouts are turned off");
                    break;
                }
            }
        }).await.expect("disabling every resource closes the existing stream");
        let error = async_tungstenite::tokio::connect_async(request.clone()).await.unwrap_err();
        assert!(matches!(error, async_tungstenite::tungstenite::Error::Http(response) if response.status() == 404));
        configure(&manifest, &base, true, true, false);
        wait_until(|| body(&mut get(&origin, "config.json"))["resourcesEnabled"] == true);
        let (mut socket, _) = async_tungstenite::tokio::connect_async(request).await.unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let Message::Text(text) = socket.next().await.unwrap().unwrap() else { panic!("re-enabled resource stream ended") };
                let value: Value = serde_json::from_str(&text).unwrap();
                if !value["memory"].is_object() || value.get("disk").is_some() || value.get("cpu").is_some() { continue; }
                assert!(value["memory"]["totalBytes"].as_u64().unwrap() > 0);
                break;
            }
        }).await.expect("only memory returns after re-enablement");
        socket.close(None).await.unwrap();
    });
}
