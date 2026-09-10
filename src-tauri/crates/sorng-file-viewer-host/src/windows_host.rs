use sorng_file_viewer_host::{protocol, resources, startup};
use std::{
    io::{Read, Write},
    sync::Arc,
};
use tao::{
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    platform::run_return::EventLoopExtRunReturn,
    window::WindowBuilder,
};
use webview2_com::{Microsoft::Web::WebView2::Win32::*, *};
use windows::{
    core::{Interface, BOOL, HSTRING, PWSTR},
    Win32::UI::Shell::SHCreateMemStream,
};
use wry::{WebContext, WebViewBuilder, WebViewBuilderExtWindows, WebViewExtWindows};

#[derive(Clone, Copy)]
enum Signal {
    Revoke,
    Failed,
    Ready,
    SmokePassed,
    SmokeCandidate,
}

type HostResult<T> = std::result::Result<T, Box<dyn std::error::Error>>;

/// A mandatory security setter failure must never continue with an unfiltered view.
fn enforce<T>(result: windows::core::Result<T>) -> T {
    match result {
        Ok(value) => value,
        Err(_) => {
            eprint!("{}", protocol::FAILURE);
            std::process::exit(1);
        }
    }
}

pub fn run() -> HostResult<()> {
    if unsafe { windows::Win32::UI::Shell::IsUserAnAdmin().as_bool() } {
        return Err("elevated viewer unsupported".into());
    }
    if !protocol::safe_environment(std::env::vars()) {
        return Err("unsafe runtime override".into());
    }
    refuse_registry_overrides()?;
    let options = startup::options(std::env::args_os().skip(1))?;
    // Reading the frame is bounded; the parent owns a 15-second startup timeout.
    let document =
        Arc::new(protocol::read_document(std::io::stdin()).map_err(|_| "invalid frame")?);
    let mut context = WebContext::new(Some(options.profile));
    let mut event_loop = EventLoopBuilder::<Signal>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let window = WindowBuilder::new()
        .with_title("Isolated file viewer")
        .with_visible(false)
        .with_inner_size(tao::dpi::LogicalSize::new(960.0, 720.0))
        .build(&event_loop)?;
    // Deliberately NO with_ipc_handler and NO initial page/HTML/script. All native
    // policy must be installed before the first non-blank navigation.
    let webview = WebViewBuilder::new_with_web_context(&mut context)
        .with_incognito(true).with_devtools(false).with_clipboard(false)
        .with_additional_browser_args("--disable-background-networking --disable-component-update --disable-sync --no-first-run --disable-extensions --disable-features=msWebOOUI,msPdfOOUI")
        .with_drag_drop_handler(|_| true)
        .with_navigation_handler(|url| url == resources::START_URL)
        .with_new_window_req_handler(|_,_| wry::NewWindowResponse::Deny)
        .with_download_started_handler(|_,_| false)
        .build(&window)?;
    let core = unsafe { webview.controller().CoreWebView2()? };
    let environment = webview.environment();
    let mut token = 0i64;
    unsafe {
        let settings = core.Settings()?;
        settings.SetAreHostObjectsAllowed(false)?;
        settings.SetIsWebMessageEnabled(false)?;
        let mut messages_enabled = BOOL::default();
        settings.IsWebMessageEnabled(&mut messages_enabled)?;
        if messages_enabled.as_bool() {
            return Err("host messages enabled".into());
        }
        settings.SetAreDevToolsEnabled(false)?;
        settings.SetAreDefaultContextMenusEnabled(false)?;
        settings.SetAreDefaultScriptDialogsEnabled(false)?;
        settings.SetIsStatusBarEnabled(false)?;
        settings.SetIsZoomControlEnabled(false)?;
        settings
            .cast::<ICoreWebView2Settings3>()?
            .SetAreBrowserAcceleratorKeysEnabled(false)?;
        let settings4 = settings.cast::<ICoreWebView2Settings4>()?;
        settings4.SetIsPasswordAutosaveEnabled(false)?;
        settings4.SetIsGeneralAutofillEnabled(false)?;
        // Wry supports old runtimes that silently ignore incognito. We do not.
        let private = core.cast::<ICoreWebView2_13>()?.Profile()?;
        let mut in_private = BOOL::default();
        private.IsInPrivateModeEnabled(&mut in_private)?;
        if !in_private.as_bool() {
            return Err("private profile unavailable".into());
        }

        let env = environment.clone();
        core.cast::<ICoreWebView2_22>()?
            .AddWebResourceRequestedFilterWithRequestSourceKinds(
                &HSTRING::from("*"),
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
            )?;
        core.add_WebResourceRequested(&WebResourceRequestedEventHandler::create(Box::new(move |_,args| {
            let Some(args) = args else { return Ok(()); };
            // Install denial FIRST. Any later malformed URI/method remains denied.
            let denied = enforce(env.CreateWebResourceResponse(None,403,&HSTRING::from("Blocked"),&HSTRING::from("Content-Length: 0\r\nCache-Control: no-store")));
            enforce(args.SetResponse(&denied));
            let request = enforce(args.Request());
            let mut uri = PWSTR::null();
            enforce(request.Uri(&mut uri));
            let uri = take_pwstr(uri);
            let mut method = PWSTR::null();
            enforce(request.Method(&mut method));
            let method = take_pwstr(method);
            if let Some(resource) = resources::resource(&document,&uri,&method) {
                let stream = SHCreateMemStream(Some(resource.bytes.as_ref()));
                let Some(stream) = stream else { return Ok(()); };
                let headers = format!("Content-Type: {}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: {}\r\nReferrer-Policy: no-referrer\r\nPermissions-Policy: camera=(), microphone=(), geolocation=(), display-capture=(), usb=(), serial=(), clipboard-read=(), clipboard-write=()",resource.mime,resource.bytes.len(),resources::CSP);
                let response = enforce(env.CreateWebResourceResponse(&stream,200,&HSTRING::from("OK"),&HSTRING::from(headers)));
                enforce(args.SetResponse(&response));
            }
            Ok(())
        })),&mut token)?;
        core.add_PermissionRequested(
            &PermissionRequestedEventHandler::create(Box::new(|_, args| {
                if let Some(args) = args {
                    enforce(args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY));
                }
                Ok(())
            })),
            &mut token,
        )?;
        core.add_FrameNavigationStarting(
            &NavigationStartingEventHandler::create(Box::new(|_, args| {
                if let Some(args) = args {
                    enforce(args.SetCancel(true));
                }
                Ok(())
            })),
            &mut token,
        )?;
        core.cast::<ICoreWebView2_18>()?
            .add_LaunchingExternalUriScheme(
                &LaunchingExternalUriSchemeEventHandler::create(Box::new(|_, args| {
                    if let Some(args) = args {
                        enforce(args.SetCancel(true));
                    }
                    Ok(())
                })),
                &mut token,
            )?;
        core.cast::<ICoreWebView2_25>()?.add_SaveAsUIShowing(
            &SaveAsUIShowingEventHandler::create(Box::new(|_, args| {
                if let Some(args) = args {
                    enforce(args.SetCancel(true));
                }
                Ok(())
            })),
            &mut token,
        )?;
        let failed = proxy.clone();
        core.add_ProcessFailed(
            &ProcessFailedEventHandler::create(Box::new(move |_, _| {
                let _ = failed.send_event(Signal::Failed);
                Ok(())
            })),
            &mut token,
        )?;
        if options.smoke {
            // A negative observer, not an app bridge: ANY message fails the test.
            let failed = proxy.clone();
            core.add_WebMessageReceived(
                &WebMessageReceivedEventHandler::create(Box::new(move |_, _| {
                    let _ = failed.send_event(Signal::Failed);
                    Ok(())
                })),
                &mut token,
            )?;
        }
        let ready = proxy.clone();
        core.add_NavigationCompleted(
            &NavigationCompletedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else {
                    let _ = ready.send_event(Signal::Failed);
                    return Ok(());
                };
                let mut success = BOOL::default();
                enforce(args.IsSuccess(&mut success));
                let _ = ready.send_event(if success.as_bool() {
                    Signal::Ready
                } else {
                    Signal::Failed
                });
                Ok(())
            })),
            &mut token,
        )?;
    }
    // EOF, broken pipe or ANY additional byte is cancellation, never a second document.
    let revoked = proxy.clone();
    std::thread::spawn(move || {
        let mut byte = [0u8; 1];
        let _ = std::io::stdin().read(&mut byte);
        let _ = revoked.send_event(Signal::Revoke);
    });
    webview.load_url(resources::START_URL)?;
    let mut announced = false;
    let mut failed = false;
    let smoke_started = std::time::Instant::now();
    let mut smoke_polled = std::time::Instant::now();
    let mut smoke_candidate = None;
    event_loop.run_return(|event, _, flow| {
        *flow = if options.smoke { ControlFlow::WaitUntil(std::time::Instant::now()+std::time::Duration::from_millis(100)) } else { ControlFlow::Wait };
        match event {
            Event::UserEvent(Signal::Revoke)
            | Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => *flow = ControlFlow::Exit,
            Event::UserEvent(Signal::Failed) => {
                failed = true;
                *flow = ControlFlow::Exit;
            }
            Event::UserEvent(Signal::Ready) if !announced => {
                announced = true;
                if std::io::stdout()
                    .write_all(protocol::READY.as_bytes())
                    .and_then(|_| std::io::stdout().flush())
                    .is_err()
                {
                    *flow = ControlFlow::Exit;
                } else {
                    if !options.smoke && !options.hidden_hold { window.set_visible(true); }
                }
            }
            Event::UserEvent(Signal::SmokePassed) => {
                let _=std::io::stdout().write_all(b"SORNG_VIEWER_SMOKE_PASSED_V1\n");
                let _=std::io::stdout().flush();
                *flow=ControlFlow::Exit;
            }
            Event::UserEvent(Signal::SmokeCandidate) if smoke_candidate.is_none() => { smoke_candidate=Some(std::time::Instant::now()); }
            Event::MainEventsCleared if options.smoke => {
                if smoke_started.elapsed()>std::time::Duration::from_secs(10) { failed=true; *flow=ControlFlow::Exit; }
                else if smoke_candidate.is_some_and(|at:std::time::Instant|at.elapsed()>std::time::Duration::from_millis(500)) { let _=proxy.send_event(Signal::SmokePassed); }
                else if announced && smoke_candidate.is_none() && smoke_polled.elapsed()>std::time::Duration::from_millis(100) {
                    smoke_polled=std::time::Instant::now();
                    let passed=proxy.clone();
                    if webview.evaluate_script_with_callback("(()=>{try{window.ipc.postMessage('SORNG_DISABLED_CHANNEL_PROBE');}catch{}return Boolean(document.querySelector('pre,canvas') && !window.__TAURI_INTERNALS__);})()",move |value| { if value=="true" { let _=passed.send_event(Signal::SmokeCandidate); } }).is_err() { failed=true; *flow=ControlFlow::Exit; }
                }
            }
            _ => {}
        }
    });
    drop(core);
    drop(webview);
    drop(environment);
    drop(context);
    drop(window);
    // Broker owns this exact generated profile, including retry cleanup after job kill.
    if failed {
        Err("renderer unavailable".into())
    } else {
        Ok(())
    }
}

fn refuse_registry_overrides() -> HostResult<()> {
    use windows::Win32::{
        Foundation::{ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND, ERROR_SUCCESS},
        System::Registry::*,
    };
    // WebView2 accepts registry overrides even when env is cleared. Reject all
    // values in these override subkeys (including wildcard/other-app entries)
    // rather than accidentally missing a renamed executable or application ID.
    for hive in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        for view in [KEY_WOW64_32KEY, KEY_WOW64_64KEY] {
            for setting in [
                "AdditionalBrowserArguments",
                "BrowserExecutableFolder",
                "UserDataFolder",
                "ReleaseChannelPreference",
                "ReleaseChannels",
                "ChannelSearchKind",
            ] {
                let mut key = HKEY::default();
                let name = HSTRING::from(format!(
                    "Software\\Policies\\Microsoft\\Edge\\WebView2\\{setting}"
                ));
                let status = unsafe { RegOpenKeyExW(hive, &name, None, KEY_READ | view, &mut key) };
                if status == ERROR_FILE_NOT_FOUND || status == ERROR_PATH_NOT_FOUND {
                    continue;
                }
                if status != ERROR_SUCCESS {
                    return Err("runtime policy unreadable".into());
                }
                let mut values = 0;
                let status = unsafe {
                    RegQueryInfoKeyW(
                        key,
                        None,
                        None,
                        None,
                        None,
                        None,
                        None,
                        Some(&mut values),
                        None,
                        None,
                        None,
                        None,
                    )
                };
                let closed = unsafe { RegCloseKey(key) };
                if status != ERROR_SUCCESS || closed != ERROR_SUCCESS || values != 0 {
                    return Err("runtime policy override".into());
                }
            }
        }
    }
    Ok(())
}
