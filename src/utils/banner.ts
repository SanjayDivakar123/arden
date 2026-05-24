export function printBanner(version = '0.1.0') {
  const g = '\x1b[38;2;0;255;153m';
  const d = '\x1b[2m';
  const r = '\x1b[0m';

  console.log(`
${g}    _    ____  ____  _____ _   _ ${r}
${g}   / \\  |  _ \\|  _ \\| ____| \\ | |${r}
${g}  / _ \\ | |_) | | | |  _| |  \\| |${r}
${g} / ___ \\|  _ <| |_| | |___| |\\  |${r}
${g}/_/   \\_\\_| \\_\\____/|_____|_| \\_|${r}

${d}  🌿 v${version} — The agent framework that finishes what it starts.${r}
`);
}
