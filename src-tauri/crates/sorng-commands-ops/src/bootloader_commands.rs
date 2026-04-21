mod detect {
    pub use crate::bootloader::detect::*;
}

mod grub {
    pub use crate::bootloader::grub::*;
}

mod initramfs {
    pub use crate::bootloader::initramfs::*;
}

mod kernels {
    pub use crate::bootloader::kernels::*;
}

mod service {
    pub use crate::bootloader::service::*;
}

mod systemd_boot {
    pub use crate::bootloader::systemd_boot::*;
}

mod types {
    pub use crate::bootloader::types::*;
}

mod uefi {
    pub use crate::bootloader::uefi::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-bootloader/src/commands.rs");
}

pub(crate) use inner::*;
