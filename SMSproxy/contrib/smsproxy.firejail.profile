# firejail profile — hard-contain the SMSproxy node process so that even if it
# were exploited, it cannot read your home, documents, keys, or run as root.
#
# Usage (run Caddy separately, or answer "Start Caddy automatically? n"):
#   firejail --profile=contrib/smsproxy.firejail.profile node bin/smsproxy.js
#
# Filesystem: it can only see this project directory; the rest of home is hidden.

include disable-common.inc
include disable-programs.inc

# no new privileges, drop every capability, block setuid escalation
caps.drop all
nonewprivs
noroot
nogroups
seccomp

# hide the entire home directory, then expose ONLY the project via whitelist
private-tmp
whitelist ${PWD}
read-only ${PWD}
# the tool writes nothing to the project at runtime; messages stay in memory

# networking: keep loopback so Caddy can reach it; no raw sockets
protocol unix,inet,inet6
netfilter

# misc lockdown
disable-mnt
machine-id
novideo
nosound
no3d
notv
nodvd
