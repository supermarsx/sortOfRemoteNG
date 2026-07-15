FROM mcr.microsoft.com/powershell@sha256:62300a213a9293916333df2b014cd3a8f22fb0b0b65f2bb446aaf436bcf8c868

USER root

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends openssh-server \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /run/sshd \
    && useradd --create-home --shell /bin/bash psrp \
    && echo 'psrp:PsrpTest!42' | chpasswd \
    && ssh-keygen -A

COPY sshd_config /etc/ssh/sshd_config

EXPOSE 22

HEALTHCHECK --interval=2s --timeout=2s --retries=20 \
    CMD ["pwsh", "-NoLogo", "-NoProfile", "-Command", "if ($PSVersionTable.PSVersion.Major -lt 7) { exit 1 }"]

CMD ["/usr/sbin/sshd", "-D", "-e"]
