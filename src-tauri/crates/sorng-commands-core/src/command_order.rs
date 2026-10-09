/// Match `str::Ord` byte ordering without requiring a runtime initializer.
/// Core command groups use binary_search, so ordering is a build invariant.
pub(super) const fn assert_sorted_unique(commands: &[&str]) {
    let mut index = 1;
    while index < commands.len() {
        let left = commands[index - 1].as_bytes();
        let right = commands[index].as_bytes();
        let mut byte = 0;
        while byte < left.len() && byte < right.len() && left[byte] == right[byte] {
            byte += 1;
        }
        let ordered = if byte == left.len() {
            byte < right.len()
        } else {
            byte < right.len() && left[byte] < right[byte]
        };
        assert!(ordered, "Core commands must be sorted and unique. Run node scripts/sort-core-command-groups.mjs");
        index += 1;
    }
}
