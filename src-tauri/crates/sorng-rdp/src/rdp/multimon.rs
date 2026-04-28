use super::settings::RdpMonitorLayoutPayload;

type MonitorLayoutEntry = crate::ironrdp_displaycontrol::pdu::MonitorLayoutEntry;

fn apply_optional_monitor_fields(
    mut entry: MonitorLayoutEntry,
    monitor: &RdpMonitorLayoutPayload,
) -> MonitorLayoutEntry {
    if let Some(scale) = monitor
        .desktop_scale_factor
        .filter(|value| (100..=500).contains(value))
    {
        if let Ok(updated) = entry.clone().with_desktop_scale_factor(scale) {
            entry = updated;
        }
    }

    if let (Some(physical_width), Some(physical_height)) = (monitor.physical_width, monitor.physical_height)
    {
        if (10..=10_000).contains(&physical_width) && (10..=10_000).contains(&physical_height) {
            if let Ok(updated) = entry
                .clone()
                .with_physical_dimensions(physical_width, physical_height)
            {
                entry = updated;
            }
        }
    }

    entry
}

pub fn normalize_monitor_layout(
    monitors: &[RdpMonitorLayoutPayload],
) -> Result<Vec<MonitorLayoutEntry>, &'static str> {
    if monitors.len() < 2 {
        return Err("explicit monitor layout requires at least two monitors");
    }

    let primary_count = monitors
        .iter()
        .filter(|monitor| monitor.is_primary.unwrap_or(false))
        .count();
    if primary_count != 1 {
        return Err("explicit monitor layout requires exactly one primary monitor");
    }

    let primary = monitors
        .iter()
        .find(|monitor| monitor.is_primary.unwrap_or(false))
        .ok_or("primary monitor is required")?;
    let origin_left = primary.left.unwrap_or(0);
    let origin_top = primary.top.unwrap_or(0);

    let mut normalized = Vec::with_capacity(monitors.len());
    for monitor in monitors {
        let (width, height) = MonitorLayoutEntry::adjust_display_size(monitor.width, monitor.height);

        let mut entry = if monitor.is_primary.unwrap_or(false) {
            MonitorLayoutEntry::new_primary(width, height)
        } else {
            MonitorLayoutEntry::new_secondary(width, height)
        }
        .map_err(|_| "invalid monitor dimensions")?;

        let left = monitor.left.unwrap_or(0) - origin_left;
        let top = monitor.top.unwrap_or(0) - origin_top;

        entry = entry
            .with_position(left, top)
            .map_err(|_| "invalid monitor position")?;

        normalized.push(apply_optional_monitor_fields(entry, monitor));
    }

    crate::ironrdp_displaycontrol::pdu::DisplayControlMonitorLayout::new(&normalized)
        .map_err(|_| "invalid monitor layout")?;

    Ok(normalized)
}

pub fn build_display_control_messages(
    explicit_layout: Option<&[RdpMonitorLayoutPayload]>,
) -> Vec<crate::ironrdp_dvc::DvcMessage> {
    let Some(layout) = explicit_layout else {
        return Vec::new();
    };

    let Ok(monitors) = normalize_monitor_layout(layout) else {
        return Vec::new();
    };

    let Ok(layout_pdu) = crate::ironrdp_displaycontrol::pdu::DisplayControlMonitorLayout::new(&monitors) else {
        return Vec::new();
    };

    let pdu: crate::ironrdp_displaycontrol::pdu::DisplayControlPdu = layout_pdu.into();
    vec![Box::new(pdu) as crate::ironrdp_dvc::DvcMessage]
}

#[cfg(test)]
mod tests {
    use super::{build_display_control_messages, normalize_monitor_layout};
    use crate::rdp::settings::RdpMonitorLayoutPayload;

    fn monitor(
        is_primary: bool,
        left: i32,
        top: i32,
        width: u32,
        height: u32,
    ) -> RdpMonitorLayoutPayload {
        RdpMonitorLayoutPayload {
            is_primary: Some(is_primary),
            left: Some(left),
            top: Some(top),
            width,
            height,
            desktop_scale_factor: None,
            physical_width: None,
            physical_height: None,
        }
    }

    #[test]
    fn normalizes_dimensions_and_offsets_to_primary_origin() {
        let monitors = vec![
            monitor(true, 100, 50, 199, 9000),
            monitor(false, 1411, 50, 801, 400),
        ];

        let normalized = normalize_monitor_layout(&monitors).expect("normalized layout");

        assert_eq!(normalized.len(), 2);
        assert_eq!(normalized[0].position(), Some((0, 0)));
        assert_eq!(normalized[0].dimensions(), (200, 8192));
        assert_eq!(normalized[1].position(), Some((1311, 0)));
        assert_eq!(normalized[1].dimensions(), (800, 400));
    }

    #[test]
    fn rejects_layout_without_exactly_one_primary_monitor() {
        let no_primary = vec![
            monitor(false, 0, 0, 1920, 1080),
            monitor(false, 1920, 0, 1920, 1080),
        ];
        assert!(normalize_monitor_layout(&no_primary).is_err());

        let too_many_primary = vec![
            monitor(true, 0, 0, 1920, 1080),
            monitor(true, 1920, 0, 1920, 1080),
        ];
        assert!(normalize_monitor_layout(&too_many_primary).is_err());
    }

    #[test]
    fn no_layout_messages_when_input_missing_or_invalid() {
        assert!(build_display_control_messages(None).is_empty());

        let invalid = vec![monitor(true, 0, 0, 1920, 1080)];
        assert!(build_display_control_messages(Some(&invalid)).is_empty());
    }

    #[test]
    fn emits_layout_message_for_valid_explicit_multimon_input() {
        let monitors = vec![
            monitor(true, 0, 0, 1920, 1080),
            monitor(false, 1920, 0, 1920, 1080),
        ];

        let messages = build_display_control_messages(Some(&monitors));
        assert_eq!(messages.len(), 1);
    }
}