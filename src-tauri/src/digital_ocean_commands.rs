mod digital_ocean {
    pub use crate::digital_ocean::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-cloud/src/digital_ocean_cmds.rs");
}

pub(crate) use inner::*;
