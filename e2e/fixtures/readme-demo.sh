#!/bin/sh

# Deterministic terminal content for the real-application README capture.
# Keep this process alive so a shell prompt, hostname, or timing-dependent
# output cannot appear after the fixed fixture has rendered.
printf '\033[2J\033[H'
printf '\033[1;38;5;45m  sortOfRemoteNG / Prototype SSH\033[0m\n'
printf '\033[38;5;244m  README Demo - deterministic local environment\033[0m\n'
printf '\n'
printf '\033[38;5;39m  +-----------------------------------------------------------+\033[0m\n'
printf '\033[38;5;39m  |\033[0m  Endpoint    localhost:2222                               \033[38;5;39m|\033[0m\n'
printf '\033[38;5;39m  |\033[0m  Identity    testuser (local fixture)                     \033[38;5;39m|\033[0m\n'
printf '\033[38;5;39m  |\033[0m  Transport   SSH / encrypted                              \033[38;5;39m|\033[0m\n'
printf '\033[38;5;39m  +-----------------------------------------------------------+\033[0m\n'
printf '\n'
printf '\033[1;38;5;82m  [ready]\033[0m  SSH transport negotiated\n'
printf '\033[1;38;5;82m  [ready]\033[0m  Local fixture authenticated\n'
printf '\033[1;38;5;82m  [ready]\033[0m  Interactive terminal attached\n'
printf '\n'
printf '\033[1;38;5;231m  Prototype environment is ready.\033[0m\n'
printf '\033[?25l'

while :; do
  sleep 3600
done
