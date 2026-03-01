//! # SortOfRemote NG – Serial / RS-232
//!
//! Comprehensive serial port communication crate providing:
//!
//! - **Port Discovery** – enumerate COM / tty ports, detect USB-serial adapters
//! - **Transport** – abstracted read/write over a serial port with configurable
//!   baud rate, data bits, parity, stop bits, and flow control
//! - **Session Management** – multi-session async I/O with Tauri event bridging
//! - **Modem / AT Commands** – Hayes AT command set, dial, answer, hang-up
//! - **Line Protocols** – XMODEM, YMODEM, ZMODEM file transfer helpers
//! - **Data Logging** – session capture to file, hex dump, timestamps

pub mod serial;
