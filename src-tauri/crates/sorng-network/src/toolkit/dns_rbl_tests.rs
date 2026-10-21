use super::*;

fn request(server: SocketAddr) -> ToolkitRequest {
    ToolkitRequest {
        job_id: "rbl-hostname-fixture".into(),
        tool: "rbl".into(),
        target: "fixture.test".into(),
        timeout_ms: 1000,
        route: "direct".into(),
        proxy_url: None,
        options: [
            ("resolver".into(), server.to_string()),
            ("zones".into(), "listed.test,error.test".into()),
        ]
        .into(),
    }
}

fn answer(mut bytes: Vec<u8>, records: Vec<(String, u16, Vec<u8>)>, rcode: u16) -> Vec<u8> {
    bytes[2..4].copy_from_slice(&(0x8180 | rcode).to_be_bytes());
    bytes[6..8].copy_from_slice(&(records.len() as u16).to_be_bytes());
    for (owner, kind, data) in records {
        bytes.extend_from_slice(&wire::encode_name(&owner));
        bytes.extend_from_slice(&kind.to_be_bytes());
        bytes.extend_from_slice(&[0, 1, 0, 0, 0, 60]);
        bytes.extend_from_slice(&(data.len() as u16).to_be_bytes());
        bytes.extend_from_slice(&data);
    }
    bytes
}

#[test]
fn cname_resolution_excludes_unrelated_answers_and_rejects_loops_and_dns_errors() {
    let reply = json!({"rcode":0,"answers":[
        {"name":"fixture.test","typeCode":5,"data":{"target":"alias.test"}},
        {"name":"alias.test","typeCode":1,"data":{"address":"192.0.2.1"}},
        {"name":"alias.test","typeCode":1,"data":{"address":"192.0.2.1"}},
        {"name":"unrelated.test","typeCode":1,"data":{"address":"192.0.2.99"}}
    ]});
    assert_eq!(
        rbl_addresses(&reply, "fixture.test", 1).unwrap(),
        (vec!["192.0.2.1".parse().unwrap()], None)
    );
    let only_alias = json!({"rcode":0,"answers":[{"name":"fixture.test","typeCode":5,"data":{"target":"alias.test"}}]});
    assert_eq!(
        rbl_addresses(&only_alias, "fixture.test", 1)
            .unwrap()
            .1
            .as_deref(),
        Some("alias.test")
    );
    let cycle = json!({"rcode":0,"answers":[
        {"name":"fixture.test","typeCode":5,"data":{"target":"alias.test"}},
        {"name":"alias.test","typeCode":5,"data":{"target":"fixture.test"}}
    ]});
    assert!(rbl_addresses(&cycle, "fixture.test", 1)
        .unwrap_err()
        .contains("loop"));
    assert!(rbl_addresses(&json!({"rcode":3,"answers":[]}), "fixture.test", 1).is_err());
    assert!(rbl_addresses(&json!({"rcode":2,"answers":[]}), "fixture.test", 1).is_err());
}

#[tokio::test]
async fn hostname_a_aaaa_dedup_and_per_address_provider_results_use_selected_resolver() {
    let socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
    let address = socket.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let mut questions = Vec::new();
        for _ in 0..6 {
            let mut buffer = [0; 4096];
            let (length, peer) = socket.recv_from(&mut buffer).await.unwrap();
            let bytes = buffer[..length].to_vec();
            let mut at = 12;
            let name = read_name(&bytes, &mut at).unwrap();
            let kind = u16_at(&bytes, at).unwrap();
            questions.push((name.clone(), kind));
            let reply = if name == "fixture.test" {
                if kind == 1 {
                    answer(
                        bytes,
                        vec![
                            (name.clone(), 1, vec![192, 0, 2, 1]),
                            (name, 1, vec![192, 0, 2, 1]),
                        ],
                        0,
                    )
                } else {
                    answer(
                        bytes,
                        vec![(
                            name,
                            28,
                            "2001:db8::1".parse::<Ipv6Addr>().unwrap().octets().to_vec(),
                        )],
                        0,
                    )
                }
            } else if name.ends_with(".error.test") {
                answer(bytes, vec![], 2)
            } else {
                answer(bytes, vec![(name, 1, vec![127, 0, 0, 2])], 0)
            };
            socket.send_to(&reply, peer).await.unwrap();
        }
        questions
    });
    let report = run(&request(address)).await.unwrap();
    let questions = server.await.unwrap();
    assert_eq!(
        report["resolvedAddresses"],
        json!(["192.0.2.1", "2001:db8::1"])
    );
    let rows = report["results"].as_array().unwrap();
    assert_eq!(rows.len(), 4);
    assert_eq!(
        rows.iter().filter(|row| row["status"] == "listed").count(),
        2
    );
    assert_eq!(
        rows.iter().filter(|row| row["status"] == "error").count(),
        2
    );
    assert!(rows.iter().all(|row| row["ip"].is_string()));
    assert_eq!(questions[0], ("fixture.test".into(), 1));
    assert_eq!(questions[1], ("fixture.test".into(), 28));
    assert!(questions[2..]
        .iter()
        .all(|(q, _)| q.ends_with(".listed.test") || q.ends_with(".error.test")));
}

#[tokio::test]
async fn failed_hostname_resolution_never_queries_provider_or_claims_clean() {
    let socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
    let address = socket.local_addr().unwrap();
    let server = tokio::spawn(async move {
        for rcode in [3, 2] {
            let mut bytes = [0; 512];
            let (size, peer) = socket.recv_from(&mut bytes).await.unwrap();
            socket
                .send_to(&answer(bytes[..size].to_vec(), vec![], rcode), peer)
                .await
                .unwrap();
        }
    });
    let result = run(&request(address)).await.unwrap();
    server.await.unwrap();
    assert_eq!(result["resolvedAddresses"], json!([]));
    assert_eq!(result["results"], json!([]));
    assert_eq!(result["partial"], true);
    assert!(result["resolution"]
        .as_array()
        .unwrap()
        .iter()
        .all(|row| row["status"] == "error"));
}

#[tokio::test]
async fn follows_cname_on_same_resolver_and_retains_partial_family_failure() {
    let socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
    let address = socket.local_addr().unwrap();
    let server = tokio::spawn(async move {
        for _ in 0..4 {
            let mut buffer = [0; 4096];
            let (size, peer) = socket.recv_from(&mut buffer).await.unwrap();
            let bytes = buffer[..size].to_vec();
            let mut at = 12;
            let owner = read_name(&bytes, &mut at).unwrap();
            let kind = u16_at(&bytes, at).unwrap();
            let reply = if owner == "fixture.test" && kind == 1 {
                answer(bytes, vec![(owner, 5, wire::encode_name("alias.test"))], 0)
            } else if owner == "alias.test" {
                answer(bytes, vec![(owner, 1, vec![192, 0, 2, 8])], 0)
            } else if kind == 28 {
                answer(bytes, vec![], 2)
            } else {
                answer(bytes, vec![], 3)
            };
            socket.send_to(&reply, peer).await.unwrap();
        }
    });
    let mut req = request(address);
    req.options.insert("zones".into(), "provider.test".into());
    let result = run(&req).await.unwrap();
    server.await.unwrap();
    assert_eq!(result["resolvedAddresses"], json!(["192.0.2.8"]));
    assert_eq!(result["partial"], true);
    assert_eq!(result["results"][0]["ip"], "192.0.2.8");
    assert_eq!(result["results"][0]["status"], "notListed");
    assert_eq!(result["resolution"].as_array().unwrap().len(), 3);
}

#[tokio::test]
async fn address_limit_is_explicit_and_prevents_extra_blocklist_queries() {
    let socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
    let address = socket.local_addr().unwrap();
    let server = tokio::spawn(async move {
        for index in 0..18 {
            let mut buffer = [0; 4096];
            let (size, peer) = socket.recv_from(&mut buffer).await.unwrap();
            let bytes = buffer[..size].to_vec();
            let reply = if index == 0 {
                answer(
                    bytes,
                    (1..=17)
                        .map(|last| ("fixture.test".into(), 1, vec![192, 0, 2, last]))
                        .collect(),
                    0,
                )
            } else {
                answer(bytes, vec![], if index == 1 { 0 } else { 3 })
            };
            socket.send_to(&reply, peer).await.unwrap();
        }
        assert!(
            tokio::time::timeout(Duration::from_millis(50), socket.recv_from(&mut [0; 512]))
                .await
                .is_err()
        );
    });
    let mut req = request(address);
    req.options.insert("zones".into(), "provider.test".into());
    let result = run(&req).await.unwrap();
    server.await.unwrap();
    assert_eq!(result["resolvedAddresses"].as_array().unwrap().len(), 16);
    assert_eq!(result["results"].as_array().unwrap().len(), 16);
    assert_eq!(result["truncated"], true);
    assert_eq!(result["partial"], true);
}

#[tokio::test]
async fn hostname_resolution_obeys_existing_toolkit_cancellation() {
    let socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
    let req = request(socket.local_addr().unwrap());
    let id = req.job_id.clone();
    let job = tokio::spawn(super::super::run(req));
    let mut bytes = [0; 512];
    tokio::time::timeout(Duration::from_secs(2), socket.recv_from(&mut bytes))
        .await
        .unwrap()
        .unwrap();
    assert!(super::super::cancel(&id).unwrap());
    assert!(job.await.unwrap().unwrap_err().contains("cancelled"));
}
