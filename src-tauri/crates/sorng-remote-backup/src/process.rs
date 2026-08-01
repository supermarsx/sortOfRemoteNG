//! Bounded child-process execution shared by all backup tool adapters.

use std::io;
use std::process::{Output, Stdio};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::{ChildStdin, Command};

const MAX_CAPTURE_BYTES: usize = 1024 * 1024;
const MAX_STDIN_BYTES: usize = 1024 * 1024;
const PROCESS_TIMEOUT: Duration = Duration::from_secs(6 * 60 * 60);

#[allow(async_fn_in_trait)]
pub(crate) trait BoundedCommandExt {
    async fn output_bounded(&mut self) -> io::Result<Output>;
    async fn output_bounded_with_input(&mut self, input: &[u8]) -> io::Result<Output>;
}

impl BoundedCommandExt for Command {
    async fn output_bounded(&mut self) -> io::Result<Output> {
        run_bounded(self, None).await
    }

    async fn output_bounded_with_input(&mut self, input: &[u8]) -> io::Result<Output> {
        if input.len() > MAX_STDIN_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "child-process input exceeds the 1 MiB safety limit",
            ));
        }
        run_bounded(self, Some(input.to_vec())).await
    }
}

async fn run_bounded(command: &mut Command, input: Option<Vec<u8>>) -> io::Result<Output> {
    command
        .kill_on_drop(true)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if input.is_some() {
        command.stdin(Stdio::piped());
    } else {
        command.stdin(Stdio::null());
    }

    let mut child = command.spawn()?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| io::Error::other("child stdout was not captured"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| io::Error::other("child stderr was not captured"))?;
    let stdin = child.stdin.take();

    let operation = async {
        let (status, stdout, stderr, ()) = tokio::try_join!(
            child.wait(),
            read_limited(stdout),
            read_limited(stderr),
            write_input(stdin, input),
        )?;
        Ok(Output {
            status,
            stdout,
            stderr,
        })
    };

    match tokio::time::timeout(PROCESS_TIMEOUT, operation).await {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(error)) => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            Err(error)
        }
        Err(_) => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "backup tool exceeded the six-hour execution limit",
            ))
        }
    }
}

async fn read_limited<R>(mut reader: R) -> io::Result<Vec<u8>>
where
    R: AsyncRead + Unpin,
{
    let mut output = Vec::with_capacity(8192);
    let mut chunk = [0u8; 8192];
    loop {
        let read = reader.read(&mut chunk).await?;
        if read == 0 {
            return Ok(output);
        }
        if output.len().saturating_add(read) > MAX_CAPTURE_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "backup tool output exceeded the 1 MiB safety limit",
            ));
        }
        output.extend_from_slice(&chunk[..read]);
    }
}

async fn write_input(mut stdin: Option<ChildStdin>, input: Option<Vec<u8>>) -> io::Result<()> {
    let Some(input) = input else {
        return Ok(());
    };
    let Some(mut stdin) = stdin.take() else {
        return Err(io::Error::other("child stdin was not available"));
    };
    stdin.write_all(&input).await?;
    stdin.shutdown().await
}
