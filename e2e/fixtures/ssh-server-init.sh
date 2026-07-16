#!/usr/bin/with-contenv sh
set -eu

# libssh2's Windows WinCNG backend negotiates the SHA-2 Diffie-Hellman groups,
# while OpenSSH 10.3 removed them from its default server offer. Enable the
# strongest verified interoperable SHA-2 group only in this isolated fixture.
config=/config/sshd/sshd_config
directive='KexAlgorithms +diffie-hellman-group16-sha512'

# Custom init scripts can run again when a container restarts. Prepend once so
# this remains the first effective KexAlgorithms directive if an image later
# adds an explicit policy farther down its generated configuration.
if ! grep -Fqx "$directive" "$config"; then
  sed -i "1i$directive" "$config"
fi

# LinuxServer stores host keys outside OpenSSH's default path and supplies them
# with repeated `-h` flags at runtime. Mirror that invocation so test mode
# validates the real fixture configuration instead of reporting no host keys.
set --
for host_key in /config/ssh_host_keys/ssh_host_*_key; do
  set -- "$@" -h "$host_key"
done
/usr/sbin/sshd.pam -t -f "$config" "$@"
