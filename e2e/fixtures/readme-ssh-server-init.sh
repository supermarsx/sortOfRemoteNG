#!/usr/bin/with-contenv sh
set -eu

# The application's SSH transport currently negotiates the SHA-2 Diffie-Hellman
# groups. OpenSSH 10.3 removed them from its default server offer, so enable the
# strongest verified interoperable SHA-2 group explicitly for this isolated
# local fixture.
printf '\nKexAlgorithms +diffie-hellman-group16-sha512\n' >> /config/sshd/sshd_config
/usr/sbin/sshd.pam -t -f /config/sshd/sshd_config
