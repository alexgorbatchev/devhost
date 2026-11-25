use super::*;

fn response(
    runtime: &Runtime,
    head: bool,
    headers: &[(&str, &str)],
) -> ureq::http::Response<ureq::Body> {
    let agent = client();
    let url = format!("http://127.0.0.1:{}/note.txt", runtime.settings.http_port);
    let mut request = if head {
        agent.head(&url)
    } else {
        agent.get(&url)
    }
    .header("Host", "restart-serve.localhost");
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    request.call().unwrap()
}

pub(super) fn check(runtime: &Runtime, modified: &str) {
    for (range, status, content) in [
        ("bytes=2-5", 206, "2345"),
        ("bytes=-3", 206, "789"),
        ("bytes=99-100", 416, "invalid range: failed to overlap\n"),
        ("garbage", 416, "invalid range\n"),
        ("bytes=0-18446744073709551615", 416, "invalid range\n"),
        ("bytes=-100", 206, "0123456789"),
        ("bytes=+1-+3", 206, "123"),
        ("bytes=0-9,0-9", 200, "0123456789"),
    ] {
        let mut response = response(runtime, false, &[("Range", range)]);
        assert_eq!(response.status(), status, "{range}");
        assert_eq!(
            response.body_mut().read_to_string().unwrap(),
            content,
            "{range}"
        );
    }
    let mut multipart = response(runtime, false, &[("Range", "bytes=0-1,5-6")]);
    assert_eq!(multipart.status(), 206);
    let content_type = multipart.headers()["content-type"].to_str().unwrap();
    let boundary = content_type
        .strip_prefix("multipart/byteranges; boundary=")
        .unwrap()
        .to_owned();
    let length: usize = multipart.headers()["content-length"]
        .to_str()
        .unwrap()
        .parse()
        .unwrap();
    let content = multipart.body_mut().read_to_string().unwrap();
    assert_eq!(content.len(), length);
    assert_eq!(
        content,
        format!(
            "--{boundary}\r\nContent-Range: bytes 0-1/10\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n01\r\n--{boundary}\r\nContent-Range: bytes 5-6/10\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n56\r\n--{boundary}--\r\n"
        )
    );
    let mut head = response(runtime, true, &[("Range", "bytes=0-1,5-6")]);
    assert_eq!(head.status(), 206);
    assert!(
        head.headers()["content-type"]
            .to_str()
            .unwrap()
            .starts_with("multipart/byteranges; boundary=")
    );
    assert!(
        head.headers()["content-length"]
            .to_str()
            .unwrap()
            .parse::<usize>()
            .unwrap()
            > 4
    );
    assert!(head.body_mut().read_to_vec().unwrap().is_empty());

    for head in [false, true] {
        for (headers, status, content) in [
            (
                vec![("Range", "bytes=0-1"), ("If-Range", modified)],
                206,
                "01",
            ),
            (
                vec![("Range", "bytes=0-1"), ("If-Range", "\"unknown\"")],
                200,
                "0123456789",
            ),
            (vec![("If-Match", "\"unknown\"")], 412, ""),
            (vec![("If-Match", "*")], 200, "0123456789"),
            (
                vec![("If-Unmodified-Since", "Wed, 21 Oct 2015 07:28:00 GMT")],
                412,
                "",
            ),
            (vec![("If-None-Match", "*")], 304, ""),
            (vec![("If-None-Match", "\"unknown\"")], 200, "0123456789"),
            (
                vec![("If-Match", "\"unknown\""), ("If-None-Match", "*")],
                412,
                "",
            ),
            (
                vec![
                    ("If-Match", "*"),
                    ("If-Unmodified-Since", "Wed, 21 Oct 2015 07:28:00 GMT"),
                ],
                200,
                "0123456789",
            ),
            (
                vec![
                    ("If-None-Match", "\"unknown\""),
                    ("If-Modified-Since", modified),
                ],
                200,
                "0123456789",
            ),
            (
                vec![("Range", "bytes=0-1"), ("If-Match", "\"unknown\"")],
                412,
                "",
            ),
            (
                vec![("Range", "bytes=0-1"), ("If-None-Match", "*")],
                304,
                "",
            ),
        ] {
            let mut response = response(runtime, head, &headers);
            assert_eq!(response.status(), status, "head={head}, {headers:?}");
            if matches!(status, 304 | 412) {
                assert!(
                    !response.headers().contains_key("content-type"),
                    "{headers:?}"
                );
            }
            assert_eq!(
                response.body_mut().read_to_string().unwrap(),
                if head { "" } else { content },
                "head={head}, {headers:?}"
            );
        }
    }
}
