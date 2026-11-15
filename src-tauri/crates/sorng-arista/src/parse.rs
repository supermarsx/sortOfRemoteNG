//! Tolerant parser for `show system environment cooling` JSON.
//!
//! Field names and types drift across EOS versions and platforms, so every
//! value is optional and numbers may arrive as JSON numbers or strings.

use crate::types::{AristaCoolingReport, AristaFan};
use serde_json::Value;

fn num(v: Option<&Value>) -> Option<f64> {
    match v? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().trim_end_matches('%').trim().parse::<f64>().ok(),
        _ => None,
    }
    .filter(|n| n.is_finite())
}

fn text(v: Option<&Value>) -> Option<String> {
    match v? {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn rpm(v: Option<&Value>) -> Option<u32> {
    num(v).filter(|n| *n >= 0.0 && *n <= u32::MAX as f64).map(|n| n.round() as u32)
}

fn parse_slots(root: &Value, key: &str, kind: &str, out: &mut Vec<AristaFan>) {
    let Some(slots) = root.get(key).and_then(Value::as_array) else {
        return;
    };
    for (i, slot) in slots.iter().enumerate() {
        let tray = text(slot.get("label")).unwrap_or_else(|| (i + 1).to_string());
        let fans = slot.get("fans").and_then(Value::as_array);
        match fans {
            Some(fans) if !fans.is_empty() => {
                for (j, fan) in fans.iter().enumerate() {
                    out.push(AristaFan {
                        tray_label: tray.clone(),
                        tray_kind: kind.to_string(),
                        fan_label: text(fan.get("label")).unwrap_or_else(|| format!("{}/{}", tray, j + 1)),
                        status: text(fan.get("status")).or_else(|| text(slot.get("status"))),
                        actual_speed_pct: num(fan.get("actualSpeed")),
                        configured_speed_pct: num(fan.get("configuredSpeed")),
                        rpm: rpm(fan.get("speed")).or_else(|| rpm(fan.get("rpm"))),
                        max_rpm: rpm(fan.get("maxSpeed")),
                        uptime_secs: num(fan.get("uptime")),
                    });
                }
            }
            // Slot without per-fan detail: surface the slot itself as one row.
            _ => out.push(AristaFan {
                tray_label: tray.clone(),
                tray_kind: kind.to_string(),
                fan_label: tray.clone(),
                status: text(slot.get("status")),
                actual_speed_pct: num(slot.get("actualSpeed")),
                configured_speed_pct: num(slot.get("configuredSpeed")),
                rpm: rpm(slot.get("speed")),
                max_rpm: rpm(slot.get("maxSpeed")),
                uptime_secs: num(slot.get("uptime")),
            }),
        }
    }
}

/// Parse the JSON object returned for the cooling command. Never fails:
/// unknown shapes yield an empty `fans` list.
pub fn parse_cooling_json(root: &Value, source: &str) -> AristaCoolingReport {
    let mut fans = Vec::new();
    parse_slots(root, "fanTraySlots", "fanTray", &mut fans);
    parse_slots(root, "powerSupplySlots", "powerSupply", &mut fans);
    AristaCoolingReport {
        system_status: text(root.get("systemStatus")),
        airflow: text(root.get("airflowDirection")),
        ambient_c: num(root.get("ambientTemperature")),
        fans,
        source: source.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn normal_two_trays_four_fans() {
        let v = json!({
            "systemStatus": "coolingOk",
            "airflowDirection": "frontToBackAirflow",
            "ambientTemperature": 24.5,
            "fanTraySlots": [
                {"label": "1", "status": "ok", "fans": [
                    {"label": "1/1", "status": "ok", "actualSpeed": 40, "configuredSpeed": 40, "speed": 8100, "maxSpeed": 20000, "uptime": 1234.5},
                    {"label": "1/2", "status": "ok", "actualSpeed": 41, "configuredSpeed": 40}
                ]},
                {"label": "2", "status": "ok", "fans": [
                    {"label": "2/1", "status": "ok", "actualSpeed": 40},
                    {"label": "2/2", "status": "ok", "actualSpeed": 42}
                ]}
            ],
            "powerSupplySlots": [{"label": "1", "status": "ok", "fans": [{"label": "PS1/1", "status": "ok", "actualSpeed": 30}]}]
        });
        let r = parse_cooling_json(&v, "show system environment cooling");
        assert_eq!(r.fans.len(), 5);
        assert_eq!(r.system_status.as_deref(), Some("coolingOk"));
        assert_eq!(r.airflow.as_deref(), Some("frontToBackAirflow"));
        assert_eq!(r.ambient_c, Some(24.5));
        assert_eq!(r.fans[0].rpm, Some(8100));
        assert_eq!(r.fans[0].max_rpm, Some(20000));
        assert_eq!(r.fans[0].actual_speed_pct, Some(40.0));
        assert_eq!(r.fans[4].tray_kind, "powerSupply");
        assert_eq!(r.source, "show system environment cooling");
    }

    #[test]
    fn failed_and_missing_fans_keep_status() {
        let v = json!({"fanTraySlots": [
            {"label": "1", "status": "failed", "fans": [{"label": "1/1", "status": "failed", "actualSpeed": 0}]},
            {"label": "2", "status": "notInserted", "fans": []}
        ]});
        let r = parse_cooling_json(&v, "x");
        assert_eq!(r.fans.len(), 2);
        assert_eq!(r.fans[0].status.as_deref(), Some("failed"));
        assert_eq!(r.fans[1].status.as_deref(), Some("notInserted"));
        assert_eq!(r.fans[1].fan_label, "2");
    }

    #[test]
    fn percent_only_and_rpm_only() {
        let v = json!({"fanTraySlots": [{"label": "1", "fans": [
            {"actualSpeed": 55},
            {"speed": 6000}
        ]}]});
        let r = parse_cooling_json(&v, "x");
        assert_eq!(r.fans[0].actual_speed_pct, Some(55.0));
        assert_eq!(r.fans[0].rpm, None);
        assert_eq!(r.fans[0].fan_label, "1/1");
        assert_eq!(r.fans[1].rpm, Some(6000));
        assert_eq!(r.fans[1].actual_speed_pct, None);
        assert_eq!(r.fans[1].fan_label, "1/2");
    }

    #[test]
    fn empty_and_wrong_types_are_tolerated() {
        assert!(parse_cooling_json(&json!({}), "x").fans.is_empty());
        assert!(parse_cooling_json(&json!({"fanTraySlots": []}), "x").fans.is_empty());
        assert!(parse_cooling_json(&json!({"fanTraySlots": "oops"}), "x").fans.is_empty());
        assert!(parse_cooling_json(&json!([1, 2]), "x").fans.is_empty());
        let v = json!({"ambientTemperature": "n/a", "fanTraySlots": [{"label": 3, "fans": [
            {"label": 7, "actualSpeed": "45%", "speed": "bad", "maxSpeed": -5, "status": 12}
        ]}]});
        let r = parse_cooling_json(&v, "x");
        assert_eq!(r.ambient_c, None);
        let f = &r.fans[0];
        assert_eq!(f.tray_label, "3");
        assert_eq!(f.fan_label, "7");
        assert_eq!(f.actual_speed_pct, Some(45.0));
        assert_eq!(f.rpm, None);
        assert_eq!(f.max_rpm, None);
        assert_eq!(f.status.as_deref(), Some("12"));
    }

    #[test]
    fn slot_without_fans_array_becomes_row() {
        let v = json!({"fanTraySlots": [{"label": "1", "status": "ok", "speed": 5000, "actualSpeed": 33}]});
        let r = parse_cooling_json(&v, "x");
        assert_eq!(r.fans.len(), 1);
        assert_eq!(r.fans[0].rpm, Some(5000));
        assert_eq!(r.fans[0].actual_speed_pct, Some(33.0));
    }
}
