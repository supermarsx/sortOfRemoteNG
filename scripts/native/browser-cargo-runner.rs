// Tauri places "run"/"build" before runner.args, so Node cannot be the runner
// directly. This dependency-free trampoline preserves arguments without a shell.
use std::{
    env,
    process::{Command, ExitCode},
};

fn main() -> ExitCode {
    let result = (|| -> Result<_, Box<dyn std::error::Error>> {
        #[cfg(windows)]
        unsafe {
            own_child_job()?;
        }
        let node = env::var_os("SORNG_CEF_NODE").ok_or("Missing SORNG_CEF_NODE")?;
        let driver = env::var_os("SORNG_CEF_DRIVER").ok_or("Missing SORNG_CEF_DRIVER")?;
        Ok(Command::new(node)
            .arg(driver)
            .arg("__cargo")
            .env("SORNG_CEF_RUNNER_PARENT", std::process::id().to_string())
            .args(env::args_os().skip(1))
            .status()?)
    })();
    match result {
        Ok(status) => ExitCode::from(status.code().unwrap_or(1).clamp(0, 255) as u8),
        Err(error) => {
            eprintln!("CEF Cargo runner: {error}");
            ExitCode::FAILURE
        }
    }
}

// Tauri's watcher terminates only its Cargo runner. Keep all OUR descendants
// in a kill-on-close job so a restart cannot strand a CEF browser or renderer.
// No sandbox limits are removed; CEF creates its own nested sandbox jobs.
#[cfg(windows)]
unsafe fn own_child_job() -> Result<(), std::io::Error> {
    use std::ffi::c_void;
    #[repr(C)]
    #[derive(Default)]
    struct Basic {
        process_time: i64,
        job_time: i64,
        flags: u32,
        min_working_set: usize,
        max_working_set: usize,
        active_processes: u32,
        affinity: usize,
        priority: u32,
        scheduling: u32,
    }
    #[repr(C)]
    #[derive(Default)]
    struct Extended {
        basic: Basic,
        io: [u64; 6],
        process_memory: usize,
        job_memory: usize,
        peak_process_memory: usize,
        peak_job_memory: usize,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateJobObjectW(attributes: *const c_void, name: *const u16) -> *mut c_void;
        fn SetInformationJobObject(
            job: *mut c_void,
            class: i32,
            info: *const c_void,
            size: u32,
        ) -> i32;
        fn GetCurrentProcess() -> *mut c_void;
        fn AssignProcessToJobObject(job: *mut c_void, process: *mut c_void) -> i32;
    }
    let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
    if job.is_null() {
        return Err(std::io::Error::last_os_error());
    }
    let mut limits = Extended::default();
    limits.basic.flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if SetInformationJobObject(
        job,
        9,
        &limits as *const _ as _,
        std::mem::size_of::<Extended>() as u32,
    ) == 0
        || AssignProcessToJobObject(job, GetCurrentProcess()) == 0
    {
        return Err(std::io::Error::last_os_error());
    }
    // Deliberately retain the non-inheritable handle until process termination.
    Ok(())
}
