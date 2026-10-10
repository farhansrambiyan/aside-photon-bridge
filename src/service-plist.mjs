export const serviceLabel = 'local.aside.photon-bridge';
export function servicePlist(root, node) {
  const escape = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${serviceLabel}</string>
<key>ProgramArguments</key><array><string>${escape(node)}</string><string>--env-file=.env</string><string>src/service.mjs</string></array>
<key>WorkingDirectory</key><string>${escape(root)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer>
<key>ProcessType</key><string>Background</string><key>ExitTimeOut</key><integer>15</integer>
<key>StandardOutPath</key><string>${escape(root)}/logs/service.log</string>
<key>StandardErrorPath</key><string>${escape(root)}/logs/service-error.log</string>
</dict></plist>`;
}
