#!/usr/bin/env node
const fs = require('node:fs');

const args = process.argv.slice(2);
if (process.env.KATARIBE_DIARIZATION_ARGS_FILE) {
  fs.appendFileSync(
    process.env.KATARIBE_DIARIZATION_ARGS_FILE,
    `${args.join('\n')}\n---\n`,
  );
}

const mode = process.env.KATARIBE_DIARIZATION_MODE ?? 'ok';
if (mode === 'fail') {
  process.stderr.write('synthetic failure\n');
  process.exit(2);
}
if (mode === 'empty') {
  process.exit(0);
}
if (mode === 'cancel') {
  process.stderr.write('progress 1.00%\n');
  setTimeout(() => undefined, 30000);
} else if (mode === 'many') {
  const fixed = args.includes('--clustering.num-clusters=10');
  const count = fixed ? 10 : 11;
  for (let index = 0; index < count; index += 1) {
    process.stdout.write(
      `${index}.000 -- ${index + 1}.000 speaker_${String(index).padStart(2, '0')}\n`,
    );
  }
  process.stderr.write('progress 100.00%\n');
} else {
  process.stderr.write('progress 50.00%\nprogress 100.00%\n');
  process.stdout.write(
    '0.000 -- 1.000 speaker_00\n1.000 -- 2.000 speaker_01\n2.000 -- 3.000 speaker_00\n',
  );
}
